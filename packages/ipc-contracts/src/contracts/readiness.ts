import { Schema } from 'effect';

import {
  BehaviorId,
  BehaviorNodeId,
  BehaviorSourceKind,
  MapId,
  ObjectId,
  ProjectId,
} from '@tileborne/core';

import { defineContract } from '../contract.js';
import { createRegistry } from '../registry.js';
import { IpcContractErrors } from './common.js';

export const ReadinessPurpose = Schema.Literals(['authoring', 'playtest', 'build']);
export type ReadinessPurpose = typeof ReadinessPurpose.Type;

export const ReadinessSeverity = Schema.Literals(['error', 'warning', 'info']);
export type ReadinessSeverity = typeof ReadinessSeverity.Type;

export const ReadinessSource = Schema.Literals([
  'project',
  'map',
  'catalog',
  'asset',
  'visual-model',
  'behavior',
  'game-mode',
  'audio',
  'game-shell',
  'build',
]);
export type ReadinessSource = typeof ReadinessSource.Type;

export const ReadinessNavigationKind = Schema.Literals([
  'project-settings',
  'map',
  'map-object',
  'catalog',
  'asset-library',
  'player-model',
  'behavior',
  'game-shell',
]);
export type ReadinessNavigationKind = typeof ReadinessNavigationKind.Type;

/** Stable, renderer-agnostic deep-link carried by every actionable problem. */
export class ReadinessNavigationTarget extends Schema.Class<ReadinessNavigationTarget>(
  'ReadinessNavigationTarget',
)({
  kind: ReadinessNavigationKind,
  projectId: ProjectId,
  mapId: Schema.optional(MapId),
  objectId: Schema.optional(ObjectId),
  objectTypeId: Schema.optional(Schema.String),
  modelId: Schema.optional(Schema.String),
  behaviorId: Schema.optional(BehaviorId),
  behaviorNodeId: Schema.optional(BehaviorNodeId),
  sourceKind: Schema.optional(BehaviorSourceKind),
  path: Schema.optional(Schema.String),
  line: Schema.optional(Schema.Int),
  column: Schema.optional(Schema.Int),
}) {}

/** Canonical problem model shared by authoring UI and execution gates. */
export class ReadinessDiagnostic extends Schema.Class<ReadinessDiagnostic>('ReadinessDiagnostic')({
  id: Schema.String,
  code: Schema.String,
  severity: ReadinessSeverity,
  source: ReadinessSource,
  title: Schema.String,
  message: Schema.String,
  projectId: ProjectId,
  mapId: Schema.optional(MapId),
  behaviorId: Schema.optional(BehaviorId),
  behaviorNodeId: Schema.optional(BehaviorNodeId),
  sourceKind: Schema.optional(BehaviorSourceKind),
  path: Schema.optional(Schema.String),
  line: Schema.optional(Schema.Int),
  column: Schema.optional(Schema.Int),
  navigation: Schema.optional(ReadinessNavigationTarget),
}) {}

export class ReadinessReport extends Schema.Class<ReadinessReport>('ReadinessReport')({
  ok: Schema.Boolean,
  purpose: ReadinessPurpose,
  diagnostics: Schema.Array(ReadinessDiagnostic),
}) {}

export const ReadinessCheckRequest = Schema.Struct({
  projectId: ProjectId,
  mapId: Schema.optional(MapId),
  purpose: ReadinessPurpose,
});

export const ReadinessCheckResponse = Schema.Struct({
  report: ReadinessReport,
});

export const ReadinessCheckContract = defineContract({
  channel: 'tileborne:readiness:check',
  request: ReadinessCheckRequest,
  response: ReadinessCheckResponse,
  errors: IpcContractErrors,
});

export const ReadinessContracts = [ReadinessCheckContract] as const;
export const ReadinessIpcRegistry = createRegistry(ReadinessContracts);
