import { Schema } from 'effect';

import {
  BehaviorActionNode,
  BehaviorCapabilityId,
  BehaviorCondition,
  BehaviorDefinition,
  BehaviorDiagnostic,
  BehaviorId,
  BehaviorInvocation,
  BehaviorManifest,
  BehaviorNodeId,
  BehaviorReference,
  BehaviorRegistryManifest,
  BehaviorStateField,
  BehaviorTemplate,
  PluginId,
  ProjectId,
} from '@tileborne/core';

import { defineContract } from '../contract.js';
import { createRegistry } from '../registry.js';
import { IpcContractErrors } from './common.js';

export const VisualBehaviorResourceView = Schema.Struct({
  kind: Schema.Literal('visual'),
  manifest: BehaviorManifest,
  definition: BehaviorDefinition,
});

export const TypeScriptBehaviorResourceView = Schema.Struct({
  kind: Schema.Literal('typescript'),
  manifest: BehaviorManifest,
  source: Schema.String,
});

export const BehaviorResourceView = Schema.Union([
  VisualBehaviorResourceView,
  TypeScriptBehaviorResourceView,
]);

export const BehaviorUseSiteView = Schema.Struct({
  behaviorId: BehaviorId,
  referencedByBehaviorId: BehaviorId,
  nodeId: Schema.optional(BehaviorNodeId),
  path: Schema.String,
});

export const BehaviorProjectSnapshot = Schema.Struct({
  projectId: ProjectId,
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  trust: Schema.Literals(['trusted', 'imported-untrusted']),
  resources: Schema.Array(BehaviorResourceView),
  useSites: Schema.Array(BehaviorUseSiteView),
  diagnostics: Schema.Array(BehaviorDiagnostic),
});

export const BehaviorsOpenRequest = Schema.Struct({ projectId: ProjectId });
export const BehaviorsOpenResponse = Schema.Struct({ snapshot: BehaviorProjectSnapshot });

export const VisualBehaviorDraft = Schema.Struct({
  state: Schema.Array(BehaviorStateField),
  when: BehaviorInvocation,
  if: Schema.optional(BehaviorCondition),
  do: Schema.Array(BehaviorActionNode),
});

export const BehaviorsCreateVisualRequest = Schema.Struct({
  projectId: ProjectId,
  label: Schema.String,
  definition: VisualBehaviorDraft,
  requiredCapabilities: Schema.optional(Schema.Array(BehaviorCapabilityId)),
});
export const BehaviorsCreateVisualResponse = BehaviorsOpenResponse;

export const BehaviorsSaveVisualRequest = Schema.Struct({
  projectId: ProjectId,
  behaviorId: BehaviorId,
  expectedRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  label: Schema.String,
  definition: BehaviorDefinition,
  requiredCapabilities: Schema.optional(Schema.Array(BehaviorCapabilityId)),
});
export const BehaviorsSaveVisualResponse = BehaviorsOpenResponse;

export const BehaviorsConvertToTypeScriptRequest = Schema.Struct({
  projectId: ProjectId,
  behaviorId: BehaviorId,
  expectedRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export const BehaviorsConvertToTypeScriptResponse = BehaviorsOpenResponse;

export const BehaviorsSaveTypeScriptRequest = Schema.Struct({
  projectId: ProjectId,
  behaviorId: BehaviorId,
  expectedRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  label: Schema.String,
  source: Schema.String,
  exportName: Schema.optional(Schema.String),
  requiredCapabilities: Schema.optional(Schema.Array(BehaviorCapabilityId)),
});
export const BehaviorsSaveTypeScriptResponse = BehaviorsOpenResponse;

export const BehaviorsRemoveRequest = Schema.Struct({
  projectId: ProjectId,
  behaviorId: BehaviorId,
  expectedRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  force: Schema.optional(Schema.Boolean),
});
export const BehaviorsRemoveResponse = BehaviorsOpenResponse;

export const BehaviorsRegistryRequest = Schema.Struct({ projectId: ProjectId });
export const BehaviorReferenceKind = Schema.Literals(['entity', 'asset', 'catalog', 'behavior']);
export type BehaviorReferenceKind = typeof BehaviorReferenceKind.Type;
export const BehaviorReferenceOptionView = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  reference: BehaviorReference,
  previewUrl: Schema.optional(Schema.String),
  detail: Schema.optional(Schema.String),
});
export const BehaviorsRegistryResponse = Schema.Struct({
  registry: BehaviorRegistryManifest,
  templates: Schema.Array(BehaviorTemplate),
  entryOwners: Schema.Record(Schema.String, Schema.Union([Schema.Literal('core'), PluginId])),
  templateOwners: Schema.Record(Schema.String, Schema.Union([Schema.Literal('core'), PluginId])),
});

export const BehaviorsReferencesRequest = Schema.Struct({
  projectId: ProjectId,
  kind: BehaviorReferenceKind,
  query: Schema.optional(Schema.String),
  offset: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  limit: Schema.optional(
    Schema.Int.pipe(
      Schema.check(Schema.isGreaterThanOrEqualTo(1)),
      Schema.check(Schema.isLessThanOrEqualTo(64)),
    ),
  ),
});
export const BehaviorsReferencesResponse = Schema.Struct({
  kind: BehaviorReferenceKind,
  query: Schema.String,
  offset: Schema.Int,
  limit: Schema.Int,
  total: Schema.Int,
  options: Schema.Array(BehaviorReferenceOptionView),
});
export const BehaviorsResolveReferencesRequest = Schema.Struct({
  projectId: ProjectId,
  references: Schema.Array(BehaviorReference).check(Schema.isMaxLength(64)),
});
export const BehaviorsResolveReferencesResponse = Schema.Struct({
  options: Schema.Array(BehaviorReferenceOptionView),
  missing: Schema.Array(BehaviorReference),
});

export const BehaviorsOpenContract = defineContract({
  channel: 'tileborne:behaviors:open',
  request: BehaviorsOpenRequest,
  response: BehaviorsOpenResponse,
  errors: IpcContractErrors,
});
export const BehaviorsCreateVisualContract = defineContract({
  channel: 'tileborne:behaviors:createVisual',
  request: BehaviorsCreateVisualRequest,
  response: BehaviorsCreateVisualResponse,
  errors: IpcContractErrors,
});
export const BehaviorsSaveVisualContract = defineContract({
  channel: 'tileborne:behaviors:saveVisual',
  request: BehaviorsSaveVisualRequest,
  response: BehaviorsSaveVisualResponse,
  errors: IpcContractErrors,
});
export const BehaviorsConvertToTypeScriptContract = defineContract({
  channel: 'tileborne:behaviors:convertToTypeScript',
  request: BehaviorsConvertToTypeScriptRequest,
  response: BehaviorsConvertToTypeScriptResponse,
  errors: IpcContractErrors,
});
export const BehaviorsSaveTypeScriptContract = defineContract({
  channel: 'tileborne:behaviors:saveTypeScript',
  request: BehaviorsSaveTypeScriptRequest,
  response: BehaviorsSaveTypeScriptResponse,
  errors: IpcContractErrors,
});
export const BehaviorsRemoveContract = defineContract({
  channel: 'tileborne:behaviors:remove',
  request: BehaviorsRemoveRequest,
  response: BehaviorsRemoveResponse,
  errors: IpcContractErrors,
  meta: { requiresApproval: true },
});
export const BehaviorsRegistryContract = defineContract({
  channel: 'tileborne:behaviors:registry',
  request: BehaviorsRegistryRequest,
  response: BehaviorsRegistryResponse,
  errors: IpcContractErrors,
});
export const BehaviorsReferencesContract = defineContract({
  channel: 'tileborne:behaviors:references',
  request: BehaviorsReferencesRequest,
  response: BehaviorsReferencesResponse,
  errors: IpcContractErrors,
});
export const BehaviorsResolveReferencesContract = defineContract({
  channel: 'tileborne:behaviors:resolveReferences',
  request: BehaviorsResolveReferencesRequest,
  response: BehaviorsResolveReferencesResponse,
  errors: IpcContractErrors,
});

export const BehaviorsContracts = [
  BehaviorsOpenContract,
  BehaviorsCreateVisualContract,
  BehaviorsSaveVisualContract,
  BehaviorsConvertToTypeScriptContract,
  BehaviorsSaveTypeScriptContract,
  BehaviorsRemoveContract,
  BehaviorsRegistryContract,
  BehaviorsReferencesContract,
  BehaviorsResolveReferencesContract,
] as const;

export const BehaviorsRegistry = createRegistry(BehaviorsContracts);
