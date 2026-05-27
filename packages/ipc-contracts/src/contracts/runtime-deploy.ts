import { Schema } from "effect";

import { BuildId, ContentHash } from "@tileborne/core";

import { defineContract } from "../contract.js";
import { createRegistry } from "../registry.js";
import { EmptyResponse, IpcContractErrors } from "./common.js";
import { JobId } from "./assets.js";

export const DeploymentId = Schema.String.check(Schema.isPattern(/^deployment:[0-9a-f-]{36}$/)).pipe(
  Schema.brand("DeploymentId"),
);

export const RuntimeDeployTargetView = Schema.Struct({
  stage: Schema.Literals(["local", "dev", "staging", "production"]),
  workerName: Schema.String,
});

export const DeploymentSummary = Schema.Struct({
  id: DeploymentId,
  buildId: BuildId,
  target: RuntimeDeployTargetView,
  createdAt: Schema.String,
  integrityHash: ContentHash,
});

export const RuntimeDeployDeployRequest = Schema.Struct({
  buildId: BuildId,
  target: RuntimeDeployTargetView,
});
export const RuntimeDeployDeployResponse = Schema.Struct({
  jobId: JobId,
});

export const RuntimeDeployGetDeploymentRequest = Schema.Struct({
  deploymentId: DeploymentId,
});
export const RuntimeDeployGetDeploymentResponse = Schema.Struct({
  deployment: DeploymentSummary,
});

export const RuntimeDeployListDeploymentsRequest = Schema.Struct({
  buildId: BuildId,
});
export const RuntimeDeployListDeploymentsResponse = Schema.Struct({
  deployments: Schema.Array(DeploymentSummary),
});

export const RuntimeDeployDeleteDeploymentRequest = Schema.Struct({
  deploymentId: DeploymentId,
});

export const RuntimeDeployDeployContract = defineContract({
  channel: "tileborne:runtime-deploy:deploy",
  request: RuntimeDeployDeployRequest,
  response: RuntimeDeployDeployResponse,
  errors: IpcContractErrors,
  meta: { timeoutMs: 120_000 },
});

export const RuntimeDeployGetDeploymentContract = defineContract({
  channel: "tileborne:runtime-deploy:getDeployment",
  request: RuntimeDeployGetDeploymentRequest,
  response: RuntimeDeployGetDeploymentResponse,
  errors: IpcContractErrors,
});

export const RuntimeDeployListDeploymentsContract = defineContract({
  channel: "tileborne:runtime-deploy:listDeployments",
  request: RuntimeDeployListDeploymentsRequest,
  response: RuntimeDeployListDeploymentsResponse,
  errors: IpcContractErrors,
});

export const RuntimeDeployDeleteDeploymentContract = defineContract({
  channel: "tileborne:runtime-deploy:deleteDeployment",
  request: RuntimeDeployDeleteDeploymentRequest,
  response: EmptyResponse,
  errors: IpcContractErrors,
});

export const RuntimeDeployContracts = [
  RuntimeDeployDeployContract,
  RuntimeDeployGetDeploymentContract,
  RuntimeDeployListDeploymentsContract,
  RuntimeDeployDeleteDeploymentContract,
] as const;

export const RuntimeDeployIpcRegistry = createRegistry(RuntimeDeployContracts);
