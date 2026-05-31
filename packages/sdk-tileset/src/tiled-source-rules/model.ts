import { Schema } from "effect";

import { ContentHash } from "@tileborne/core";

const NonEmptyBrandedString = <Brand extends string>(brand: Brand) =>
  Schema.String.check(Schema.isMinLength(1)).pipe(Schema.brand(brand));

export const SourceManifestId = NonEmptyBrandedString("TiledSourceManifestId");
export type SourceManifestId = typeof SourceManifestId.Type;

export const SourceDigest = NonEmptyBrandedString("TiledSourceDigest");
export type SourceDigest = typeof SourceDigest.Type;

export const TilesetId = NonEmptyBrandedString("TiledSourceTilesetId");
export type TilesetId = typeof TilesetId.Type;

export const TilesetPath = NonEmptyBrandedString("TiledSourceTilesetPath");
export type TilesetPath = typeof TilesetPath.Type;

export const WangsetId = NonEmptyBrandedString("TiledSourceWangsetId");
export type WangsetId = typeof WangsetId.Type;

export const RuleId = NonEmptyBrandedString("TiledSourceRuleId");
export type RuleId = typeof RuleId.Type;

export const LayerId = NonEmptyBrandedString("TiledSourceLayerId");
export type LayerId = typeof LayerId.Type;

export const WallId = NonEmptyBrandedString("TiledSourceWallId");
export type WallId = typeof WallId.Type;

export const AssetKey = NonEmptyBrandedString("TiledSourceAssetKey");
export type AssetKey = typeof AssetKey.Type;

export const ProjectionDigest = NonEmptyBrandedString("TiledSourceProjectionDigest");
export type ProjectionDigest = typeof ProjectionDigest.Type;

export const TiledSourceRulePhase = Schema.String.check(Schema.isMinLength(1));
export type TiledSourceRulePhase = typeof TiledSourceRulePhase.Type;

export const TiledSourceDiagnosticSeverity = Schema.Literals(["error", "warning", "info"] as const);
export type TiledSourceDiagnosticSeverity = typeof TiledSourceDiagnosticSeverity.Type;

export const TiledPropertyValue = Schema.Union([Schema.String, Schema.Number, Schema.Boolean]);
export type TiledPropertyValue = typeof TiledPropertyValue.Type;

export const TiledProperties = Schema.Record(Schema.String, TiledPropertyValue);
export type TiledProperties = typeof TiledProperties.Type;

export class TiledSourceTiledImage extends Schema.Class<TiledSourceTiledImage>("TiledSourceTiledImage")({
  source: Schema.String,
  resolvedSource: Schema.String,
  width: Schema.Number,
  height: Schema.Number,
}) {}

export class TiledSourceTiledAnimationFrame extends Schema.Class<TiledSourceTiledAnimationFrame>("TiledSourceTiledAnimationFrame")({
  tileId: Schema.Number,
  durationMs: Schema.Number,
}) {}

export class TiledSourceTiledObject extends Schema.Class<TiledSourceTiledObject>("TiledSourceTiledObject")({
  id: Schema.NullOr(Schema.Number),
  name: Schema.OptionFromOptional(Schema.String),
  type: Schema.OptionFromOptional(Schema.String),
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
  properties: TiledProperties,
}) {}

export class TiledSourceTiledTile extends Schema.Class<TiledSourceTiledTile>("TiledSourceTiledTile")({
  id: Schema.Number,
  image: Schema.OptionFromOptional(TiledSourceTiledImage),
  probability: Schema.OptionFromOptional(Schema.Number),
  animation: Schema.OptionFromOptional(Schema.Array(TiledSourceTiledAnimationFrame)),
  objects: Schema.OptionFromOptional(Schema.Array(TiledSourceTiledObject)),
}) {}

export class TiledSourceTiledWangColor extends Schema.Class<TiledSourceTiledWangColor>("TiledSourceTiledWangColor")({
  name: Schema.String,
  color: Schema.String,
  tile: Schema.Number,
  probability: Schema.Number,
}) {}

export class TiledSourceTiledWangTile extends Schema.Class<TiledSourceTiledWangTile>("TiledSourceTiledWangTile")({
  tileId: Schema.Number,
  wangId: Schema.String,
}) {}

export class TiledSourceTiledWangSet extends Schema.Class<TiledSourceTiledWangSet>("TiledSourceTiledWangSet")({
  name: Schema.String,
  type: Schema.String,
  tile: Schema.Number,
  colors: Schema.Array(TiledSourceTiledWangColor),
  tiles: Schema.Array(TiledSourceTiledWangTile),
}) {}

export class TiledSourceTiledTileset extends Schema.Class<TiledSourceTiledTileset>("TiledSourceTiledTileset")({
  name: Schema.String,
  path: TilesetPath,
  tileWidth: Schema.Number,
  tileHeight: Schema.Number,
  tileCount: Schema.Number,
  columns: Schema.Number,
  imageCollection: Schema.Boolean,
  image: Schema.OptionFromOptional(TiledSourceTiledImage),
  tiles: Schema.Array(TiledSourceTiledTile),
  wangSets: Schema.Array(TiledSourceTiledWangSet),
}) {}

export class TiledSourceTiledTilesetRef extends Schema.Class<TiledSourceTiledTilesetRef>("TiledSourceTiledTilesetRef")({
  firstGid: Schema.Number,
  source: Schema.String,
  path: TilesetPath,
  resolvedSource: Schema.String,
}) {}

export class TiledSourceTiledTileFlipFlags extends Schema.Class<TiledSourceTiledTileFlipFlags>("TiledSourceTiledTileFlipFlags")({
  horizontal: Schema.Boolean,
  vertical: Schema.Boolean,
  diagonal: Schema.Boolean,
}) {}

export class TiledSourceTiledLayerTile extends Schema.Class<TiledSourceTiledLayerTile>("TiledSourceTiledLayerTile")({
  column: Schema.Number,
  row: Schema.Number,
  rawGid: Schema.Number,
  gid: Schema.Number,
  localId: Schema.Number,
  tilesetPath: TilesetPath,
  flipFlags: Schema.OptionFromOptional(TiledSourceTiledTileFlipFlags),
}) {}

export class TiledSourceTiledTileLayer extends Schema.Class<TiledSourceTiledTileLayer>("TiledSourceTiledTileLayer")({
  id: Schema.NullOr(Schema.Number),
  name: LayerId,
  width: Schema.Number,
  height: Schema.Number,
  opacity: Schema.Number,
  visible: Schema.Boolean,
  tiles: Schema.Array(TiledSourceTiledLayerTile),
}) {}

export class TiledSourceTiledObjectGroup extends Schema.Class<TiledSourceTiledObjectGroup>("TiledSourceTiledObjectGroup")({
  id: Schema.NullOr(Schema.Number),
  name: LayerId,
  offsetX: Schema.Number,
  offsetY: Schema.Number,
  objects: Schema.Array(TiledSourceTiledObject),
}) {}

export class TiledSourceTiledMap extends Schema.Class<TiledSourceTiledMap>("TiledSourceTiledMap")({
  name: Schema.String,
  path: RuleId,
  width: Schema.Number,
  height: Schema.Number,
  tileWidth: Schema.Number,
  tileHeight: Schema.Number,
  tilesets: Schema.Array(TiledSourceTiledTilesetRef),
  properties: TiledProperties,
  layers: Schema.Array(LayerId),
  objectGroups: Schema.Array(LayerId),
  tileLayers: Schema.Array(TiledSourceTiledTileLayer),
  objectGroupDetails: Schema.Array(TiledSourceTiledObjectGroup),
}) {}

export class TiledSourceAutomappingRule extends TiledSourceTiledMap.extend<TiledSourceAutomappingRule>(
  "TiledSourceAutomappingRule",
)({
  wall: WallId,
  transparent: Schema.Boolean,
  phase: TiledSourceRulePhase,
  phaseOrder: Schema.Number,
}) {}

export class TiledSourceSourceSummary extends Schema.Class<TiledSourceSourceSummary>("TiledSourceSourceSummary")({
  tilesets: Schema.Number,
  maps: Schema.Number,
  exampleMaps: Schema.Number,
  automappingRules: Schema.Number,
  tiles: Schema.Number,
  wangSets: Schema.Number,
  wangTiles: Schema.Number,
  animations: Schema.Number,
  animationFrames: Schema.Number,
  tileProbabilities: Schema.Number,
  wangColorProbabilities: Schema.Number,
  probabilities: Schema.Number,
  imageCollectionTiles: Schema.Number,
  objectCollisionTiles: Schema.Number,
  objectCollisionObjects: Schema.Number,
  tileLayers: Schema.Number,
  nonEmptyTileLayerCells: Schema.Number,
  objectGroups: Schema.Number,
  objectGroupObjects: Schema.Number,
  ruleOptionObjects: Schema.Number,
}) {}

export class TiledSourceTiledSourceManifest extends Schema.Class<TiledSourceTiledSourceManifest>(
  "TiledSourceTiledSourceManifest",
)({
  schema: Schema.Literal("tileborne.tiled-source-manifest.v1"),
  version: Schema.Literal(1),
  sourceRoot: Schema.String,
  tiledRoot: Schema.String,
  generatedAt: Schema.String,
  sourceDigest: SourceDigest,
  summary: TiledSourceSourceSummary,
  tilesets: Schema.Array(TiledSourceTiledTileset),
  maps: Schema.Array(TiledSourceTiledMap),
  automappingRules: Schema.Array(TiledSourceAutomappingRule),
}) {}

export class TiledSourceCompiledWangColor extends Schema.Class<TiledSourceCompiledWangColor>("TiledSourceCompiledWangColor")({
  name: Schema.String,
  color: Schema.String,
  tile: Schema.Number,
  probability: Schema.Number,
}) {}

export class TiledSourceCompiledWangTile extends Schema.Class<TiledSourceCompiledWangTile>("TiledSourceCompiledWangTile")({
  tileId: Schema.Number,
  wangId: Schema.String,
}) {}

export class TiledSourceCompiledWangSet extends Schema.Class<TiledSourceCompiledWangSet>("TiledSourceCompiledWangSet")({
  id: WangsetId,
  tilesetPath: TilesetPath,
  tilesetName: Schema.String,
  name: Schema.String,
  type: Schema.String,
  tile: Schema.Number,
  colors: Schema.Array(TiledSourceCompiledWangColor),
  tiles: Schema.Array(TiledSourceCompiledWangTile),
}) {}

export class TiledSourceCompiledRuleTile extends Schema.Class<TiledSourceCompiledRuleTile>("TiledSourceCompiledRuleTile")({
  column: Schema.Number,
  row: Schema.Number,
  rawGid: Schema.Number,
  gid: Schema.Number,
  localId: Schema.Number,
  tilesetPath: TilesetPath,
  flipFlags: Schema.OptionFromOptional(TiledSourceTiledTileFlipFlags),
}) {}

export class TiledSourceCompiledRuleOption extends Schema.Class<TiledSourceCompiledRuleOption>("TiledSourceCompiledRuleOption")({
  id: Schema.NullOr(Schema.Number),
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
  probability: Schema.Number,
  disabled: Schema.Boolean,
}) {}

export class TiledSourceCompiledAutomappingRule extends Schema.Class<TiledSourceCompiledAutomappingRule>(
  "TiledSourceCompiledAutomappingRule",
)({
  id: RuleId,
  path: RuleId,
  wall: WallId,
  transparent: Schema.Boolean,
  phase: TiledSourceRulePhase,
  phaseOrder: Schema.Number,
  matchInOrder: Schema.Boolean,
  width: Schema.Number,
  height: Schema.Number,
  inputLayer: LayerId,
  outputLayer: LayerId,
  inputTiles: Schema.Array(TiledSourceCompiledRuleTile),
  outputTiles: Schema.Array(TiledSourceCompiledRuleTile),
  options: Schema.Array(TiledSourceCompiledRuleOption),
}) {}

export class TiledSourceCompiledWallGroup extends Schema.Class<TiledSourceCompiledWallGroup>("TiledSourceCompiledWallGroup")({
  wall: WallId,
  normalPhases: Schema.Array(TiledSourceRulePhase),
  transparentPhases: Schema.Array(TiledSourceRulePhase),
  rulePaths: Schema.Array(RuleId),
}) {}

export class TiledSourceRulePipelineSummary extends Schema.Class<TiledSourceRulePipelineSummary>("TiledSourceRulePipelineSummary")({
  wangSets: Schema.Number,
  wangTiles: Schema.Number,
  automappingRules: Schema.Number,
  automappingInputTiles: Schema.Number,
  automappingOutputTiles: Schema.Number,
  ruleOptions: Schema.Number,
  wallGroups: Schema.Number,
}) {}

const diagnosticFields = {
  severity: TiledSourceDiagnosticSeverity,
  message: Schema.String,
  sourcePath: Schema.OptionFromOptional(RuleId),
  layer: Schema.OptionFromOptional(LayerId),
} as const;

export class MissingRuleLayerDiagnostic extends Schema.TaggedClass<MissingRuleLayerDiagnostic>()(
  "MissingRuleLayer",
  {
    ...diagnosticFields,
    ruleId: RuleId,
    layer: LayerId,
  },
) {}

export class EmptyRuleLayerDiagnostic extends Schema.TaggedClass<EmptyRuleLayerDiagnostic>()("EmptyRuleLayer", {
  ...diagnosticFields,
  ruleId: RuleId,
  layer: LayerId,
}) {}

export class UnsupportedRulePhaseDiagnostic extends Schema.TaggedClass<UnsupportedRulePhaseDiagnostic>()(
  "UnsupportedRulePhase",
  {
    ...diagnosticFields,
    ruleId: RuleId,
    phase: TiledSourceRulePhase,
  },
) {}

export class MissingTileReferenceDiagnostic extends Schema.TaggedClass<MissingTileReferenceDiagnostic>()(
  "MissingTileReference",
  {
    ...diagnosticFields,
    ruleId: RuleId,
    tilesetPath: TilesetPath,
    localId: Schema.Number,
  },
) {}

export class InvalidRuleOptionDiagnostic extends Schema.TaggedClass<InvalidRuleOptionDiagnostic>()(
  "InvalidRuleOption",
  {
    ...diagnosticFields,
    ruleId: RuleId,
    optionId: Schema.NullOr(Schema.Number),
  },
) {}

export class ContradictoryRuleDiagnostic extends Schema.TaggedClass<ContradictoryRuleDiagnostic>()(
  "ContradictoryRule",
  {
    ...diagnosticFields,
    ruleId: RuleId,
  },
) {}

export const TiledSourceRuleDiagnostic = Schema.Union([
  MissingRuleLayerDiagnostic,
  EmptyRuleLayerDiagnostic,
  UnsupportedRulePhaseDiagnostic,
  MissingTileReferenceDiagnostic,
  InvalidRuleOptionDiagnostic,
  ContradictoryRuleDiagnostic,
]);
export type TiledSourceRuleDiagnostic = typeof TiledSourceRuleDiagnostic.Type;

export class TiledSourceRulePipeline extends Schema.Class<TiledSourceRulePipeline>("TiledSourceRulePipeline")({
  schema: Schema.Literal("tileborne.tiled-source-rule-pipeline.v1"),
  version: Schema.Literal(1),
  sourceDigest: SourceDigest,
  pipelineDigest: ContentHash,
  summary: TiledSourceRulePipelineSummary,
  wangSets: Schema.Array(TiledSourceCompiledWangSet),
  automappingRules: Schema.Array(TiledSourceCompiledAutomappingRule),
  wallGroups: Schema.Array(TiledSourceCompiledWallGroup),
  diagnostics: Schema.Array(TiledSourceRuleDiagnostic),
}) {}

export class TiledSourceRulePack extends Schema.Class<TiledSourceRulePack>("TiledSourceRulePack")({
  schema: Schema.Literal("tileborne.tiled-source-rule-pack.v1"),
  version: Schema.Literal(1),
  id: SourceManifestId,
  sourceDigest: SourceDigest,
  manifest: TiledSourceTiledSourceManifest,
  pipeline: TiledSourceRulePipeline,
}) {}

export class TiledSourceTerrainCell extends Schema.Class<TiledSourceTerrainCell>("TiledSourceTerrainCell")({
  column: Schema.Number,
  row: Schema.Number,
  baseMaterial: Schema.String,
  overlays: Schema.Array(Schema.String),
  roads: Schema.Array(Schema.String),
  hazards: Schema.Array(Schema.String),
  biomeTags: Schema.Array(Schema.String),
  sourceId: Schema.OptionFromOptional(AssetKey),
}) {}

export class TiledSourceVisualTile extends Schema.Class<TiledSourceVisualTile>("TiledSourceVisualTile")({
  id: Schema.String,
  assetKey: AssetKey,
  x: Schema.Number,
  y: Schema.Number,
  layer: LayerId,
  column: Schema.OptionFromOptional(Schema.Number),
  row: Schema.OptionFromOptional(Schema.Number),
  material: Schema.OptionFromOptional(Schema.String),
  transitionTo: Schema.OptionFromOptional(Schema.String),
}) {}

export class TiledSourceCollisionFootprint extends Schema.Class<TiledSourceCollisionFootprint>("TiledSourceCollisionFootprint")({
  id: Schema.String,
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
  layer: LayerId,
  blocksMovement: Schema.Boolean,
  blocksProjectiles: Schema.Boolean,
  blocksVision: Schema.Boolean,
}) {}

export class TiledSourceObjectSpawnHint extends Schema.Class<TiledSourceObjectSpawnHint>("TiledSourceObjectSpawnHint")({
  id: Schema.String,
  kind: Schema.String,
  x: Schema.Number,
  y: Schema.Number,
  layer: LayerId,
  assetKey: Schema.OptionFromOptional(AssetKey),
}) {}

export class TiledSourceRuleApplicationInput extends Schema.Class<TiledSourceRuleApplicationInput>("TiledSourceRuleApplicationInput")({
  schema: Schema.Literal("tileborne.tiled-source-rule-application-input.v1"),
  version: Schema.Literal(1),
  sourceDigest: SourceDigest,
  seed: Schema.String,
  width: Schema.Number,
  height: Schema.Number,
  terrainCells: Schema.Array(TiledSourceTerrainCell),
}) {}

export class TiledSourceRuleApplicationOutput extends Schema.Class<TiledSourceRuleApplicationOutput>("TiledSourceRuleApplicationOutput")({
  schema: Schema.Literal("tileborne.tiled-source-rule-application-output.v1"),
  version: Schema.Literal(1),
  sourceDigest: SourceDigest,
  projectionDigest: ProjectionDigest,
  terrainCells: Schema.Array(TiledSourceTerrainCell),
  visualTiles: Schema.Array(TiledSourceVisualTile),
  collision: Schema.Array(TiledSourceCollisionFootprint),
  spawnHints: Schema.Array(TiledSourceObjectSpawnHint),
  diagnostics: Schema.Array(TiledSourceRuleDiagnostic),
}) {}

export class InvalidSourceManifestError extends Schema.TaggedErrorClass<InvalidSourceManifestError>()(
  "InvalidSourceManifestError",
  {
    message: Schema.String,
    reason: Schema.String,
  },
) {}

export class MissingTilesetError extends Schema.TaggedErrorClass<MissingTilesetError>()("MissingTilesetError", {
  message: Schema.String,
  ruleId: RuleId,
  tilesetPath: TilesetPath,
  localId: Schema.Number,
}) {}

export class InvalidRuleOptionError extends Schema.TaggedErrorClass<InvalidRuleOptionError>()(
  "InvalidRuleOptionError",
  {
    message: Schema.String,
    ruleId: RuleId,
    optionId: Schema.NullOr(Schema.Number),
  },
) {}

export class ContradictoryRuleError extends Schema.TaggedErrorClass<ContradictoryRuleError>()(
  "ContradictoryRuleError",
  {
    message: Schema.String,
    ruleId: RuleId,
  },
) {}

export type TiledSourceRuleCompileError = MissingTilesetError | InvalidRuleOptionError | ContradictoryRuleError;
