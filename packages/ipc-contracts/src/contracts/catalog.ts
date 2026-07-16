import { Schema } from 'effect';

import {
  GameObjectType,
  GameObjectTypeId,
  ItemDefinition,
  LootTable,
  PluginId,
  ProjectId,
} from '@tileborne/core';
import {
  ProjectDefinitionProvenance,
  WeaponCatalogEntry,
} from '@tileborne/plugin-api';

import { defineContract } from '../contract.js';
import { createRegistry } from '../registry.js';
import { IpcContractErrors } from './common.js';

/**
 * Browse/inspect projection of one merged catalog entry. Reuses the pure
 * `@tileborne/core` `GameObjectType` schema across the boundary (single source
 * of truth, mirroring how `contracts/maps.ts` reuses `TileborneMap`); the only
 * added shape is the thin origin wrapper.
 */
export const GameObjectCatalogEntryView = Schema.Struct({
  objectType: GameObjectType,
  origin: Schema.Literals(['plugin', 'project']),
  /** Present when `origin === "plugin"`. */
  sourcePluginId: Schema.optional(PluginId),
});
export type GameObjectCatalogEntryView = typeof GameObjectCatalogEntryView.Type;

/** Discoverable weapon picker entry; runtime data stays simulation-owned. */
export const WeaponCatalogEntryView = Schema.Struct({
  entry: WeaponCatalogEntry,
  label: Schema.String,
  origin: Schema.Literals(['plugin', 'project']),
  sourcePluginId: Schema.optional(PluginId),
  provenance: Schema.optional(ProjectDefinitionProvenance),
});
export type WeaponCatalogEntryView = typeof WeaponCatalogEntryView.Type;

export const ProjectDefinitionKind = Schema.Literals([
  'object-type',
  'weapon',
  'item',
  'loot-table',
]);
export type ProjectDefinitionKind = typeof ProjectDefinitionKind.Type;

/** Structured, navigable validation issue (its own ipc-contracts type). */
export class CatalogValidationIssue extends Schema.Class<CatalogValidationIssue>(
  'CatalogValidationIssue',
)({
  kind: Schema.Literals(['duplicate-type', 'unknown-reference', 'coherence']),
  objectTypeId: Schema.optional(GameObjectTypeId),
  refKind: Schema.optional(Schema.String),
  missingId: Schema.optional(Schema.String),
  message: Schema.String,
}) {}

/** Aggregated, click-navigable validation report for the editor diagnostics drawer. */
export class CatalogValidationReport extends Schema.Class<CatalogValidationReport>(
  'CatalogValidationReport',
)({
  ok: Schema.Boolean,
  issues: Schema.Array(CatalogValidationIssue),
}) {}

/** `tileborne:catalog:resolve` — the merged (plugin + project) catalog for one project. */
export const CatalogResolveRequest = Schema.Struct({
  projectId: ProjectId,
});
export const CatalogResolveResponse = Schema.Struct({
  objectTypes: Schema.Array(GameObjectCatalogEntryView),
  lootTables: Schema.Array(LootTable),
  items: Schema.Array(ItemDefinition),
  weapons: Schema.Array(WeaponCatalogEntryView),
  /** Immutable creation provenance for every project-owned definition family. */
  definitionProvenance: Schema.Record(Schema.String, ProjectDefinitionProvenance),
});

/** `tileborne:catalog:validate` — validate the project fragment merged with plugin catalogs. */
export const CatalogValidateRequest = Schema.Struct({
  projectId: ProjectId,
});
export const CatalogValidateResponse = Schema.Struct({
  report: CatalogValidationReport,
});

/**
 * `tileborne:catalog:import` — decode + validate an incoming pack, returning a
 * report before persisting. `catalogJson` is the raw, not-yet-validated pack:
 * the main-process handler runs `decodeGameObjectCatalog` + `validateCatalog`
 * and surfaces a report, so the boundary must tolerate malformed input rather
 * than reject it via a `GameObjectCatalog` decode.
 */
export const CatalogImportRequest = Schema.Struct({
  projectId: ProjectId,
  catalogJson: Schema.Unknown,
});
export const CatalogImportResponse = Schema.Struct({
  imported: Schema.Boolean,
  report: CatalogValidationReport,
});

/**
 * `tileborne:catalog:export` — serialize the project-authored catalog fragment
 * to a `GameObjectCatalog` JSON pack. Symmetric with import: the wire shape is
 * the serialized pack (`catalogJson`), keeping import/export round-trippable.
 */
export const CatalogExportRequest = Schema.Struct({
  projectId: ProjectId,
});
export const CatalogExportResponse = Schema.Struct({
  catalogJson: Schema.Unknown,
});

/**
 * `tileborne:catalog:upsertType` — create or replace ONE project-authored
 * `GameObjectType` in the project catalog fragment (entity editor authoring
 * loop). `objectTypeJson` is the serialized type (same boundary rule as
 * `catalogJson` on import: the main handler decodes + reports rather than
 * rejecting at the wire). Saving is NOT gated on a clean merged report —
 * authors must be able to persist work-in-progress entities (e.g. a weapon
 * before its projectile companion exists); the returned report surfaces the
 * remaining issues. Only plugin-id collisions and decode failures reject.
 */
export const CatalogUpsertTypeRequest = Schema.Struct({
  projectId: ProjectId,
  objectTypeJson: Schema.Unknown,
});
export const CatalogUpsertTypeResponse = Schema.Struct({
  saved: Schema.Boolean,
  report: CatalogValidationReport,
});

/** `tileborne:catalog:removeType` — delete one project-authored type from the fragment. */
export const CatalogRemoveTypeRequest = Schema.Struct({
  projectId: ProjectId,
  objectTypeId: GameObjectTypeId,
});
export const CatalogRemoveTypeResponse = Schema.Struct({
  removed: Schema.Boolean,
});

/** Genre-neutral CRUD boundary for every project-owned definition family. */
export const CatalogUpsertDefinitionRequest = Schema.Struct({
  projectId: ProjectId,
  kind: ProjectDefinitionKind,
  definitionJson: Schema.Unknown,
  label: Schema.optional(Schema.String),
});
export const CatalogUpsertDefinitionResponse = CatalogUpsertTypeResponse;

export const CatalogDuplicateDefinitionRequest = Schema.Struct({
  projectId: ProjectId,
  kind: ProjectDefinitionKind,
  definitionId: Schema.String,
  label: Schema.optional(Schema.String),
});
export const CatalogDuplicateDefinitionResponse = Schema.Struct({
  duplicated: Schema.Boolean,
  definitionId: Schema.optional(Schema.String),
  report: CatalogValidationReport,
});

export const CatalogRemoveDefinitionRequest = Schema.Struct({
  projectId: ProjectId,
  kind: ProjectDefinitionKind,
  definitionId: Schema.String,
});
export const CatalogRemoveDefinitionResponse = Schema.Struct({
  removed: Schema.Boolean,
  blockedBy: Schema.Array(Schema.String),
});

export const CatalogResolveContract = defineContract({
  channel: 'tileborne:catalog:resolve',
  request: CatalogResolveRequest,
  response: CatalogResolveResponse,
  errors: IpcContractErrors,
});

export const CatalogValidateContract = defineContract({
  channel: 'tileborne:catalog:validate',
  request: CatalogValidateRequest,
  response: CatalogValidateResponse,
  errors: IpcContractErrors,
});

export const CatalogImportContract = defineContract({
  channel: 'tileborne:catalog:import',
  request: CatalogImportRequest,
  response: CatalogImportResponse,
  errors: IpcContractErrors,
  meta: { requiresApproval: true },
});

export const CatalogExportContract = defineContract({
  channel: 'tileborne:catalog:export',
  request: CatalogExportRequest,
  response: CatalogExportResponse,
  errors: IpcContractErrors,
});

export const CatalogUpsertTypeContract = defineContract({
  channel: 'tileborne:catalog:upsertType',
  request: CatalogUpsertTypeRequest,
  response: CatalogUpsertTypeResponse,
  errors: IpcContractErrors,
});

export const CatalogRemoveTypeContract = defineContract({
  channel: 'tileborne:catalog:removeType',
  request: CatalogRemoveTypeRequest,
  response: CatalogRemoveTypeResponse,
  errors: IpcContractErrors,
});

export const CatalogUpsertDefinitionContract = defineContract({
  channel: 'tileborne:catalog:upsertDefinition',
  request: CatalogUpsertDefinitionRequest,
  response: CatalogUpsertDefinitionResponse,
  errors: IpcContractErrors,
});

export const CatalogDuplicateDefinitionContract = defineContract({
  channel: 'tileborne:catalog:duplicateDefinition',
  request: CatalogDuplicateDefinitionRequest,
  response: CatalogDuplicateDefinitionResponse,
  errors: IpcContractErrors,
});

export const CatalogRemoveDefinitionContract = defineContract({
  channel: 'tileborne:catalog:removeDefinition',
  request: CatalogRemoveDefinitionRequest,
  response: CatalogRemoveDefinitionResponse,
  errors: IpcContractErrors,
});

export const CatalogContracts = [
  CatalogResolveContract,
  CatalogValidateContract,
  CatalogImportContract,
  CatalogExportContract,
  CatalogUpsertTypeContract,
  CatalogRemoveTypeContract,
  CatalogUpsertDefinitionContract,
  CatalogDuplicateDefinitionContract,
  CatalogRemoveDefinitionContract,
] as const;

export const CatalogIpcRegistry = createRegistry(CatalogContracts);
