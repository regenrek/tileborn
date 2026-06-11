import { randomUUID } from "node:crypto";

import { AssetPackManifest } from "@tileborne/asset-pipeline";
import {
  BuildId,
  ContentHash,
  MapId,
  ProjectId,
  ProjectManifest,
  TileborneMap,
  type Uuid,
  makeBuildId,
} from "@tileborne/core";
import { Option, Schema } from "effect";

export const BuildTarget = Schema.Literals(["cloudflare", "node", "web"]);
export type BuildTarget = Schema.Schema.Type<typeof BuildTarget>;

export const ExportId = Schema.String.check(Schema.isPattern(/^export:[0-9a-f-]{36}$/)).pipe(
  Schema.brand("ExportId"),
);
export type ExportId = Schema.Schema.Type<typeof ExportId>;

export const PlaytestSessionId = Schema.String.check(
  Schema.isPattern(/^playtest:[0-9a-f-]{36}$/),
).pipe(Schema.brand("PlaytestSessionId"));
export type PlaytestSessionId = Schema.Schema.Type<typeof PlaytestSessionId>;

export const DeploymentId = Schema.String.check(Schema.isPattern(/^deployment:[0-9a-f-]{36}$/)).pipe(
  Schema.brand("DeploymentId"),
);
export type DeploymentId = Schema.Schema.Type<typeof DeploymentId>;

export const SupportBundleId = Schema.String.check(Schema.isPattern(/^support:[0-9a-f-]{36}$/)).pipe(
  Schema.brand("SupportBundleId"),
);
export type SupportBundleId = Schema.Schema.Type<typeof SupportBundleId>;

export const makeNewBuildId = (): BuildId => makeBuildId(randomUUID() as Uuid);
export const makeExportId = (): ExportId => `export:${randomUUID()}` as ExportId;
export const makePlaytestSessionId = (): PlaytestSessionId =>
  `playtest:${randomUUID()}` as PlaytestSessionId;
export const makeDeploymentId = (): DeploymentId => `deployment:${randomUUID()}` as DeploymentId;
export const makeSupportBundleId = (): SupportBundleId => `support:${randomUUID()}` as SupportBundleId;

export const emptyContentHash =
  "sha256:0000000000000000000000000000000000000000000000000000000000000000" as ContentHash;

export class BuildOptions extends Schema.Class<BuildOptions>("BuildOptions")({
  target: Schema.OptionFromOptional(BuildTarget),
  delayMs: Schema.OptionFromOptional(Schema.Number),
}) {}

export class BuildArtifact extends Schema.Class<BuildArtifact>("BuildArtifact")({
  id: BuildId,
  projectId: ProjectId,
  target: BuildTarget,
  createdAt: Schema.String,
  directory: Schema.String,
  manifestPath: Schema.String,
  project: ProjectManifest,
  maps: Schema.Array(TileborneMap),
  assetPacks: Schema.Array(AssetPackManifest),
  integrityHash: ContentHash,
}) {}

export class BuildSummary extends Schema.Class<BuildSummary>("BuildSummary")({
  id: BuildId,
  projectId: ProjectId,
  target: BuildTarget,
  createdAt: Schema.String,
  integrityHash: ContentHash,
}) {}

export class CloudflareWorkerExportTarget extends Schema.TaggedClass<CloudflareWorkerExportTarget>()(
  "CloudflareWorkerExportTarget",
  {
    environment: Schema.OptionFromOptional(Schema.Literals(["local", "dev", "staging", "production"])),
  },
) {}

export class NodeExportTarget extends Schema.TaggedClass<NodeExportTarget>()("NodeExportTarget", {
  entrypoint: Schema.OptionFromOptional(Schema.String),
}) {}

export class WebExportTarget extends Schema.TaggedClass<WebExportTarget>()("WebExportTarget", {
  basePath: Schema.OptionFromOptional(Schema.String),
}) {}

export const ExportTarget = Schema.Union([CloudflareWorkerExportTarget, NodeExportTarget, WebExportTarget]);
export type ExportTarget = Schema.Schema.Type<typeof ExportTarget>;

export interface EditorExporterContext {
  readonly build: BuildArtifact;
  readonly exportId: ExportId;
  readonly target: ExportTarget;
  readonly outputDirectory: string;
}

export class ExportOptions extends Schema.Class<ExportOptions>("ExportOptions")({
  delayMs: Schema.OptionFromOptional(Schema.Number),
}) {}

export class ExportArtifact extends Schema.Class<ExportArtifact>("ExportArtifact")({
  id: ExportId,
  buildId: BuildId,
  target: ExportTarget,
  createdAt: Schema.String,
  directory: Schema.String,
  manifestPath: Schema.String,
  invokedHooks: Schema.Array(Schema.String),
  integrityHash: ContentHash,
}) {}

export class PlaytestOptions extends Schema.Class<PlaytestOptions>("PlaytestOptions")({
  slot: Schema.OptionFromOptional(Schema.String),
  runtimeUrl: Schema.OptionFromOptional(Schema.String),
  delayMs: Schema.OptionFromOptional(Schema.Number),
}) {}

export class Starting extends Schema.TaggedClass<Starting>()("Starting", {}) {}
export class Running extends Schema.TaggedClass<Running>()("Running", {}) {}
export class Stopped extends Schema.TaggedClass<Stopped>()("Stopped", {}) {}
export class Failed extends Schema.TaggedClass<Failed>()("Failed", { message: Schema.String }) {}

export const PlaytestSessionStatus = Schema.Union([Starting, Running, Stopped, Failed]);
export type PlaytestSessionStatus = Schema.Schema.Type<typeof PlaytestSessionStatus>;

export class PlaytestSession extends Schema.Class<PlaytestSession>("PlaytestSession")({
  id: PlaytestSessionId,
  projectId: ProjectId,
  mapId: MapId,
  status: PlaytestSessionStatus,
  startedAt: Schema.String,
  stoppedAt: Schema.OptionFromOptional(Schema.String),
  runtimeUrl: Schema.OptionFromOptional(Schema.String),
  artifactDirectory: Schema.OptionFromOptional(Schema.String),
  activePlugins: Schema.Array(Schema.String),
}) {}

export class RuntimeDeployCredentials extends Schema.Class<RuntimeDeployCredentials>(
  "RuntimeDeployCredentials",
)({
  accountId: Schema.String,
  apiToken: Schema.String,
}) {}

export class RuntimeDeployTarget extends Schema.TaggedClass<RuntimeDeployTarget>()(
  "RuntimeDeployTarget",
  {
    stage: Schema.Literals(["local", "dev", "staging", "production"]),
    workerName: Schema.String,
    credentials: Schema.OptionFromOptional(RuntimeDeployCredentials),
  },
) {}

export class RuntimeDeployOptions extends Schema.Class<RuntimeDeployOptions>("RuntimeDeployOptions")({
  delayMs: Schema.OptionFromOptional(Schema.Number),
}) {}

export class RuntimeDeployment extends Schema.Class<RuntimeDeployment>("RuntimeDeployment")({
  id: DeploymentId,
  buildId: BuildId,
  target: RuntimeDeployTarget,
  createdAt: Schema.String,
  endpoint: Schema.String,
  manifestPath: Schema.String,
  integrityHash: ContentHash,
}) {}

export class SupportBundleOptions extends Schema.Class<SupportBundleOptions>("SupportBundleOptions")({
  includeLogs: Schema.OptionFromOptional(Schema.Boolean),
  includeConfig: Schema.OptionFromOptional(Schema.Boolean),
  delayMs: Schema.OptionFromOptional(Schema.Number),
}) {}

export class SupportBundle extends Schema.Class<SupportBundle>("SupportBundle")({
  id: SupportBundleId,
  createdAt: Schema.String,
  directory: Schema.String,
  manifestPath: Schema.String,
  redactedFiles: Schema.Array(Schema.String),
  integrityHash: ContentHash,
}) {}

export class ServicesBuildError extends Schema.TaggedErrorClass<ServicesBuildError>()(
  "ServicesBuildError",
  {
    path: Schema.OptionFromOptional(Schema.String),
    message: Schema.String,
  },
) {}

export class IntegrityMismatchError extends Schema.TaggedErrorClass<IntegrityMismatchError>()(
  "IntegrityMismatchError",
  {
    path: Schema.String,
    expected: ContentHash,
    actual: ContentHash,
    message: Schema.String,
  },
) {}

export class BuildNotFoundError extends Schema.TaggedErrorClass<BuildNotFoundError>()("BuildNotFoundError", {
  buildId: BuildId,
  message: Schema.String,
}) {}

export class ExportNotFoundError extends Schema.TaggedErrorClass<ExportNotFoundError>()(
  "ExportNotFoundError",
  {
    exportId: ExportId,
    message: Schema.String,
  },
) {}

export class PlaytestSessionNotFoundError extends Schema.TaggedErrorClass<PlaytestSessionNotFoundError>()(
  "PlaytestSessionNotFoundError",
  {
    sessionId: PlaytestSessionId,
    message: Schema.String,
  },
) {}

export class DeploymentNotFoundError extends Schema.TaggedErrorClass<DeploymentNotFoundError>()(
  "DeploymentNotFoundError",
  {
    deploymentId: DeploymentId,
    message: Schema.String,
  },
) {}

export class SupportBundleNotFoundError extends Schema.TaggedErrorClass<SupportBundleNotFoundError>()(
  "SupportBundleNotFoundError",
  {
    bundleId: SupportBundleId,
    message: Schema.String,
  },
) {}

export class RuntimeDeployAuthError extends Schema.TaggedErrorClass<RuntimeDeployAuthError>()(
  "RuntimeDeployAuthError",
  {
    buildId: BuildId,
    message: Schema.String,
  },
) {}

export const emptyBuildOptions = new BuildOptions({
  target: Option.none(),
  delayMs: Option.none(),
});

export const emptyExportOptions = new ExportOptions({
  delayMs: Option.none(),
});

export const PlaytestTarget = Schema.Literals(["headless", "browser"]);
export type PlaytestTarget = Schema.Schema.Type<typeof PlaytestTarget>;

export class PlaytestArtifactManifest extends Schema.Class<PlaytestArtifactManifest>(
  "PlaytestArtifactManifest",
)({
  mapId: MapId,
  projectId: ProjectId,
  plugins: Schema.Array(Schema.String),
  createdAt: Schema.String,
  integrityHash: ContentHash,
}) {}

export class PlaytestArtifact extends Schema.Class<PlaytestArtifact>("PlaytestArtifact")({
  directory: Schema.String,
  manifestPath: Schema.String,
  indexPath: Schema.String,
  manifest: PlaytestArtifactManifest,
}) {}

export class PlaytestHeadlessResult extends Schema.Class<PlaytestHeadlessResult>("PlaytestHeadlessResult")({
  ticks: Schema.Number,
  durationSec: Schema.Number,
  hookSummary: Schema.Record(Schema.String, Schema.Number),
}) {}

export class GameBuildOptions extends Schema.Class<GameBuildOptions>("GameBuildOptions")({
  pluginId: Schema.String,
  target: BuildTarget,
  outputDirectory: Schema.OptionFromOptional(Schema.String),
  assetPackIds: Schema.OptionFromOptional(Schema.Array(Schema.String)),
  siteName: Schema.OptionFromOptional(Schema.String),
}) {}

export class GameBuildArtifact extends Schema.Class<GameBuildArtifact>("GameBuildArtifact")({
  pluginId: Schema.String,
  target: BuildTarget,
  directory: Schema.String,
  manifestPath: Schema.String,
  bundlePath: Schema.String,
  integrityHash: ContentHash,
  createdAt: Schema.String,
  files: Schema.Array(Schema.String),
}) {}
