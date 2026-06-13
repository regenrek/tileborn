import { Button } from "@tileborne/ui";
import type { FormEvent, ReactElement } from "react";

import type { RoomLobbySummary } from "../lobby-client.js";

export type LobbyPanelStatus = "idle" | "loading" | "ready" | "error";

export interface LobbyPanelSession {
  readonly roomId: string;
  readonly playerId?: string;
  readonly joinCode?: string;
  readonly joinUrl?: string;
  readonly wsUrl?: string;
  readonly handoffToken?: string;
  readonly reconnectToken?: string;
  readonly lobby: RoomLobbySummary;
}

export interface LobbyReconnectPrompt {
  readonly roomId: string;
  readonly playerId: string;
}

export interface LobbyPanelProps {
  readonly matchmaking?: boolean;
  readonly status: LobbyPanelStatus;
  readonly session?: LobbyPanelSession | null;
  readonly reconnectPrompt?: LobbyReconnectPrompt | null;
  readonly displayName: string;
  readonly joinCode: string;
  readonly mapId: string;
  readonly message?: string | undefined;
  readonly error?: string | undefined;
  readonly onDisplayNameChange: (value: string) => void;
  readonly onJoinCodeChange: (value: string) => void;
  readonly onMapIdChange: (value: string) => void;
  readonly onCreateLobby: () => void | Promise<void>;
  readonly onJoinLobby: () => void | Promise<void>;
  readonly onReadyChange: (ready: boolean) => void | Promise<void>;
  readonly onReconnect: () => void | Promise<void>;
  readonly onStartMatch: () => void;
  readonly onBack: () => void;
}

const playerLabel = (player: RoomLobbySummary["players"][number]): string =>
  player.displayName ?? player.playerId;

const redactedWebSocketLabel = (wsUrl: string, roomId: string): string => {
  try {
    const parsed = new URL(wsUrl);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}?token=redacted`;
  } catch {
    return `Room ${roomId}`;
  }
};

export function LobbyPanel({
  matchmaking = false,
  status,
  session,
  reconnectPrompt,
  displayName,
  joinCode,
  mapId,
  message,
  error,
  onDisplayNameChange,
  onJoinCodeChange,
  onMapIdChange,
  onCreateLobby,
  onJoinLobby,
  onReadyChange,
  onReconnect,
  onStartMatch,
  onBack,
}: LobbyPanelProps): ReactElement {
  const busy = status === "loading";
  const lobby = session?.lobby;
  const localPlayer = session?.playerId
    ? lobby?.players.find((player) => player.playerId === session.playerId)
    : undefined;
  const localReady = localPlayer?.ready === true;

  const createLobby = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onCreateLobby();
  };

  const joinLobby = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onJoinLobby();
  };

  return (
    <div className="tb-scrim">
      <div className="tb-panel" data-testid="lobby">
        <h2 className="tb-title">{matchmaking ? "Connecting…" : "Lobby"}</h2>
        <p className="tb-tagline">
          {lobby
            ? `${lobby.playerCount} / ${lobby.maxPlayers} players · ${lobby.phase}`
            : "Create a lobby or join with a code."}
        </p>

        {message ? (
          <p className="tb-lobby-status" aria-live="polite" data-testid="lobby-status">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="tb-lobby-error" role="alert" data-testid="lobby-error">
            {error}
          </p>
        ) : null}

        {reconnectPrompt && !session ? (
          <div className="tb-lobby-card" data-testid="lobby-reconnect-prompt">
            <strong>Reconnect available</strong>
            <span>
              Room {reconnectPrompt.roomId}, player {reconnectPrompt.playerId}
            </span>
            <Button type="button" disabled={busy} onClick={() => void onReconnect()}>
              Reconnect
            </Button>
          </div>
        ) : null}

        {!session ? (
          <>
            <div className="tb-section-label">Player</div>
            <label className="tb-lobby-field">
              <span>Display name</span>
              <input
                value={displayName}
                onChange={(event) => onDisplayNameChange(event.currentTarget.value)}
                placeholder="Player"
                data-testid="lobby-display-name"
              />
            </label>

            <form onSubmit={createLobby} className="tb-lobby-form">
              <label className="tb-lobby-field">
                <span>Map ID</span>
                <input
                  value={mapId}
                  onChange={(event) => onMapIdChange(event.currentTarget.value)}
                  placeholder="map:fixture"
                  data-testid="lobby-map-id"
                />
              </label>
              <Button type="submit" disabled={busy || mapId.trim().length === 0} data-testid="create-lobby">
                Create lobby
              </Button>
            </form>

            <form onSubmit={joinLobby} className="tb-lobby-form">
              <label className="tb-lobby-field">
                <span>Join code</span>
                <input
                  value={joinCode}
                  onChange={(event) => onJoinCodeChange(event.currentTarget.value.toUpperCase())}
                  placeholder="ABC234"
                  data-testid="lobby-join-code"
                />
              </label>
              <Button type="submit" disabled={busy || joinCode.trim().length === 0} data-testid="join-lobby">
                Join lobby
              </Button>
            </form>
          </>
        ) : (
          <>
            <div className="tb-lobby-card">
              <strong>Join code</strong>
              <span data-testid="lobby-code">{session.joinCode ?? lobby?.lobby.joinCode ?? "Private"}</span>
              {session.wsUrl ? (
                <small data-testid="lobby-ws-url">{redactedWebSocketLabel(session.wsUrl, session.roomId)}</small>
              ) : (
                <small data-testid="lobby-ws-url">Room {session.roomId}</small>
              )}
            </div>

            <div className="tb-section-label">Players</div>
            <ul className="tb-lobby-presence" data-testid="lobby-presence-list">
              {lobby?.players.map((player) => (
                <li key={player.playerId} data-testid={`lobby-player-${player.playerId}`}>
                  <span>{playerLabel(player)}</span>
                  <span>{player.status}</span>
                  <span>{player.ready ? "Ready" : "Not ready"}</span>
                </li>
              ))}
            </ul>

            <div className="tb-actions">
              {session.playerId ? (
                <Button
                  type="button"
                  disabled={busy}
                  aria-pressed={localReady}
                  onClick={() => void onReadyChange(!localReady)}
                  data-testid="ready-toggle"
                >
                  {localReady ? "Unready" : "Ready up"}
                </Button>
              ) : null}
              <Button
                type="button"
                disabled={!session.wsUrl || !session.handoffToken}
                onClick={onStartMatch}
                data-testid="start-match"
              >
                Continue to match
              </Button>
            </div>
          </>
        )}

        <div className="tb-actions" style={{ marginTop: "1rem" }}>
          <Button variant="outline" onClick={onBack} data-testid="lobby-back">
            Back
          </Button>
        </div>
      </div>
    </div>
  );
}
