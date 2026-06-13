import { CONTROL_SCHEMES, controlScheme } from "@tileborne/core";
import {
  createLocalStorageBindingsStore,
  createGameHostLobbyClient,
  defaultBrandConfig,
  LobbyPanel,
  type LobbyCreateResponse,
  type LobbyJoinResponse,
  type LobbyPanelSession,
  type LobbyPanelStatus,
  type LobbyReconnectPrompt,
  type RoomReconnectResponse,
  type AudioSettingsValue,
  type AudioTabConfig,
  RuntimeRoot,
  type ControlsTabConfig,
} from "@tileborne/game-client";
import {
  battleRoyaleAudioCues,
  battleRoyaleDefaultInputMap,
  battleRoyaleSfxBus,
} from "@tileborne/plugin-battle-royale";
import { battleRoyaleMenuSections } from "@tileborne/plugin-battle-royale/menu";
import { useCallback, useMemo, useState, type ReactElement } from "react";

const DEFAULT_LOBBY_MAP_ID = "map:fixture";
const LOBBY_RECONNECT_STORAGE_KEY = "tileborne.game-client.lobby-reconnect.v1";

interface StoredLobbyReconnect {
  readonly roomId: string;
  readonly playerId: string;
  readonly reconnectToken: string;
}

const isStoredLobbyReconnect = (value: unknown): value is StoredLobbyReconnect => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.roomId === "string" &&
    record.roomId.length > 0 &&
    typeof record.playerId === "string" &&
    record.playerId.length > 0 &&
    typeof record.reconnectToken === "string" &&
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
  error instanceof Error ? error.message : "Lobby request failed";

/**
 * Brand-neutral game-client template app (ADR-0022 decision #3). Mounts the
 * generic shell with the neutral default brand and the battle-royale plugin's
 * menu sections. Products fork/overlay this entry: they pass their own
 * `BrandConfig` (from `branding/tokens.json`) and compose plugin sections with
 * their `menuExtensions` registrations.
 */
export function App(): ReactElement {
  const lobbyClient = useMemo(() => createGameHostLobbyClient(), []);
  const [lobbyStatus, setLobbyStatus] = useState<LobbyPanelStatus>("idle");
  const [lobbyMessage, setLobbyMessage] = useState<string | undefined>(undefined);
  const [lobbyError, setLobbyError] = useState<string | undefined>(undefined);
  const [displayName, setDisplayName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [mapId, setMapId] = useState(DEFAULT_LOBBY_MAP_ID);
  const [lobbySession, setLobbySession] = useState<LobbyPanelSession | null>(null);
  const [audioSettings, setAudioSettings] = useState<AudioSettingsValue>(() => ({
    masterVolume: 1,
    muted: false,
    muteOnFocusLoss: true,
    busVolumes: { [battleRoyaleSfxBus.id]: battleRoyaleSfxBus.defaultVolume },
  }));
  const [storedReconnect, setStoredReconnect] = useState<StoredLobbyReconnect | null>(() =>
    readStoredLobbyReconnect(),
  );

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
    () => ({
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
      onChange: setAudioSettings,
    }),
    [audioSettings],
  );

  const persistSession = useCallback((session: LobbyPanelSession) => {
    const stored = writeStoredLobbyReconnect(session);
    if (stored) {
      setStoredReconnect(stored);
    }
  }, []);

  const createLobby = useCallback(async () => {
    setLobbyStatus("loading");
    setLobbyMessage("Creating lobby…");
    setLobbyError(undefined);
    try {
      const response = await lobbyClient.createLobby({
        mapId: mapId.trim(),
        reserveCreator: true,
        ...(displayName.trim().length === 0 ? {} : { playerDisplayName: displayName.trim() }),
      });
      const session = toCreateSession(response);
      setLobbySession(session);
      setJoinCode(response.joinCode);
      persistSession(session);
      setLobbyStatus("ready");
      setLobbyMessage("Lobby created. Share the join code when you are ready.");
    } catch (error) {
      setLobbyStatus("error");
      setLobbyError(errorMessage(error));
      setLobbyMessage(undefined);
    }
  }, [displayName, lobbyClient, mapId, persistSession]);

  const joinLobby = useCallback(async () => {
    setLobbyStatus("loading");
    setLobbyMessage("Joining lobby…");
    setLobbyError(undefined);
    try {
      const response = await lobbyClient.joinLobby({
        joinCode: joinCode.trim(),
        ...(displayName.trim().length === 0 ? {} : { displayName: displayName.trim() }),
      });
      const session = toJoinSession(response);
      setLobbySession(session);
      persistSession(session);
      setLobbyStatus("ready");
      setLobbyMessage("Joined lobby. Ready up when everyone is here.");
    } catch (error) {
      setLobbyStatus("error");
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
        setLobbyStatus("error");
        setLobbyError("Missing lobby credentials.");
        setLobbyMessage(undefined);
        return;
      }
      setLobbyStatus("loading");
      setLobbyMessage(ready ? "Setting ready…" : "Clearing ready…");
      setLobbyError(undefined);
      try {
        const response = await lobbyClient.setReady(lobbySession.roomId, {
          playerId,
          ready,
          reconnectToken,
        });
        setLobbySession({ ...lobbySession, lobby: response.lobby });
        setLobbyStatus("ready");
        setLobbyMessage(
          response.canStart
            ? "Everyone is ready. Continue to match when the runtime is connected."
            : response.reason ?? "Ready state updated.",
        );
      } catch (error) {
        setLobbyStatus("error");
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
    setLobbyStatus("loading");
    setLobbyMessage("Reconnecting…");
    setLobbyError(undefined);
    try {
      const response = await lobbyClient.reconnect(storedReconnect);
      const session = toJoinSession(response);
      setLobbySession(session);
      persistSession(session);
      setLobbyStatus("ready");
      setLobbyMessage("Reconnected. Fresh handoff token received.");
    } catch (error) {
      window.localStorage.removeItem(LOBBY_RECONNECT_STORAGE_KEY);
      setStoredReconnect(null);
      setLobbyStatus("error");
      setLobbyError(errorMessage(error));
      setLobbyMessage(undefined);
    }
  }, [lobbyClient, persistSession, storedReconnect]);

  const reconnectPrompt: LobbyReconnectPrompt | null = storedReconnect
    ? { roomId: storedReconnect.roomId, playerId: storedReconnect.playerId }
    : null;

  return (
    <RuntimeRoot
      brand={defaultBrandConfig}
      sections={battleRoyaleMenuSections}
      audio={audio}
      controls={controls}
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
          onStartMatch={onStartMatch}
          onBack={onBack}
        />
      )}
      onQuit={() => window.close()}
      canvas={<div data-testid="game-canvas" style={{ width: "100%", height: "100%" }} />}
    />
  );
}
