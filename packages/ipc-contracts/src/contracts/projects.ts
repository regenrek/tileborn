import { Schema } from "effect";

import { ProjectId, ProjectManifest } from "@tileborne/core";

import { defineContract } from "../contract.js";
import { createRegistry } from "../registry.js";
import { EmptyResponse, IpcContractErrors } from "./common.js";

export const ProjectSummary = Schema.Struct({
  id: ProjectId,
  name: Schema.String,
  engineVersion: Schema.String,
  mapCount: Schema.Number,
  assetPackCount: Schema.Number,
  pluginCount: Schema.Number,
  path: Schema.String,
});

export const ProjectsListRequest = Schema.Struct({});
export const ProjectsListResponse = Schema.Struct({
  projects: Schema.Array(ProjectSummary),
});

export const ProjectsGetRequest = Schema.Struct({
  projectId: ProjectId,
});
export const ProjectsGetResponse = Schema.Struct({
  project: ProjectManifest,
});

export const ProjectsCreateRequest = Schema.Struct({
  name: Schema.String,
  engineVersion: Schema.optional(Schema.String),
});
export const ProjectsCreateResponse = Schema.Struct({
  projectId: ProjectId,
});

export const ProjectsUpdateRequest = Schema.Struct({
  project: ProjectManifest,
});

export const ProjectsDeleteRequest = Schema.Struct({
  projectId: ProjectId,
});

export const ProjectsOpenRequest = Schema.Struct({
  projectId: ProjectId,
});
export const ProjectsOpenResponse = ProjectsGetResponse;

export const ProjectsCloseRequest = Schema.Struct({
  projectId: ProjectId,
});

export const ProjectsListContract = defineContract({
  channel: "tileborne:projects:list",
  request: ProjectsListRequest,
  response: ProjectsListResponse,
  errors: IpcContractErrors,
});

export const ProjectsGetContract = defineContract({
  channel: "tileborne:projects:get",
  request: ProjectsGetRequest,
  response: ProjectsGetResponse,
  errors: IpcContractErrors,
});

export const ProjectsCreateContract = defineContract({
  channel: "tileborne:projects:create",
  request: ProjectsCreateRequest,
  response: ProjectsCreateResponse,
  errors: IpcContractErrors,
  meta: { timeoutMs: 30_000, requiresApproval: true },
});

export const ProjectsUpdateContract = defineContract({
  channel: "tileborne:projects:update",
  request: ProjectsUpdateRequest,
  response: EmptyResponse,
  errors: IpcContractErrors,
  meta: { timeoutMs: 30_000 },
});

export const ProjectsDeleteContract = defineContract({
  channel: "tileborne:projects:delete",
  request: ProjectsDeleteRequest,
  response: EmptyResponse,
  errors: IpcContractErrors,
  meta: { timeoutMs: 30_000, requiresApproval: true },
});

export const ProjectsOpenContract = defineContract({
  channel: "tileborne:projects:open",
  request: ProjectsOpenRequest,
  response: ProjectsOpenResponse,
  errors: IpcContractErrors,
  meta: { timeoutMs: 30_000 },
});

export const ProjectsCloseContract = defineContract({
  channel: "tileborne:projects:close",
  request: ProjectsCloseRequest,
  response: EmptyResponse,
  errors: IpcContractErrors,
});

export const ProjectsImportFromDirectoryRequest = Schema.Struct({
  path: Schema.String,
});
export const ProjectsImportFromDirectoryResponse = Schema.Struct({
  projectId: ProjectId,
});

export const ProjectsExportArchiveRequest = Schema.Struct({
  projectId: ProjectId,
  destinationDirectory: Schema.String,
});
export const ProjectsExportArchiveResponse = Schema.Struct({
  archivePath: Schema.String,
});

export const ProjectsImportFromDirectoryContract = defineContract({
  channel: "tileborne:projects:importFromDirectory",
  request: ProjectsImportFromDirectoryRequest,
  response: ProjectsImportFromDirectoryResponse,
  errors: IpcContractErrors,
  meta: { timeoutMs: 120_000, requiresApproval: true },
});

export const ProjectsExportArchiveContract = defineContract({
  channel: "tileborne:projects:exportArchive",
  request: ProjectsExportArchiveRequest,
  response: ProjectsExportArchiveResponse,
  errors: IpcContractErrors,
  meta: { timeoutMs: 120_000 },
});

export const ProjectsContracts = [
  ProjectsListContract,
  ProjectsGetContract,
  ProjectsCreateContract,
  ProjectsUpdateContract,
  ProjectsDeleteContract,
  ProjectsOpenContract,
  ProjectsCloseContract,
  ProjectsImportFromDirectoryContract,
  ProjectsExportArchiveContract,
] as const;

export const ProjectsIpcRegistry = createRegistry(ProjectsContracts);
