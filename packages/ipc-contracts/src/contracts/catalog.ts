import { Schema } from 'effect';

import {
  GameObjectType,
  GameObjectTypeId,
  ItemDefinition,
  LootTable,
  PluginId,
  ProjectId,
} from '@tileborne/core';

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

export const CatalogContracts = [
  CatalogResolveContract,
  CatalogValidateContract,
  CatalogImportContract,
  CatalogExportContract,
] as const;

export const CatalogIpcRegistry = createRegistry(CatalogContracts);
