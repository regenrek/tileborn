import { Option, Schema } from 'effect';

import { PackId } from '../ids.js';

export const PackCapabilitySource = Schema.Literals([
  'tileborne',
  'tiled-tileset',
  'tiled-map',
  'asset-only',
]);
export type PackCapabilitySource = typeof PackCapabilitySource.Type;

export const PackCapabilityDiagnosticSeverity = Schema.Literals(['error', 'warning', 'info']);
export type PackCapabilityDiagnosticSeverity = typeof PackCapabilityDiagnosticSeverity.Type;

export class PackNoTilesetsDiagnostic extends Schema.TaggedClass<PackNoTilesetsDiagnostic>()(
  'PACK.no-tilesets',
  {
    severity: PackCapabilityDiagnosticSeverity,
    message: Schema.String,
  },
) {}

export class PackDuplicateIdDiagnostic extends Schema.TaggedClass<PackDuplicateIdDiagnostic>()(
  'PACK.duplicate-id',
  {
    severity: PackCapabilityDiagnosticSeverity,
    packId: PackId,
    existingPackId: Schema.optional(PackId),
    newPackId: Schema.optional(PackId),
    integrityHashesMatch: Schema.optional(Schema.Boolean),
    message: Schema.String,
  },
) {}

export class PackUnsupportedSchemaDiagnostic extends Schema.TaggedClass<PackUnsupportedSchemaDiagnostic>()(
  'PACK.unsupported-schema',
  {
    severity: PackCapabilityDiagnosticSeverity,
    schemaVersion: Schema.OptionFromOptional(Schema.Number),
    message: Schema.String,
  },
) {}

export class PackFlipFlagDroppedDiagnostic extends Schema.TaggedClass<PackFlipFlagDroppedDiagnostic>()(
  'PACK.flip-flag-dropped',
  {
    severity: PackCapabilityDiagnosticSeverity,
    path: Schema.String,
    message: Schema.String,
  },
) {}

export class PackMissingAssetDiagnostic extends Schema.TaggedClass<PackMissingAssetDiagnostic>()(
  'PACK.missing-asset',
  {
    severity: PackCapabilityDiagnosticSeverity,
    assetId: Schema.String,
    path: Schema.String,
    message: Schema.String,
  },
) {}

export const PackCapabilityDiagnostic = Schema.Union([
  PackNoTilesetsDiagnostic,
  PackDuplicateIdDiagnostic,
  PackUnsupportedSchemaDiagnostic,
  PackFlipFlagDroppedDiagnostic,
  PackMissingAssetDiagnostic,
]);
export type PackCapabilityDiagnostic = typeof PackCapabilityDiagnostic.Type;

export const PackSourceInventorySummary = Schema.Struct({
  tilesetCount: Schema.Number,
  tileCount: Schema.Number,
  frameCount: Schema.Number,
  imageCollectionTileCount: Schema.Number,
  wangSetCount: Schema.Number,
  animationCount: Schema.Number,
  animationFrameCount: Schema.Number,
  tileProbabilityCount: Schema.Number,
  wangColorProbabilityCount: Schema.Number,
  collisionObjectCount: Schema.Number,
  ruleMapCount: Schema.Number,
  rulesIndexCount: Schema.Number,
  exampleMapCount: Schema.Number,
});
export type PackSourceInventorySummary = typeof PackSourceInventorySummary.Type;

export class PackCapability extends Schema.Class<PackCapability>('PackCapability')({
  packId: PackId,
  paintable: Schema.Boolean,
  tilesetCount: Schema.Number,
  tileCount: Schema.Number,
  placeableCount: Schema.Number,
  autotileRuleCount: Schema.Number,
  terrainClassCount: Schema.Number,
  hasAnimations: Schema.Boolean,
  hasCollisionMasks: Schema.Boolean,
  schemaVersion: Schema.OptionFromOptional(Schema.Number),
  source: PackCapabilitySource,
  diagnostics: Schema.Array(PackCapabilityDiagnostic),
  sourceInventory: Schema.optional(PackSourceInventorySummary),
}) {}

export const makeAssetOnlyPackCapability = (packId: PackId): PackCapability =>
  new PackCapability({
    packId,
    paintable: false,
    tilesetCount: 0,
    tileCount: 0,
    placeableCount: 0,
    autotileRuleCount: 0,
    terrainClassCount: 0,
    hasAnimations: false,
    hasCollisionMasks: false,
    schemaVersion: Option.none(),
    source: 'asset-only',
    diagnostics: [
      new PackNoTilesetsDiagnostic({
        severity: 'warning',
        message: 'Pack does not contain tilesets.',
      }),
    ],
  });
