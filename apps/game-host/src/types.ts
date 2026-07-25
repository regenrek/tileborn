import { PERSISTED_SCHEMA_VERSIONS, type ContentHash, type JsonObject } from '@tileborne/core';
import type { RuntimeBehaviorArtifactIdentity } from '@tileborne/runtime/behavior';
import type {
  MultiplayerLobbyCreateRequest,
  MultiplayerLobbyCreateResponse,
  MultiplayerLobbyJoinRequest,
  MultiplayerLobbyJoinResponse,
  MultiplayerLobbyStartRequest,
  MultiplayerLobbyStartResponse,
  MultiplayerLobbyReadyRequest,
  MultiplayerLobbyReadyResponse,
  MultiplayerRoomDiagnosticsResponse,
  MultiplayerRoomCreateRequest,
  MultiplayerRoomCreateResponse,
  MultiplayerRoomLobbySummary,
  MultiplayerRoomMetricsResponse,
  MultiplayerRoomReconnectRequest,
  MultiplayerRoomReconnectResponse,
  MultiplayerRoomResultsResponse,
  MultiplayerRoomStopRequest,
  MultiplayerRoomStopResponse,
  MultiplayerSessionMetrics,
  MultiplayerTransportMetrics,
} from '@tileborne/ipc-contracts/contracts/multiplayer';

export type {
  RoomJoinCode,
  RoomLifecyclePhase,
  RoomLobbyState,
  RoomLobbyVisibility,
  RoomPlayerModelSelection,
  RoomPlayerPresenceRecord,
  RoomPlayerPresenceStatus,
  RoomPlayerReadyRecord,
  RoomReadyState,
  RoomReconnectSeatRecord,
  RoomReconnectState,
  RoomResultsSummary,
} from './rooms/storage-schema.js';
export type { RoomPresenceProjection } from './rooms/room-lifecycle.js';

/** Matches `@tileborne/runtime` PROTOCOL_VERSION SSOT. */
export const PROTOCOL_VERSION = 1;

/** Canonical bundled-manifest shape shared by worker, CLI, and build pipeline. */
export interface BundledManifestFileEntry {
  readonly path: string;
  readonly hash: ContentHash;
  readonly size: number;
}

export interface BundledPluginSummary {
  readonly id: string;
  readonly version: string;
  readonly files: readonly BundledManifestFileEntry[];
}

export interface BundledAssetPackSummary {
  readonly id: string;
  readonly version: string;
  readonly files: readonly BundledManifestFileEntry[];
}

/**
 * One `RuntimeMapPackage` baked into the build (ADR-0030 / M5 S1): the
 * canonical on-disk package files live under `maps/<mapId>/` in the artifact
 * and are summarized here with hashes like every other bundled file group.
 */
export interface BundledMapPackageSummary {
  readonly mapId: string;
  readonly packageId: string;
  readonly files: readonly BundledManifestFileEntry[];
}

/**
 * One bundled `RuntimeMapPackage` as the worker consumes it: the encoded wire
 * JSON baked into the worker bundle so `/rooms/create` can boot rooms without
 * a caller-supplied `mapPackage`.
 */
export interface BundledMapPackage {
  readonly mapId: string;
  readonly packageId: string;
  readonly mapPackage: JsonObject;
}

/** One statically bundled compiled behavior associated with its runtime package. */
export interface BundledBehaviorModule {
  readonly packageId: string;
  readonly artifact: RuntimeBehaviorArtifactIdentity;
  readonly code: string;
  /** Inert at service bootstrap; invokes user top-level code only for its targeted request. */
  readonly createNamespace: () => Readonly<Record<string, unknown>>;
}

export interface BundledManifest {
  readonly schemaVersion: typeof PERSISTED_SCHEMA_VERSIONS.bundledGameManifest;
  readonly buildId: ContentHash;
  readonly plugin: BundledPluginSummary;
  readonly assetPacks: readonly BundledAssetPackSummary[];
  readonly maps: readonly BundledMapPackageSummary[];
  readonly runtimeVersion: string;
  readonly protocolVersion: number;
  /**
   * CONVENTION (fixed-point, pinned by ship-pipeline-boundary.test.ts):
   * `workerFiles` entries hash the PRE-EMBED worker bytes — the pass-1 bundle
   * built with an empty `workerFiles` manifest embedded. The builder then
   * re-bundles embedding this final manifest, so the shipped `worker.js` does
   * NOT hash to these entries (every other manifest section hashes the exact
   * on-disk bytes). `buildId` covers the worker via these pre-embed hashes;
   * verifiers must not compare `sha256(worker.js)` against `workerFiles`.
   */
  readonly workerFiles: readonly BundledManifestFileEntry[];
  readonly createdAt: string;
}

export interface BundledManifestDiscoverSummary {
  readonly plugin: { readonly id: string; readonly version: string };
  readonly assetPacks: readonly { readonly id: string; readonly version: string }[];
  readonly maps: readonly { readonly mapId: string; readonly packageId: string }[];
  readonly runtimeVersion: string;
  readonly protocolVersion: number;
  readonly buildId: ContentHash;
}

export interface PlaytestStartRequest {
  readonly options?: Record<string, string | number | boolean | null>;
  readonly playerId?: string;
}

export interface PlaytestStartResponse {
  readonly playtestId: string;
  readonly wsUrl: string;
  readonly handoffToken: string;
  readonly reconnectToken?: string;
  readonly playerId: string;
}

export interface RoomPlayerReservationResponse {
  readonly playerId: string;
}

export type RoomCreateRequest = MultiplayerRoomCreateRequest;
export type RoomCreateResponse = MultiplayerRoomCreateResponse;
export type RoomLobbySummary = MultiplayerRoomLobbySummary;
export type LobbyCreateRequest = MultiplayerLobbyCreateRequest;
export type LobbyCreateResponse = MultiplayerLobbyCreateResponse;
export type LobbyJoinRequest = MultiplayerLobbyJoinRequest;
export type LobbyJoinResponse = MultiplayerLobbyJoinResponse;
export type LobbyReadyRequest = MultiplayerLobbyReadyRequest;
export type LobbyReadyResponse = MultiplayerLobbyReadyResponse;
export type LobbyStartRequest = MultiplayerLobbyStartRequest;
export type LobbyStartResponse = MultiplayerLobbyStartResponse;
export type RoomReconnectRequest = MultiplayerRoomReconnectRequest;
export type RoomReconnectResponse = MultiplayerRoomReconnectResponse;
export type RoomResultsResponse = MultiplayerRoomResultsResponse;
export type RoomStopRequest = MultiplayerRoomStopRequest;
export type RoomStopResponse = MultiplayerRoomStopResponse;
export type RoomDiagnosticsResponse = MultiplayerRoomDiagnosticsResponse;
export type RoomMetricsResponse = MultiplayerRoomMetricsResponse;

export interface PlaytestSummary {
  readonly playtestId: string;
  readonly mapId: string;
  readonly createdAt: string;
  readonly lastTickAt: string | null;
  readonly connectedClients: number;
  readonly metrics: PlaytestSessionMetrics;
}

export type PlaytestTransportMetrics = MultiplayerTransportMetrics;
export type PlaytestSessionMetrics = MultiplayerSessionMetrics;

export interface PlaytestRoomMeta {
  readonly mapId: string;
  readonly createdAt: string;
  readonly lastTickAt: string | null;
  readonly seed?: string | number;
}

export interface PlaytestRoomStub {
  fetch(request: Request): Promise<Response>;
}

export interface PlaytestRoomNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): PlaytestRoomStub;
}

/**
 * Static-assets fetcher (Cloudflare Workers `assets` binding). When present, the
 * worker serves the shipped game-client bundle (apps/game-client `dist/`) for
 * non-API/non-WS requests (ADR-0022 decision #3: the game-host serves the
 * client static assets). Optional so existing playtest deployments keep working.
 */
export interface StaticAssetsFetcher {
  fetch(request: Request): Promise<Response>;
}

/** Dedicated workerd service that owns all untrusted behavior execution. */
export interface BehaviorRuntimeFetcher {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  readonly PLAYTEST_ROOM: PlaytestRoomNamespace;
  readonly HANDOFF_SIGNING_KEY?: string;
  readonly ROOM_IDLE_TIMEOUT_SECONDS?: number;
  readonly HEARTBEAT_TIMEOUT_SECONDS?: number | string;
  readonly ROOM_RECONNECT_WINDOW_SECONDS?: number | string;
  readonly SITE_NAME?: string;
  readonly ASSETS?: StaticAssetsFetcher;
  readonly BEHAVIOR_RUNTIME?: BehaviorRuntimeFetcher;
}

declare const __WORKER_VERSION__: string;
declare const __BUILD_ID__: string;
declare const __SMOKE_CONTROL_ENABLED__: boolean;

export const workerVersion = (): string => __WORKER_VERSION__;
export const workerBuildId = (): ContentHash => __BUILD_ID__ as ContentHash;
export const smokeControlEnabled = (): boolean => __SMOKE_CONTROL_ENABLED__;

export const toDiscoverSummary = (manifest: BundledManifest): BundledManifestDiscoverSummary => ({
  plugin: { id: manifest.plugin.id, version: manifest.plugin.version },
  assetPacks: manifest.assetPacks.map((pack) => ({ id: pack.id, version: pack.version })),
  maps: manifest.maps.map((map) => ({ mapId: map.mapId, packageId: map.packageId })),
  runtimeVersion: manifest.runtimeVersion,
  protocolVersion: manifest.protocolVersion,
  buildId: manifest.buildId,
});

export const defaultProtocolVersion = PROTOCOL_VERSION;
