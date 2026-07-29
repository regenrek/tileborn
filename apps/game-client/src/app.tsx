import {
  CONTROL_SCHEMES,
  PERSISTED_SCHEMA_VERSIONS,
  REQUIRED_PLAYER_MODEL_CLIP_KEYS,
  controlScheme,
  type PlayerModelClipKey,
} from '@tileborne/core';
import {
  type BrowserRuntimeAudioEngineConfig,
  createLocalStorageBindingsStore,
  createAudioUserSettingsStore,
  createGameHostLobbyClient,
  defaultBrandConfig,
  LobbyPanel,
  defaultShippedShellProjection,
  loadShippedAudioConfig,
  loadShippedShellProjection,
  type LobbyCreateResponse,
  type LobbyJoinResponse,
  type LobbyPanelSession,
  type LobbyPanelStatus,
  type LobbyReconnectPrompt,
  type RoomReconnectResponse,
  type AudioSettingsValue,
  type AudioTabConfig,
  type RuntimeAudioPlaybackEngine,
  RuntimeRoot,
  type ControlsTabConfig,
  type RuntimeShellBehaviorBridge,
  type SequencedRuntimeShellNavigationRequest,
} from '@tileborne/game-client';
import {
  DEFAULT_ROOM_RECONNECT_PATH,
  makeBrowserWebSocketTransport,
  makeNetFrameClient,
} from '@tileborne/runtime/net';
import {
  createBattleRoyaleBundledAssets,
  battleRoyaleAudioCues,
  battleRoyaleDefaultInputMap,
  battleRoyaleSfxBus,
  IMPACT_BURST_TEXTURE_ASSET_ID,
  PLAYER_TEXTURE_ASSET_ID,
  WEAPON_RIFLE_TEXTURE_ASSET_ID,
} from '@tileborne/plugin-battle-royale';
import {
  createBattleRoyaleProjector,
  decodeServerFrame,
  type BattleRoyaleProjectorConfig,
  type PlayerModelClipRenderData,
  type PlayerModelRenderData,
  type SpriteVisualRenderData,
  type WeaponVisualRenderData,
} from '@tileborne/plugin-battle-royale/renderer';
import { BR_PRIMARY_WEAPON_ID } from '@tileborne/plugin-battle-royale/constants';
import { battleRoyaleMenuSections } from '@tileborne/plugin-battle-royale/menu';
import type { RenderableEntity, RuntimeGameShellProjection } from '@tileborne/runtime';
import { PixiRendererAdapter } from '@tileborne/runtime';
import { Effect } from 'effect';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';

import {
  applyShippedRuntimeServerFrame,
  buildSnapshotAckFrame,
  decodeShippedShellNavigationFrame,
  decodeShippedRuntimeServerFrame,
  encodeShippedShellEventFrame,
  initialShippedRuntimeState,
  shippedRuntimeHudMetrics,
  shippedRuntimeResults,
  type ShippedRuntimeState,
} from './shipped-runtime-stream.js';

const DEFAULT_LOBBY_MAP_ID = 'map:fixture';
const LOBBY_RECONNECT_STORAGE_KEY = `tileborne.game-client.lobby-reconnect.v${PERSISTED_SCHEMA_VERSIONS.lobbyReconnect}`;

interface ShippedRuntimeRenderState {
  readonly snapshot: unknown;
  readonly entities: readonly RenderableEntity[];
}

interface AppProps {
  readonly audioEngineFactory?:
    | ((config: BrowserRuntimeAudioEngineConfig) => RuntimeAudioPlaybackEngine)
    | undefined;
  readonly onRuntimeFrame?:
    | ((
        frame: NonNullable<ReturnType<typeof decodeShippedRuntimeServerFrame>>,
        data: Uint8Array,
      ) => void)
    | undefined;
  readonly onRuntimeRendererReady?: ((adapter: PixiRendererAdapter) => void) | undefined;
}

interface StoredLobbyReconnect {
  readonly roomId: string;
  readonly playerId: string;
  readonly reconnectToken: string;
}

const isStoredLobbyReconnect = (value: unknown): value is StoredLobbyReconnect => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.roomId === 'string' &&
    record.roomId.length > 0 &&
    typeof record.playerId === 'string' &&
    record.playerId.length > 0 &&
    typeof record.reconnectToken === 'string' &&
    record.reconnectToken.length > 0
  );
};

const readStoredLobbyReconnect = (): StoredLobbyReconnect | null => {
  try {
    const raw = window.localStorage.getItem(LOBBY_RECONNECT_STORAGE_KEY);
    if (raw === null) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    return isStoredLobbyReconnect(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const writeStoredLobbyReconnect = (session: LobbyPanelSession): StoredLobbyReconnect | null => {
  if (!session.playerId || !session.reconnectToken) {
    return null;
  }
  const stored: StoredLobbyReconnect = {
    roomId: session.roomId,
    playerId: session.playerId,
    reconnectToken: session.reconnectToken,
  };
  window.localStorage.setItem(LOBBY_RECONNECT_STORAGE_KEY, JSON.stringify(stored));
  return stored;
};

const toCreateSession = (response: LobbyCreateResponse): LobbyPanelSession => ({
  roomId: response.roomId,
  wsUrl: response.wsUrl,
  joinCode: response.joinCode,
  joinUrl: response.joinUrl,
  ...(response.playerId === undefined ? {} : { playerId: response.playerId }),
  ...(response.handoffToken === undefined ? {} : { handoffToken: response.handoffToken }),
  ...(response.reconnectToken === undefined ? {} : { reconnectToken: response.reconnectToken }),
  lobby: response.lobby,
});

const toJoinSession = (response: LobbyJoinResponse | RoomReconnectResponse): LobbyPanelSession => ({
  roomId: response.roomId,
  playerId: response.playerId,
  wsUrl: response.wsUrl,
  handoffToken: response.handoffToken,
  ...(response.reconnectToken === undefined ? {} : { reconnectToken: response.reconnectToken }),
  lobby: response.lobby,
});

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Lobby request failed';

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

const decodeShellNavigationFrameBytes = (data: Uint8Array) =>
  decodeShippedShellNavigationFrame(textDecoder.decode(data));

const encodeShellEventFrameBytes = (
  event: Parameters<RuntimeShellBehaviorBridge['emitShellEvent']>[0],
): Uint8Array => textEncoder.encode(encodeShippedShellEventFrame(event));

const normalizeAudioSettings = (settings: AudioSettingsValue): AudioSettingsValue => ({
  ...settings,
  busVolumes: settings.busVolumes ?? {},
});

const clip = (key: PlayerModelClipKey): PlayerModelClipRenderData => ({
  frames: [
    {
      assetId: PLAYER_TEXTURE_ASSET_ID,
      uv: { x: 0, y: 0, w: 48, h: 48 },
      durationMs: 100,
    },
  ],
  loop: true,
  defaultDurationMs: 100,
});

const spriteVisual = (visualId: string, assetId: string): SpriteVisualRenderData => ({
  visualId,
  assetId,
  frames: [{ assetId, uv: { x: 0, y: 0, w: 24, h: 24 }, durationMs: 100 }],
  loop: false,
  anchor: { x: 0.5, y: 0.5 },
});

const shippedRuntimeProjectorConfig = (): BattleRoyaleProjectorConfig => {
  const model: PlayerModelRenderData = {
    assetId: PLAYER_TEXTURE_ASSET_ID,
    clips: Object.fromEntries(
      REQUIRED_PLAYER_MODEL_CLIP_KEYS.map((key) => [key, clip(key)]),
    ) as Record<PlayerModelClipKey, PlayerModelClipRenderData>,
    anchor: { x: 0.5, y: 1 },
  };
  const equipped: SpriteVisualRenderData = {
    ...spriteVisual('weapon-equipped', WEAPON_RIFLE_TEXTURE_ASSET_ID),
    anchor: { x: 0.25, y: 0.5 },
    anchors: {
      grip: { point: { x: 0.25, y: 0.5 } },
      muzzle: { point: { x: 0.75, y: 0.5 } },
    },
  };
  const weapon: WeaponVisualRenderData = {
    weaponId: BR_PRIMARY_WEAPON_ID,
    equipped,
    muzzleFlash: spriteVisual('muzzle-flash', IMPACT_BURST_TEXTURE_ASSET_ID),
  };
  return {
    catalog: new Map([['model:hero', model]]),
    weapons: new Map([[BR_PRIMARY_WEAPON_ID, weapon]]),
    defaultWeaponId: BR_PRIMARY_WEAPON_ID,
  };
};

const shippedRuntimeAssets = createBattleRoyaleBundledAssets();

const ShippedRuntimeCanvas = ({
  entities,
  onRendererAdapterReady,
}: {
  readonly entities: readonly RenderableEntity[];
  readonly onRendererAdapterReady?: ((adapter: PixiRendererAdapter) => void) | undefined;
}): ReactElement => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const adapterRef = useRef<PixiRendererAdapter | null>(null);
  const previousEntitiesRef = useRef<ReadonlyMap<string, RenderableEntity>>(new Map());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return undefined;
    }
    const adapter = new PixiRendererAdapter({
      applicationOptions: { autoStart: false, backgroundAlpha: 0 },
    });
    adapterRef.current = adapter;
    let disposed = false;
    void Effect.runPromise(
      adapter
        .mount(container)
        .pipe(Effect.tap(() => adapter.loadBundledAssets(shippedRuntimeAssets))),
    )
      .then(() => {
        if (!disposed) {
          onRendererAdapterReady?.(adapter);
          setReady(true);
        }
      })
      .catch((error) => {
        console.error('[game-client] failed to mount shipped runtime renderer', error);
      });

    return () => {
      disposed = true;
      adapterRef.current = null;
      setReady(false);
      void Effect.runPromise(adapter.dispose()).catch((error) => {
        console.error('[game-client] failed to dispose shipped runtime renderer', error);
      });
    };
  }, [onRendererAdapterReady]);

  useEffect(() => {
    const adapter = adapterRef.current;
    if (!ready || adapter === null) {
      return;
    }
    const previousById = previousEntitiesRef.current;
    previousEntitiesRef.current = new Map(entities.map((entity) => [entity.id, entity]));
    void Effect.runPromise(adapter.renderFromEntities(entities, previousById, 1)).catch((error) => {
      console.error('[game-client] failed to render shipped runtime entities', error);
    });
  }, [entities, ready]);

  return (
    <div
      ref={containerRef}
      data-testid="shipped-runtime-renderer"
      style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
    />
  );
};

/**
 * Brand-neutral game-client template app (ADR-0022 decision #3). Mounts the
 * generic shell with the neutral default brand and the battle-royale plugin's
 * menu sections. Products fork/overlay this entry: they pass their own
 * `BrandConfig` (from `branding/tokens.json`) and compose plugin sections with
 * their `menuExtensions` registrations.
 */
export function App({
  audioEngineFactory,
  onRuntimeFrame,
  onRuntimeRendererReady,
}: AppProps = {}): ReactElement {
  const lobbyClient = useMemo(() => createGameHostLobbyClient(), []);
  const audioSettingsStore = useMemo(() => createAudioUserSettingsStore(), []);
  const runtimeClientRef = useRef<ReturnType<typeof makeNetFrameClient> | null>(null);
  const shippedProjector = useMemo(
    () => createBattleRoyaleProjector(shippedRuntimeProjectorConfig()),
    [],
  );
  const [lobbyStatus, setLobbyStatus] = useState<LobbyPanelStatus>('idle');
  const [lobbyMessage, setLobbyMessage] = useState<string | undefined>(undefined);
  const [lobbyError, setLobbyError] = useState<string | undefined>(undefined);
  const [displayName, setDisplayName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [mapId, setMapId] = useState(DEFAULT_LOBBY_MAP_ID);
  const [lobbySession, setLobbySession] = useState<LobbyPanelSession | null>(null);
  const [audioSettings, setAudioSettings] = useState<AudioSettingsValue>(
    () =>
      audioSettingsStore.load() ?? {
        masterVolume: 1,
        muted: false,
        muteOnFocusLoss: true,
        busVolumes: { [battleRoyaleSfxBus.id]: battleRoyaleSfxBus.defaultVolume },
      },
  );
  const [shippedAudio, setShippedAudio] = useState<AudioTabConfig | undefined>(undefined);
  const [shellProjection, setShellProjection] = useState<RuntimeGameShellProjection>(() =>
    defaultShippedShellProjection('tileborne.battle-royale'),
  );
  const [shellAssetUrlBase, setShellAssetUrlBase] = useState<string | undefined>(undefined);
  const [storedReconnect, setStoredReconnect] = useState<StoredLobbyReconnect | null>(() =>
    readStoredLobbyReconnect(),
  );
  const [runtime, setRuntime] = useState<ShippedRuntimeState>(() => initialShippedRuntimeState());
  const [runtimeRender, setRuntimeRender] = useState<ShippedRuntimeRenderState>(() => ({
    snapshot: undefined,
    entities: [],
  }));
  const [shellNavigationRequests, setShellNavigationRequests] = useState<
    ReadonlyArray<SequencedRuntimeShellNavigationRequest>
  >([]);
  // Settings → Controls keybind remap editor (ADR-0024): the active mode's
  // default input map (BR) + a localStorage-backed overlay store. The overlay is
  // persisted in the engine-owned `InputMap` shape under a shared key, so it is
  // the same durable remap the engine resolver applies at play time.
  const controls = useMemo<ControlsTabConfig>(
    () => ({
      inputMap: battleRoyaleDefaultInputMap(),
      scheme: controlScheme(CONTROL_SCHEMES.KeyboardMouse),
      store: createLocalStorageBindingsStore(),
    }),
    [],
  );

  const audio = useMemo<AudioTabConfig>(
    () =>
      shippedAudio === undefined
        ? {
            settings: audioSettings,
            buses: [
              {
                id: battleRoyaleSfxBus.id,
                label: battleRoyaleSfxBus.label,
                kind: battleRoyaleSfxBus.kind,
                defaultVolume: battleRoyaleSfxBus.defaultVolume,
              },
            ],
            cues: battleRoyaleAudioCues,
            ...(audioEngineFactory === undefined ? {} : { engineFactory: audioEngineFactory }),
            onChange: (settings) => {
              const normalized = normalizeAudioSettings(settings);
              audioSettingsStore.save(normalized);
              setAudioSettings(normalized);
            },
          }
        : {
            ...shippedAudio,
            settings: audioSettings,
            ...(audioEngineFactory === undefined ? {} : { engineFactory: audioEngineFactory }),
            onChange: (settings) => {
              const normalized = normalizeAudioSettings(settings);
              audioSettingsStore.save(normalized);
              setAudioSettings(normalized);
            },
          },
    [audioEngineFactory, audioSettings, audioSettingsStore, shippedAudio],
  );

  const hudMetrics = useMemo(() => shippedRuntimeHudMetrics(runtime), [runtime]);
  const results = useMemo(() => shippedRuntimeResults(runtime), [runtime]);

  useEffect(() => {
    let cancelled = false;
    const storedAudio = audioSettingsStore.load();
    void loadShippedAudioConfig({
      mapId,
      onChange: (settings) =>
        setAudioSettings({
          ...settings,
          busVolumes: settings.busVolumes ?? {},
        }),
    }).then((loaded) => {
      if (cancelled || loaded === undefined) return;
      setAudioSettings(storedAudio ?? normalizeAudioSettings(loaded.audio.settings));
      setShippedAudio(loaded.audio);
    });
    return () => {
      cancelled = true;
    };
  }, [audioSettingsStore, mapId]);

  useEffect(() => {
    let cancelled = false;
    void loadShippedShellProjection({ mapId, fallbackPluginId: 'tileborne.battle-royale' }).then(
      (loaded) => {
        if (!cancelled) {
          setShellProjection(loaded.projection);
          setShellAssetUrlBase(loaded.sourceUrlBase);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [mapId]);

  const persistSession = useCallback((session: LobbyPanelSession) => {
    const stored = writeStoredLobbyReconnect(session);
    if (stored) {
      setStoredReconnect(stored);
    }
  }, []);

  const createLobby = useCallback(async () => {
    setLobbyStatus('loading');
    setLobbyMessage('Creating lobby…');
    setLobbyError(undefined);
    try {
      const response = await lobbyClient.createLobby({
        mapId: mapId.trim(),
        reserveCreator: true,
        shellProjection,
        ...(displayName.trim().length === 0 ? {} : { playerDisplayName: displayName.trim() }),
      });
      const session = toCreateSession(response);
      setLobbySession(session);
      setJoinCode(response.joinCode);
      persistSession(session);
      setLobbyStatus('ready');
      setLobbyMessage('Lobby created. Share the join code when you are ready.');
    } catch (error) {
      setLobbyStatus('error');
      setLobbyError(errorMessage(error));
      setLobbyMessage(undefined);
    }
  }, [displayName, lobbyClient, mapId, persistSession, shellProjection]);

  const joinLobby = useCallback(async () => {
    setLobbyStatus('loading');
    setLobbyMessage('Joining lobby…');
    setLobbyError(undefined);
    try {
      const response = await lobbyClient.joinLobby({
        joinCode: joinCode.trim(),
        ...(displayName.trim().length === 0 ? {} : { displayName: displayName.trim() }),
      });
      const session = toJoinSession(response);
      setLobbySession(session);
      persistSession(session);
      setLobbyStatus('ready');
      setLobbyMessage('Joined lobby. Ready up when everyone is here.');
    } catch (error) {
      setLobbyStatus('error');
      setLobbyError(errorMessage(error));
      setLobbyMessage(undefined);
    }
  }, [displayName, joinCode, lobbyClient, persistSession]);

  const setReady = useCallback(
    async (ready: boolean) => {
      const playerId = lobbySession?.playerId;
      const reconnectToken = lobbySession?.reconnectToken;
      if (!playerId || !lobbySession) {
        return;
      }
      if (!reconnectToken) {
        setLobbyStatus('error');
        setLobbyError('Missing lobby credentials.');
        setLobbyMessage(undefined);
        return;
      }
      setLobbyStatus('loading');
      setLobbyMessage(ready ? 'Setting ready…' : 'Clearing ready…');
      setLobbyError(undefined);
      try {
        const response = await lobbyClient.setReady(lobbySession.roomId, {
          playerId,
          ready,
          reconnectToken,
        });
        setLobbySession({ ...lobbySession, lobby: response.lobby });
        setLobbyStatus('ready');
        setLobbyMessage(
          response.canStart
            ? 'Everyone is ready. Continue to match when the runtime is connected.'
            : (response.reason ?? 'Ready state updated.'),
        );
      } catch (error) {
        setLobbyStatus('error');
        setLobbyError(errorMessage(error));
        setLobbyMessage(undefined);
      }
    },
    [lobbyClient, lobbySession],
  );

  const reconnectLobby = useCallback(async () => {
    if (!storedReconnect) {
      return;
    }
    setLobbyStatus('loading');
    setLobbyMessage('Reconnecting…');
    setLobbyError(undefined);
    try {
      const response = await lobbyClient.reconnect(storedReconnect);
      const session = toJoinSession(response);
      setLobbySession(session);
      persistSession(session);
      setLobbyStatus('ready');
      setLobbyMessage('Reconnected. Fresh handoff token received.');
    } catch (error) {
      window.localStorage.removeItem(LOBBY_RECONNECT_STORAGE_KEY);
      setStoredReconnect(null);
      setLobbyStatus('error');
      setLobbyError(errorMessage(error));
      setLobbyMessage(undefined);
    }
  }, [lobbyClient, persistSession, storedReconnect]);

  const reconnectPrompt: LobbyReconnectPrompt | null = storedReconnect
    ? { roomId: storedReconnect.roomId, playerId: storedReconnect.playerId }
    : null;

  const beginMatch = useCallback(() => {
    setRuntime(initialShippedRuntimeState(lobbySession?.playerId));
    setRuntimeRender({ snapshot: undefined, entities: [] });
    setShellNavigationRequests([]);
    if (!lobbySession?.wsUrl) {
      return;
    }
    const previousClient = runtimeClientRef.current;
    if (previousClient !== null) {
      void previousClient.closePromise().catch(() => undefined);
    }
    const transport = makeBrowserWebSocketTransport({
      reconnectEndpoint: DEFAULT_ROOM_RECONNECT_PATH,
      ...(lobbySession.reconnectToken === undefined
        ? {}
        : { reconnectToken: lobbySession.reconnectToken }),
      ...(lobbySession.playerId === undefined ? {} : { reconnectPlayerId: lobbySession.playerId }),
    });
    const client = makeNetFrameClient(transport, { roomId: lobbySession.roomId });
    runtimeClientRef.current = client;

    void client.connectPromise(lobbySession.wsUrl).catch(() => {
      if (runtimeClientRef.current === client) {
        runtimeClientRef.current = null;
      }
    });
    void client
      .runFrames((data) => {
        const shellFrame = decodeShellNavigationFrameBytes(data);
        if (shellFrame !== undefined) {
          setShellNavigationRequests((requests) => [...requests, shellFrame]);
          return;
        }
        const frame = decodeShippedRuntimeServerFrame(data);
        if (frame === undefined) return;
        onRuntimeFrame?.(frame, data);
        if (frame.kind === 'initial' || frame.kind === 'delta') {
          void client.sendFramePromise(buildSnapshotAckFrame(frame.tick)).catch(() => undefined);
          setRuntimeRender((current) => {
            const decodedRenderFrame = decodeServerFrame(data);
            const snapshot =
              shippedProjector.mergeFrame?.(current.snapshot, decodedRenderFrame) ??
              decodedRenderFrame;
            return { snapshot, entities: shippedProjector.project(snapshot) };
          });
        }
        setRuntime((state) => applyShippedRuntimeServerFrame(state, frame));
      })
      .finally(() => {
        if (runtimeClientRef.current === client) {
          runtimeClientRef.current = null;
        }
      });
  }, [lobbySession, onRuntimeFrame, shippedProjector]);

  const shellBridge = useMemo<RuntimeShellBehaviorBridge>(
    () => ({
      shellNavigationRequests,
      emitShellEvent: (event) => {
        const client = runtimeClientRef.current;
        if (client === null) {
          return;
        }
        void client.sendFramePromise(encodeShellEventFrameBytes(event)).catch(() => undefined);
      },
    }),
    [shellNavigationRequests],
  );

  return (
    <RuntimeRoot
      brand={defaultBrandConfig}
      sections={battleRoyaleMenuSections}
      audio={audio}
      controls={controls}
      shellBridge={shellBridge}
      shellProjection={shellProjection}
      shellAssetUrlBase={shellAssetUrlBase}
      gameplayAudioEvents={runtime.sequencedEvents}
      {...(hudMetrics === undefined ? {} : { hudMetrics })}
      {...(results === undefined ? {} : { results })}
      renderLobby={({ matchmaking, onStartMatch, onBack }) => (
        <LobbyPanel
          matchmaking={matchmaking}
          status={lobbyStatus}
          session={lobbySession}
          reconnectPrompt={reconnectPrompt}
          displayName={displayName}
          joinCode={joinCode}
          mapId={mapId}
          message={lobbyMessage}
          error={lobbyError}
          onDisplayNameChange={setDisplayName}
          onJoinCodeChange={setJoinCode}
          onMapIdChange={setMapId}
          onCreateLobby={createLobby}
          onJoinLobby={joinLobby}
          onReadyChange={setReady}
          onReconnect={reconnectLobby}
          onStartMatch={() => {
            onStartMatch();
          }}
          onBack={onBack}
        />
      )}
      onMatchStart={beginMatch}
      onQuit={() => window.close()}
      canvas={
        <div
          data-testid="game-canvas"
          style={{ position: 'relative', width: '100%', height: '100%' }}
        >
          <ShippedRuntimeCanvas
            entities={runtimeRender.entities}
            onRendererAdapterReady={onRuntimeRendererReady}
          />
        </div>
      }
    />
  );
}
