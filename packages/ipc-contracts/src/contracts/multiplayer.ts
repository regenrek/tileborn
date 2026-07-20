import type { JsonObject } from '@tileborne/core';

export type MultiplayerRoomLifecyclePhase =
  | 'lobby'
  | 'countdown'
  | 'active'
  | 'finished'
  | 'archived';
export type MultiplayerRoomLobbyVisibility = 'private' | 'public';
export type MultiplayerRoomPlayerRole = 'owner' | 'participant';
export type MultiplayerRoomPlayerPresenceStatus = 'connected' | 'disconnected';
export type MultiplayerRoomResultOutcome = 'completed' | 'abandoned' | 'cancelled';

export interface MultiplayerRoomPlayerModelSelection {
  readonly playerId: string;
  readonly modelId: string;
}

export interface MultiplayerGameShellProjection {
  readonly schemaVersion: number;
  readonly pluginId: string;
  readonly entryScreenId: string;
  readonly screens: readonly unknown[];
  readonly screenOrder: readonly string[];
  readonly assets: readonly unknown[];
  readonly tokens: unknown;
  readonly registeredEvents: readonly unknown[];
  readonly diagnostics: readonly unknown[];
}

export interface MultiplayerRoomLobbyState {
  readonly visibility: MultiplayerRoomLobbyVisibility;
  readonly joinCode?: string;
  readonly title?: string;
  readonly createdByPlayerId?: string;
}

export interface MultiplayerRoomPresenceProjection {
  readonly playerId: string;
  readonly role: MultiplayerRoomPlayerRole;
  readonly status: MultiplayerRoomPlayerPresenceStatus;
  readonly ready: boolean;
  readonly reconnectEligible: boolean;
  readonly lastSeenAt: string | null;
  readonly displayName?: string;
  readonly connectedAt?: string;
  readonly disconnectedAt?: string;
}

export interface MultiplayerRoomLobbySummary {
  readonly roomId: string;
  readonly mapId: string;
  readonly phase: MultiplayerRoomLifecyclePhase;
  readonly lobby: MultiplayerRoomLobbyState;
  readonly playerCount: number;
  readonly maxPlayers: number;
  readonly minReadyPlayers: number;
  readonly canStart: boolean;
  readonly players: readonly MultiplayerRoomPresenceProjection[];
}

export interface MultiplayerRoomPlayerResultSummary {
  readonly playerId: string;
  readonly outcome?: MultiplayerRoomResultOutcome;
  readonly placement?: number;
  readonly score?: number;
}

export interface MultiplayerRoomResultsSummary {
  readonly completedAt: string;
  readonly reason?: string;
  readonly players: readonly MultiplayerRoomPlayerResultSummary[];
}

export interface MultiplayerRoomCreateRequest {
  readonly mapId: string;
  readonly seed?: string | number;
  readonly options?: Record<string, string | number | boolean | null>;
  readonly mapPackage?: JsonObject;
  readonly shellProjection?: MultiplayerGameShellProjection;
  readonly playerModelSelections?: readonly MultiplayerRoomPlayerModelSelection[];
}

export interface MultiplayerRoomCreateResponse {
  readonly roomId: string;
  readonly wsUrl: string;
}

export interface MultiplayerLobbyCreateRequest extends MultiplayerRoomCreateRequest {
  readonly displayName?: string;
  readonly visibility?: MultiplayerRoomLobbyVisibility;
  readonly reserveCreator?: boolean;
  readonly playerId?: string;
  readonly playerDisplayName?: string;
}

export interface MultiplayerLobbyCreateResponse extends MultiplayerRoomCreateResponse {
  readonly joinCode: string;
  readonly joinUrl: string;
  readonly playerId?: string;
  readonly handoffToken?: string;
  readonly reconnectToken?: string;
  readonly lobby: MultiplayerRoomLobbySummary;
}

export interface MultiplayerLobbyJoinRequest {
  readonly joinCode: string;
  readonly displayName?: string;
  readonly playerId?: string;
}

export interface MultiplayerLobbyJoinResponse {
  readonly roomId: string;
  readonly playerId: string;
  readonly wsUrl: string;
  readonly handoffToken: string;
  readonly reconnectToken?: string;
  readonly lobby: MultiplayerRoomLobbySummary;
}

export interface MultiplayerLobbyReadyRequest {
  readonly playerId: string;
  readonly ready: boolean;
  readonly reconnectToken?: string;
}

export interface MultiplayerLobbyReadyResponse {
  readonly lobby: MultiplayerRoomLobbySummary;
  readonly canStart: boolean;
  readonly reason?: string;
}

export interface MultiplayerRoomOwnerActionRequest {
  readonly playerId: string;
  readonly reconnectToken?: string;
}

export type MultiplayerLobbyStartRequest = MultiplayerRoomOwnerActionRequest;

export interface MultiplayerLobbyStartResponse {
  readonly lobby: MultiplayerRoomLobbySummary;
  readonly started: boolean;
  readonly reason?: string;
}

export type MultiplayerRoomStopRequest = MultiplayerRoomOwnerActionRequest;

export interface MultiplayerRoomStopResponse {
  readonly roomId: string;
  readonly stopped: boolean;
  readonly lobby: MultiplayerRoomLobbySummary;
  readonly results: MultiplayerRoomResultsSummary | null;
}

export interface MultiplayerRoomReconnectRequest {
  readonly roomId: string;
  readonly playerId: string;
  readonly reconnectToken: string;
}

export interface MultiplayerRoomReconnectResponse {
  readonly roomId: string;
  readonly playerId: string;
  readonly wsUrl: string;
  readonly handoffToken: string;
  readonly reconnectToken?: string;
  readonly lobby: MultiplayerRoomLobbySummary;
}

export interface MultiplayerRoomResultsResponse {
  readonly roomId: string;
  readonly results: MultiplayerRoomResultsSummary | null;
}

export interface MultiplayerRoomDiagnostics {
  readonly roomId: string;
  readonly phase: MultiplayerRoomLifecyclePhase;
  readonly ownerPlayerId?: string;
  readonly playerCount: number;
  readonly readyPlayerCount: number;
  readonly connectedPlayerCount: number;
  readonly reconnectEligiblePlayerCount: number;
  readonly generatedAt: string;
  readonly issues: readonly string[];
}

export interface MultiplayerRoomDiagnosticsResponse {
  readonly diagnostics: MultiplayerRoomDiagnostics;
}

export interface MultiplayerTransportMetrics {
  readonly trackedClients: number;
  readonly maxPendingSnapshotLagTicks: number;
  readonly totalDroppedOutboundFrames: number;
  readonly totalResyncs: number;
  readonly totalStaleSnapshotAcks: number;
}

export interface MultiplayerRoomMetricsResponse {
  readonly roomId: string;
  readonly metrics: MultiplayerSessionMetrics;
}

export interface MultiplayerSessionMetrics {
  readonly lifecyclePhase: MultiplayerRoomLifecyclePhase;
  readonly tick: number;
  readonly baseTick: number;
  readonly lastPersistedTick: number;
  readonly playerCount: number;
  readonly connectedClients: number;
  readonly queuedInputPlayers: number;
  readonly queuedInputs: number;
  readonly pendingPluginFrames: number;
  readonly replayFrames: number;
  readonly generatedAt: string;
  readonly transport: MultiplayerTransportMetrics;
}
