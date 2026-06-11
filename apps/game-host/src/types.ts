import type { ContentHash, JsonObject } from '@tileborne/core';

import type { RoomLifecyclePhase, RoomPlayerModelSelection } from './rooms/storage-schema.js';

export type { RoomLifecyclePhase, RoomPlayerModelSelection } from './rooms/storage-schema.js';

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

export interface BundledManifest {
  readonly schemaVersion: 1;
  readonly buildId: ContentHash;
  readonly plugin: BundledPluginSummary;
  readonly assetPacks: readonly BundledAssetPackSummary[];
  readonly runtimeVersion: string;
  readonly protocolVersion: number;
  readonly workerFiles: readonly BundledManifestFileEntry[];
  readonly createdAt: string;
}

export interface BundledManifestDiscoverSummary {
  readonly plugin: { readonly id: string; readonly version: string };
  readonly assetPacks: readonly { readonly id: string; readonly version: string }[];
  readonly runtimeVersion: string;
  readonly protocolVersion: number;
  readonly buildId: ContentHash;
}

export interface PlaytestStartRequest {
  readonly mapId: string;
  readonly seed?: string | number;
  readonly options?: Record<string, string | number | boolean | null>;
  /** Encoded `RuntimeMapPackage` wire JSON the room runtime boots from (ADR-0030). */
  readonly mapPackage?: JsonObject;
  readonly playerModelSelections?: readonly RoomPlayerModelSelection[];
  readonly playerId?: string;
}

export interface PlaytestStartResponse {
  readonly playtestId: string;
  readonly wsUrl: string;
  readonly handoffToken: string;
  readonly playerId: string;
}

export interface RoomPlayerReservationResponse {
  readonly playerId: string;
}

export interface RoomCreateRequest {
  readonly mapId: string;
  readonly seed?: string | number;
  readonly options?: Record<string, string | number | boolean | null>;
  /** Encoded `RuntimeMapPackage` wire JSON the room runtime boots from (ADR-0030). */
  readonly mapPackage?: JsonObject;
  readonly playerModelSelections?: readonly RoomPlayerModelSelection[];
}

export interface RoomCreateResponse {
  readonly roomId: string;
  readonly wsUrl: string;
}

export interface PlaytestSummary {
  readonly playtestId: string;
  readonly mapId: string;
  readonly createdAt: string;
  readonly lastTickAt: string | null;
  readonly connectedClients: number;
  readonly metrics: PlaytestSessionMetrics;
}

export interface PlaytestTransportMetrics {
  readonly trackedClients: number;
  readonly maxPendingSnapshotLagTicks: number;
  readonly totalDroppedOutboundFrames: number;
  readonly totalResyncs: number;
  readonly totalStaleSnapshotAcks: number;
}

export interface PlaytestSessionMetrics {
  readonly lifecyclePhase: RoomLifecyclePhase;
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
  readonly transport: PlaytestTransportMetrics;
}

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

export interface Env {
  readonly PLAYTEST_ROOM: PlaytestRoomNamespace;
  readonly HANDOFF_SIGNING_KEY?: string;
  readonly ROOM_IDLE_TIMEOUT_SECONDS?: number;
  readonly HEARTBEAT_TIMEOUT_SECONDS?: number | string;
  readonly SITE_NAME?: string;
  readonly ASSETS?: StaticAssetsFetcher;
}

declare const __WORKER_VERSION__: string;
declare const __BUILD_ID__: string;

export const workerVersion = (): string => __WORKER_VERSION__;
export const workerBuildId = (): ContentHash => __BUILD_ID__ as ContentHash;

export const toDiscoverSummary = (manifest: BundledManifest): BundledManifestDiscoverSummary => ({
  plugin: { id: manifest.plugin.id, version: manifest.plugin.version },
  assetPacks: manifest.assetPacks.map((pack) => ({ id: pack.id, version: pack.version })),
  runtimeVersion: manifest.runtimeVersion,
  protocolVersion: manifest.protocolVersion,
  buildId: manifest.buildId,
});

export const defaultProtocolVersion = PROTOCOL_VERSION;
