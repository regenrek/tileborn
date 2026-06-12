import { Schema } from "effect";

import { BuildId, ContentHash, ProjectId } from "@tileborne/core";

import { defineContract } from "../contract.js";
import { createRegistry } from "../registry.js";
import { EmptyResponse, IpcContractErrors } from "./common.js";
import { JobId } from "./assets.js";

export const BuildTarget = Schema.Literals(["cloudflare", "local"]);

export const BuildSummary = Schema.Struct({
  id: BuildId,
  projectId: ProjectId,
  target: BuildTarget,
  createdAt: Schema.String,
  integrityHash: ContentHash,
});

export const BuildsBuildRequest = Schema.Struct({
  projectId: ProjectId,
  target: Schema.optional(BuildTarget),
});
export const BuildsBuildResponse = Schema.Struct({
  jobId: JobId,
});

export const BuildsGetBuildRequest = Schema.Struct({
  buildId: BuildId,
});
export const BuildsGetBuildResponse = Schema.Struct({
  build: BuildSummary,
});

export const BuildsListBuildsRequest = Schema.Struct({
  projectId: ProjectId,
});
export const BuildsListBuildsResponse = Schema.Struct({
  builds: Schema.Array(BuildSummary),
});

export const BuildsDeleteBuildRequest = Schema.Struct({
  buildId: BuildId,
});

export const BuildsBuildContract = defineContract({
  channel: "tileborne:builds:build",
  request: BuildsBuildRequest,
  response: BuildsBuildResponse,
  errors: IpcContractErrors,
  meta: { timeoutMs: 120_000 },
});

export const BuildsGetBuildContract = defineContract({
  channel: "tileborne:builds:getBuild",
  request: BuildsGetBuildRequest,
  response: BuildsGetBuildResponse,
  errors: IpcContractErrors,
});

export const BuildsListBuildsContract = defineContract({
  channel: "tileborne:builds:listBuilds",
  request: BuildsListBuildsRequest,
  response: BuildsListBuildsResponse,
  errors: IpcContractErrors,
});

export const BuildsDeleteBuildContract = defineContract({
  channel: "tileborne:builds:deleteBuild",
  request: BuildsDeleteBuildRequest,
  response: EmptyResponse,
  errors: IpcContractErrors,
});

export const BuildsContracts = [
  BuildsBuildContract,
  BuildsGetBuildContract,
  BuildsListBuildsContract,
  BuildsDeleteBuildContract,
] as const;

export const BuildsIpcRegistry = createRegistry(BuildsContracts);
