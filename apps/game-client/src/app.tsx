import { CONTROL_SCHEMES, PERSISTED_SCHEMA_VERSIONS, controlScheme } from '@tileborne/core';
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
  battleRoyaleAudioCues,
  battleRoyaleDefaultInputMap,
  battleRoyaleSfxBus,
} from '@tileborne/plugin-battle-royale';
import { battleRoyaleMenuSections } from '@tileborne/plugin-battle-royale/menu';
import type { RuntimeGameShellProjection } from '@tileborne/runtime';
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

interface AppProps {
  readonly audioEngineFactory?:
    | ((config: BrowserRuntimeAudioEngineConfig) => RuntimeAudioPlaybackEngine)
    | undefined;
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

const normalizeAudioSettings = (settings: AudioSettingsValue): AudioSettingsValue => ({
  ...settings,
  busVolumes: settings.busVolumes ?? {},
});

/**
 * Brand-neutral game-client template app (ADR-0022 decision #3). Mounts the
 * generic shell with the neutral default brand and the battle-royale plugin's
 * menu sections. Products fork/overlay this entry: they pass their own
 * `BrandConfig` (from `branding/tokens.json`) and compose plugin sections with
 * their `menuExtensions` registrations.
 */
export function App({ audioEngineFactory }: AppProps = {}): ReactElement {
  const lobbyClient = useMemo(() => createGameHostLobbyClient(), []);
  const audioSettingsStore = useMemo(() => createAudioUserSettingsStore(), []);
  const runtimeSocketRef = useRef<WebSocket | null>(null);
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
    setShellNavigationRequests([]);
    if (!lobbySession?.wsUrl) {
      return;
    }
    runtimeSocketRef.current?.close();
    const socket = new WebSocket(lobbySession.wsUrl);
    runtimeSocketRef.current = socket;
    socket.binaryType = 'arraybuffer';
    socket.addEventListener('message', (event: MessageEvent) => {
      const handleData = (data: unknown): void => {
        const shellFrame = decodeShippedShellNavigationFrame(data);
        if (shellFrame !== undefined) {
          setShellNavigationRequests((requests) => [...requests, shellFrame]);
          return;
        }
        const frame = decodeShippedRuntimeServerFrame(data);
        if (frame === undefined) return;
        if (frame.kind === 'initial' || frame.kind === 'delta') {
          const ackFrame = buildSnapshotAckFrame(frame.tick);
          const ackBuffer = new ArrayBuffer(ackFrame.byteLength);
          new Uint8Array(ackBuffer).set(ackFrame);
          socket.send(ackBuffer);
        }
        setRuntime((state) => applyShippedRuntimeServerFrame(state, frame));
      };
      if (event.data instanceof Blob) {
        void event.data.arrayBuffer().then(handleData);
        return;
      }
      handleData(event.data);
    });
    socket.addEventListener('close', () => {
      if (runtimeSocketRef.current === socket) {
        runtimeSocketRef.current = null;
      }
    });
  }, [lobbySession]);

  const shellBridge = useMemo<RuntimeShellBehaviorBridge>(
    () => ({
      shellNavigationRequests,
      emitShellEvent: (event) => {
        const socket = runtimeSocketRef.current;
        if (socket === null || socket.readyState !== WebSocket.OPEN) {
          return;
        }
        socket.send(encodeShippedShellEventFrame(event));
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
      canvas={<div data-testid="game-canvas" style={{ width: '100%', height: '100%' }} />}
    />
  );
}
