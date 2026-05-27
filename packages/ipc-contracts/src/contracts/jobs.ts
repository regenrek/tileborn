import { Schema } from "effect";

import { defineContract } from "../contract.js";
import { createRegistry } from "../registry.js";
import { IpcContractErrors } from "./common.js";
import { JobId } from "./assets.js";

export const JobStatusTag = Schema.Union([
  Schema.Literal("Pending"),
  Schema.Literal("Running"),
  Schema.Literal("Completed"),
  Schema.Literal("Failed"),
  Schema.Literal("Cancelled"),
]);

export const JobStateView = Schema.Struct({
  id: JobId,
  status: JobStatusTag,
  progress: Schema.optional(Schema.Number),
  result: Schema.optional(Schema.Unknown),
  errorMessage: Schema.optional(Schema.String),
});

export const JobsListRequest = Schema.Struct({});
export const JobsListResponse = Schema.Struct({
  jobs: Schema.Array(JobStateView),
});

export const JobsGetRequest = Schema.Struct({
  jobId: JobId,
});
export const JobsGetResponse = Schema.Struct({
  job: JobStateView,
});

export const JobsCancelRequest = Schema.Struct({
  jobId: JobId,
});
export const JobsCancelResponse = Schema.Struct({
  job: JobStateView,
});

export const JobsListContract = defineContract({
  channel: "tileborne:jobs:list",
  request: JobsListRequest,
  response: JobsListResponse,
  errors: IpcContractErrors,
});

export const JobsGetContract = defineContract({
  channel: "tileborne:jobs:get",
  request: JobsGetRequest,
  response: JobsGetResponse,
  errors: IpcContractErrors,
});

export const JobsCancelContract = defineContract({
  channel: "tileborne:jobs:cancel",
  request: JobsCancelRequest,
  response: JobsCancelResponse,
  errors: IpcContractErrors,
});

export const JobsContracts = [JobsListContract, JobsGetContract, JobsCancelContract] as const;

export const JobsIpcRegistry = createRegistry(JobsContracts);
