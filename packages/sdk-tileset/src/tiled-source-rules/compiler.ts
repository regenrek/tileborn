import { Effect, Option, Schema } from "effect";

import { hashJsonStable } from "@tileborne/core";

import {
  AssetKey,
  ContradictoryRuleError,
  EmptyRuleLayerDiagnostic,
  TiledSourceRulePack,
  TiledSourceRulePipeline,
  TiledSourceTiledSourceManifest,
  TiledSourceCompiledAutomappingRule,
  TiledSourceCompiledRuleOption,
  TiledSourceCompiledRuleTile,
  TiledSourceCompiledWallGroup,
  TiledSourceCompiledWangColor,
  TiledSourceCompiledWangSet,
  TiledSourceCompiledWangTile,
  TiledSourceRuleApplicationInput,
  TiledSourceRuleApplicationOutput,
  TiledSourceRuleDiagnostic,
  TiledSourceRulePipelineSummary,
  TiledSourceTerrainCell,
  type TiledSourceRulePhase,
  InvalidRuleOptionError,
  InvalidSourceManifestError,
  LayerId,
  MissingRuleLayerDiagnostic,
  MissingTileReferenceDiagnostic,
  MissingTilesetError,
  ProjectionDigest,
  RuleId,
  SourceManifestId,
  TilesetPath,
  UnsupportedRulePhaseDiagnostic,
  WangsetId,
  type TiledSourceAutomappingRule,
  type TiledSourceTiledLayerTile,
  type TiledSourceTiledObject,
  type TiledSourceTiledObjectGroup,
  type TiledSourceTiledTileLayer,
} from "./model.js";

const INPUT_WALLS = "input_walls" as LayerId;
const OUTPUT_WALLS = "output_walls" as LayerId;
const RULE_OPTIONS = "rule_options" as LayerId;

type CompileFailure = MissingTilesetError | InvalidRuleOptionError | ContradictoryRuleError;

const ruleSignature = (rule: TiledSourceAutomappingRule): string =>
  `${rule.wall}|${rule.transparent ? "transparent" : "normal"}|${rule.phase}|${rule.phaseOrder}`;

const sourceManifestId = (sourceDigest: string): SourceManifestId =>
  `tiled-source:${sourceDigest}` as SourceManifestId;

const wangsetId = (tilesetPath: TilesetPath, name: string): WangsetId =>
  `${tilesetPath}#${name}` as WangsetId;

const projectionDigest = (value: unknown): ProjectionDigest =>
  hashJsonStable(value) as unknown as ProjectionDigest;

const stableRuleTileOrder = (left: TiledSourceTiledLayerTile, right: TiledSourceTiledLayerTile): number =>
  left.row - right.row ||
  left.column - right.column ||
  left.tilesetPath.localeCompare(right.tilesetPath) ||
  left.localId - right.localId ||
  left.rawGid - right.rawGid;

const stableCompiledRuleOrder = (left: TiledSourceCompiledAutomappingRule, right: TiledSourceCompiledAutomappingRule): number =>
  left.phaseOrder - right.phaseOrder ||
  left.path.localeCompare(right.path) ||
  left.wall.localeCompare(right.wall, undefined, { numeric: true });

const stableCellOrder = (left: { readonly column: number; readonly row: number }, right: {
  readonly column: number;
  readonly row: number;
}): number => left.row - right.row || left.column - right.column;

const sortRuleTiles = (tiles: readonly TiledSourceTiledLayerTile[]): readonly TiledSourceCompiledRuleTile[] =>
  [...tiles].sort(stableRuleTileOrder).map((tile) =>
    new TiledSourceCompiledRuleTile({
      column: tile.column,
      row: tile.row,
      rawGid: tile.rawGid,
      gid: tile.gid,
      localId: tile.localId,
      tilesetPath: tile.tilesetPath,
      flipFlags: tile.flipFlags,
    })
  );

const tilesetPaths = (manifest: TiledSourceTiledSourceManifest): ReadonlySet<TilesetPath> =>
  new Set(manifest.tilesets.map((tileset) => tileset.path));

const layerNamed = (
  layers: readonly TiledSourceTiledTileLayer[],
  name: LayerId,
): TiledSourceTiledTileLayer | undefined =>
  layers.find((layer) => layer.name === name);

const objectGroupNamed = (
  groups: readonly TiledSourceTiledObjectGroup[],
  name: LayerId,
): TiledSourceTiledObjectGroup | undefined =>
  groups.find((group) => group.name === name);

const layerDiagnostics = (
  rule: TiledSourceAutomappingRule,
  inputLayer: TiledSourceTiledTileLayer | undefined,
  outputLayer: TiledSourceTiledTileLayer | undefined,
): readonly TiledSourceRuleDiagnostic[] => {
  const diagnostics: TiledSourceRuleDiagnostic[] = [];
  if (inputLayer === undefined) {
    diagnostics.push(new MissingRuleLayerDiagnostic({
      severity: "error",
      message: `${rule.path}: missing input_walls layer`,
      ruleId: rule.path,
      layer: INPUT_WALLS,
      sourcePath: Option.some(rule.path),
    }));
  } else if (inputLayer.tiles.length === 0) {
    diagnostics.push(new EmptyRuleLayerDiagnostic({
      severity: "warning",
      message: `${rule.path}: empty input_walls layer`,
      ruleId: rule.path,
      layer: INPUT_WALLS,
      sourcePath: Option.some(rule.path),
    }));
  }
  if (outputLayer === undefined) {
    diagnostics.push(new MissingRuleLayerDiagnostic({
      severity: "error",
      message: `${rule.path}: missing output_walls layer`,
      ruleId: rule.path,
      layer: OUTPUT_WALLS,
      sourcePath: Option.some(rule.path),
    }));
  } else if (outputLayer.tiles.length === 0) {
    diagnostics.push(new EmptyRuleLayerDiagnostic({
      severity: "warning",
      message: `${rule.path}: empty output_walls layer`,
      ruleId: rule.path,
      layer: OUTPUT_WALLS,
      sourcePath: Option.some(rule.path),
    }));
  }
  if (rule.phase === "unknown") {
    diagnostics.push(new UnsupportedRulePhaseDiagnostic({
      severity: "warning",
      message: `${rule.path}: unsupported phase unknown`,
      ruleId: rule.path,
      phase: rule.phase,
      sourcePath: Option.some(rule.path),
      layer: Option.none(),
    }));
  }
  return diagnostics;
};

const missingTileReference = (
  rule: TiledSourceAutomappingRule,
  tile: TiledSourceTiledLayerTile,
): MissingTileReferenceDiagnostic =>
  new MissingTileReferenceDiagnostic({
    severity: "error",
    message: `${rule.path}: tile ${tile.localId} references missing tileset ${tile.tilesetPath}`,
    ruleId: rule.path,
    tilesetPath: tile.tilesetPath,
    localId: tile.localId,
    sourcePath: Option.some(rule.path),
    layer: Option.none(),
  });

const assertTilesetReferences = Effect.fn("TiledSourceRules.assertTilesetReferences")(function* (
  manifestTilesets: ReadonlySet<TilesetPath>,
  rule: TiledSourceAutomappingRule,
  tiles: readonly TiledSourceTiledLayerTile[],
) {
  for (const tile of tiles) {
    if (!manifestTilesets.has(tile.tilesetPath)) {
      yield* new MissingTilesetError({
        message: `${rule.path}: tile ${tile.localId} references missing tileset ${tile.tilesetPath}`,
        ruleId: rule.path,
        tilesetPath: tile.tilesetPath,
        localId: tile.localId,
      });
    }
  }
});

const numericProbability = Effect.fn("TiledSourceRules.numericProbability")(function* (
  rule: TiledSourceAutomappingRule,
  object: TiledSourceTiledObject,
) {
  const rawProbability = object.properties.Probability;
  if (rawProbability === undefined) return 1;
  if (typeof rawProbability === "number" && Number.isFinite(rawProbability) && rawProbability >= 0) {
    return rawProbability;
  }
  return yield* new InvalidRuleOptionError({
    message: `${rule.path}: rule option Probability must be a finite non-negative number`,
    ruleId: rule.path,
    optionId: object.id,
  });
});

const compileRuleOptions = Effect.fn("TiledSourceRules.compileRuleOptions")(function* (
  rule: TiledSourceAutomappingRule,
  group: TiledSourceTiledObjectGroup | undefined,
) {
  if (group === undefined) return [] as readonly TiledSourceCompiledRuleOption[];
  const options: TiledSourceCompiledRuleOption[] = [];
  for (const object of group.objects) {
    const probability = yield* numericProbability(rule, object);
    options.push(new TiledSourceCompiledRuleOption({
      id: object.id,
      x: object.x,
      y: object.y,
      width: object.width,
      height: object.height,
      probability,
      disabled: object.properties.Disabled === true,
    }));
  }
  return options.sort((left, right) =>
    left.x - right.x ||
    left.y - right.y ||
    left.width - right.width ||
    left.height - right.height ||
    (left.id ?? -1) - (right.id ?? -1)
  );
});

const assertNoContradictoryRulePaths = Effect.fn("TiledSourceRules.assertNoContradictoryRulePaths")(function* (
  rules: readonly TiledSourceAutomappingRule[],
) {
  const byPath = new Map<RuleId, string>();
  for (const rule of rules) {
    const existing = byPath.get(rule.path);
    const next = ruleSignature(rule);
    if (existing !== undefined && existing !== next) {
      yield* new ContradictoryRuleError({
        message: `${rule.path}: duplicate rule path has contradictory wall, transparency, phase, or order`,
        ruleId: rule.path,
      });
    }
    byPath.set(rule.path, next);
  }
});

const compileAutomappingRule = Effect.fn("TiledSourceRules.compileAutomappingRule")(function* (
  manifestTilesets: ReadonlySet<TilesetPath>,
  rule: TiledSourceAutomappingRule,
) {
  const inputLayer = layerNamed(rule.tileLayers, INPUT_WALLS);
  const outputLayer = layerNamed(rule.tileLayers, OUTPUT_WALLS);
  const inputTiles = inputLayer?.tiles ?? [];
  const outputTiles = outputLayer?.tiles ?? [];
  yield* assertTilesetReferences(manifestTilesets, rule, [...inputTiles, ...outputTiles]);
  const options = yield* compileRuleOptions(rule, objectGroupNamed(rule.objectGroupDetails, RULE_OPTIONS));
  const diagnostics = [
    ...layerDiagnostics(rule, inputLayer, outputLayer),
    ...[...inputTiles, ...outputTiles]
      .filter((tile) => !manifestTilesets.has(tile.tilesetPath))
      .map((tile) => missingTileReference(rule, tile)),
  ];
  return {
    rule: new TiledSourceCompiledAutomappingRule({
      id: rule.path,
      path: rule.path,
      wall: rule.wall,
      transparent: rule.transparent,
      phase: rule.phase,
      phaseOrder: rule.phaseOrder,
      matchInOrder: rule.properties.MatchInOrder === true,
      width: rule.width,
      height: rule.height,
      inputTiles: sortRuleTiles(inputTiles),
      outputTiles: sortRuleTiles(outputTiles),
      options,
    }),
    diagnostics,
  };
});

const compileWangSets = (manifest: TiledSourceTiledSourceManifest): readonly TiledSourceCompiledWangSet[] =>
  manifest.tilesets.flatMap((tileset) =>
    tileset.wangSets.map((wangSet) =>
      new TiledSourceCompiledWangSet({
        id: wangsetId(tileset.path, wangSet.name),
        tilesetPath: tileset.path,
        tilesetName: tileset.name,
        name: wangSet.name,
        type: wangSet.type,
        tile: wangSet.tile,
        colors: wangSet.colors.map((color) =>
          new TiledSourceCompiledWangColor({
            name: color.name,
            color: color.color,
            tile: color.tile,
            probability: color.probability,
          })
        ),
        tiles: wangSet.tiles.map((tile) =>
          new TiledSourceCompiledWangTile({
            tileId: tile.tileId,
            wangId: tile.wangId,
          })
        ),
      })
    )
  );

const phasesFor = (
  rules: readonly TiledSourceCompiledAutomappingRule[],
  transparent: boolean,
): readonly TiledSourceRulePhase[] =>
  [...rules]
    .filter((rule) => rule.transparent === transparent)
    .sort(stableCompiledRuleOrder)
    .map((rule) => rule.phase);

const compileWallGroups = (rules: readonly TiledSourceCompiledAutomappingRule[]): readonly TiledSourceCompiledWallGroup[] => {
  const byWall = new Map<string, TiledSourceCompiledAutomappingRule[]>();
  for (const rule of rules) {
    const current = byWall.get(rule.wall) ?? [];
    current.push(rule);
    byWall.set(rule.wall, current);
  }
  return [...byWall.entries()]
    .map(([wall, groupRules]) =>
      new TiledSourceCompiledWallGroup({
        wall: wall as TiledSourceCompiledWallGroup["wall"],
        normalPhases: phasesFor(groupRules, false),
        transparentPhases: phasesFor(groupRules, true),
        rulePaths: groupRules.map((rule) => rule.path).sort((left, right) => left.localeCompare(right)),
      })
    )
    .sort((left, right) => left.wall.localeCompare(right.wall, undefined, { numeric: true }));
};

const pipelineSummary = (
  wangSets: readonly TiledSourceCompiledWangSet[],
  rules: readonly TiledSourceCompiledAutomappingRule[],
  wallGroups: readonly TiledSourceCompiledWallGroup[],
): TiledSourceRulePipelineSummary =>
  new TiledSourceRulePipelineSummary({
    wangSets: wangSets.length,
    wangTiles: wangSets.reduce((sum, wangSet) => sum + wangSet.tiles.length, 0),
    automappingRules: rules.length,
    automappingInputTiles: rules.reduce((sum, rule) => sum + rule.inputTiles.length, 0),
    automappingOutputTiles: rules.reduce((sum, rule) => sum + rule.outputTiles.length, 0),
    ruleOptions: rules.reduce((sum, rule) => sum + rule.options.length, 0),
    wallGroups: wallGroups.length,
  });

const encodeForHash = <A, I>(schema: Schema.Codec<A, I, never, never>, value: A): unknown =>
  Schema.encodeUnknownSync(schema)(value);

export const decodeTiledSourceSourceManifest: (
  input: unknown,
) => Effect.Effect<TiledSourceTiledSourceManifest, InvalidSourceManifestError> = Effect.fn(
  "TiledSourceRules.decodeSourceManifest",
)(function* (input: unknown) {
  const decoded = Schema.decodeUnknownOption(TiledSourceTiledSourceManifest)(input);
  if (Option.isNone(decoded)) {
    return yield* new InvalidSourceManifestError({
      message: "Tiled source source manifest is invalid.",
      reason: "schema decode failed",
    });
  }
  return decoded.value;
});

export const compileTiledSourceRulePipeline: (
  manifest: TiledSourceTiledSourceManifest,
) => Effect.Effect<TiledSourceRulePipeline, CompileFailure> = Effect.fn(
  "TiledSourceRules.compileRulePipeline",
)(function* (manifest: TiledSourceTiledSourceManifest) {
  yield* assertNoContradictoryRulePaths(manifest.automappingRules);
  const manifestTilesets = tilesetPaths(manifest);
  const wangSets = compileWangSets(manifest);
  const compiledRules: TiledSourceCompiledAutomappingRule[] = [];
  const diagnostics: TiledSourceRuleDiagnostic[] = [];
  for (const rule of manifest.automappingRules) {
    const compiled = yield* compileAutomappingRule(manifestTilesets, rule);
    compiledRules.push(compiled.rule);
    diagnostics.push(...compiled.diagnostics);
  }
  const automappingRules = compiledRules.sort(stableCompiledRuleOrder);
  const wallGroups = compileWallGroups(automappingRules);
  const summary = pipelineSummary(wangSets, automappingRules, wallGroups);
  const pipelineFields = {
    schema: "tileborne.tiled-source-rule-pipeline.v1",
    version: 1,
    sourceDigest: manifest.sourceDigest,
    summary,
    wangSets,
    automappingRules,
    wallGroups,
    diagnostics,
  } as const;
  const digestInput = {
    schema: pipelineFields.schema,
    version: pipelineFields.version,
    sourceDigest: pipelineFields.sourceDigest,
    summary: encodeForHash(TiledSourceRulePipelineSummary, summary),
    wangSets: wangSets.map((wangSet) => encodeForHash(TiledSourceCompiledWangSet, wangSet)),
    automappingRules: automappingRules.map((rule) => encodeForHash(TiledSourceCompiledAutomappingRule, rule)),
    wallGroups: wallGroups.map((wallGroup) => encodeForHash(TiledSourceCompiledWallGroup, wallGroup)),
    diagnostics: diagnostics.map((diagnostic) => encodeForHash(TiledSourceRuleDiagnostic, diagnostic)),
  };
  return new TiledSourceRulePipeline({
    ...pipelineFields,
    pipelineDigest: hashJsonStable(digestInput),
  });
});

export const buildTiledSourceRulePack: (
  input: unknown,
) => Effect.Effect<TiledSourceRulePack, InvalidSourceManifestError | CompileFailure> = Effect.fn(
  "TiledSourceRules.buildRulePack",
)(function* (input: unknown) {
  const manifest = yield* decodeTiledSourceSourceManifest(input);
  const pipeline = yield* compileTiledSourceRulePipeline(manifest);
  return new TiledSourceRulePack({
    schema: "tileborne.tiled-source-rule-pack.v1",
    version: 1,
    id: sourceManifestId(manifest.sourceDigest),
    sourceDigest: manifest.sourceDigest,
    manifest,
    pipeline,
  });
});

export const decodeTiledSourceRuleApplicationInput: (
  input: unknown,
) => Effect.Effect<TiledSourceRuleApplicationInput, InvalidSourceManifestError> = Effect.fn(
  "TiledSourceRules.decodeRuleApplicationInput",
)(function* (input: unknown) {
  const decoded = Schema.decodeUnknownOption(TiledSourceRuleApplicationInput)(input);
  if (Option.isNone(decoded)) {
    return yield* new InvalidSourceManifestError({
      message: "Tiled source rule application input is invalid.",
      reason: "schema decode failed",
    });
  }
  return decoded.value;
});

export const projectTiledSourceRuleApplication: (
  pipeline: TiledSourceRulePipeline,
  input: TiledSourceRuleApplicationInput,
) => Effect.Effect<TiledSourceRuleApplicationOutput, never> = Effect.fn(
  "TiledSourceRules.projectRuleApplication",
)(function (pipeline: TiledSourceRulePipeline, input: TiledSourceRuleApplicationInput) {
  const terrainCells = [...input.terrainCells].sort(stableCellOrder);
  return Effect.succeed(
    new TiledSourceRuleApplicationOutput({
      schema: "tileborne.tiled-source-rule-application-output.v1",
      version: 1,
      sourceDigest: input.sourceDigest,
      projectionDigest: projectionDigest({
        sourceDigest: input.sourceDigest,
        seed: input.seed,
        pipelineDigest: pipeline.pipelineDigest,
        width: input.width,
        height: input.height,
        terrainCells: terrainCells.map((cell) => encodeForHash(TiledSourceTerrainCell, cell)),
      }),
      terrainCells,
      visualTiles: [],
      collision: [],
      spawnHints: [],
      diagnostics: pipeline.diagnostics,
    }),
  );
});

export const collectProjectedAssetKeys = (output: TiledSourceRuleApplicationOutput): readonly AssetKey[] => {
  const keys = new Set<AssetKey>();
  for (const tile of output.visualTiles) keys.add(tile.assetKey);
  for (const hint of output.spawnHints) {
    const assetKey = Option.getOrUndefined(hint.assetKey);
    if (assetKey !== undefined) keys.add(assetKey);
  }
  return [...keys].sort((left, right) => left.localeCompare(right));
};
