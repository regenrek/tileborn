import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";

import {
  TiledSourceRulesCompilePreviewRequest,
  TiledSourceRulesCompilePreviewResponse,
  TiledSourceRulesCompileProgressEventPayload,
  TiledSourceRulesContractErrors,
  TiledSourceRulesDiagnosticsEventPayload,
  TiledSourceRulesRuntimeApplyProgressEventPayload,
  TiledSourceRulesRuntimeApplyRequest,
  TiledSourceRulesRuntimeApplyResponse,
} from "./tiled-source-rules.js";

const manifestId = "tiled-source:sample-terrain";
const sourceDigest = "tiled-source-tiled-source-v1:c4b43218";
const pipelineDigest = `sha256:${"a".repeat(64)}`;
const projectionDigest = "tiled-source-projection:c4b43218";
const ruleId = "TiledMap Editor/Rules/wall-1-rule1-place.tmx";
const tilesetPath = "TiledMap Editor/Tilesets/Terrain.tsx";
const layerId = "ground";
const assetKey = "tiled-source:terrain/stone";

const roundTrip = <I>(schema: Schema.Top, value: I) => {
  const codec = schema as Schema.Codec<unknown, I, never, never>;
  const decoded = Schema.decodeUnknownSync(codec)(value);
  expect(Schema.encodeSync(codec)(decoded)).toEqual(value);
  return decoded;
};

const sourceSummary = {
  tilesets: 0,
  maps: 0,
  exampleMaps: 0,
  automappingRules: 0,
  tiles: 0,
  wangSets: 0,
  wangTiles: 0,
  animations: 0,
  animationFrames: 0,
  tileProbabilities: 0,
  wangColorProbabilities: 0,
  probabilities: 0,
  imageCollectionTiles: 0,
  objectCollisionTiles: 0,
  objectCollisionObjects: 0,
  tileLayers: 0,
  nonEmptyTileLayerCells: 0,
  objectGroups: 0,
  objectGroupObjects: 0,
  ruleOptionObjects: 0,
};

const pipelineSummary = {
  wangSets: 0,
  wangTiles: 0,
  automappingRules: 0,
  automappingInputTiles: 0,
  automappingOutputTiles: 0,
  ruleOptions: 0,
  wallGroups: 0,
};

const missingLayerDiagnostic = {
  _tag: "MissingRuleLayer",
  severity: "error",
  message: "missing input_walls layer",
  ruleId,
  layer: "input_walls",
  sourcePath: ruleId,
};

const manifest = {
  schema: "tileborne.tiled-source-manifest.v1",
  version: 1,
  sourceRoot: "/licensed-tiled-source",
  tiledRoot: "TiledMap Editor",
  generatedAt: "2026-05-24T08:00:00.000Z",
  sourceDigest,
  summary: sourceSummary,
  tilesets: [],
  maps: [],
  automappingRules: [],
};

const pipeline = {
  schema: "tileborne.tiled-source-rule-pipeline.v1",
  version: 1,
  sourceDigest,
  pipelineDigest,
  summary: pipelineSummary,
  wangSets: [],
  automappingRules: [],
  wallGroups: [],
  diagnostics: [missingLayerDiagnostic],
};

const applicationInput = {
  schema: "tileborne.tiled-source-rule-application-input.v1",
  version: 1,
  sourceDigest,
  seed: "playtest-seed",
  width: 1,
  height: 1,
  terrainCells: [
    {
      column: 0,
      row: 0,
      baseMaterial: "stone",
      overlays: [],
      roads: [],
      hazards: [],
      biomeTags: ["ruins"],
      sourceId: assetKey,
    },
  ],
};

const applicationOutput = {
  schema: "tileborne.tiled-source-rule-application-output.v1",
  version: 1,
  sourceDigest,
  projectionDigest,
  terrainCells: applicationInput.terrainCells,
  visualTiles: [
    {
      id: "tile-1",
      assetKey,
      x: 0,
      y: 0,
      layer: layerId,
      column: 0,
      row: 0,
      material: "stone",
    },
  ],
  collision: [
    {
      id: "collision-1",
      x: 0,
      y: 0,
      width: 32,
      height: 32,
      layer: layerId,
      blocksMovement: true,
      blocksProjectiles: false,
      blocksVision: false,
    },
  ],
  spawnHints: [
    {
      id: "spawn-1",
      kind: "player_spawn",
      x: 16,
      y: 16,
      layer: "spawns",
      assetKey,
    },
  ],
  diagnostics: [missingLayerDiagnostic],
};

describe("Tiled source rule IPC contracts", () => {
  it("round-trips compile preview payloads", () => {
    roundTrip(TiledSourceRulesCompilePreviewRequest, {
      manifestId,
      manifest,
      includeDiagnostics: true,
    });

    roundTrip(TiledSourceRulesCompilePreviewResponse, {
      manifestId,
      sourceDigest,
      pipeline,
      diagnostics: [missingLayerDiagnostic],
    });
  });

  it("round-trips runtime apply payloads", () => {
    roundTrip(TiledSourceRulesRuntimeApplyRequest, {
      manifestId,
      pipeline,
      input: applicationInput,
    });

    roundTrip(TiledSourceRulesRuntimeApplyResponse, {
      manifestId,
      sourceDigest,
      output: applicationOutput,
    });
  });

  it("round-trips progress and diagnostics event payloads", () => {
    roundTrip(TiledSourceRulesCompileProgressEventPayload, {
      manifestId,
      sourceDigest,
      stage: "compiling-rules",
      completedSteps: 1,
      totalSteps: 2,
      message: "compiled automapping rules",
    });

    roundTrip(TiledSourceRulesRuntimeApplyProgressEventPayload, {
      manifestId,
      sourceDigest,
      pipelineDigest,
      stage: "projecting-runtime",
      completedSteps: 1,
      totalSteps: 1,
      message: "projected runtime map",
    });

    roundTrip(TiledSourceRulesDiagnosticsEventPayload, {
      manifestId,
      sourceDigest,
      pipelineDigest,
      scope: "compile-preview",
      diagnostics: [missingLayerDiagnostic],
    });
  });

  it("rejects invalid branded ID fields", () => {
    expect(() =>
      Schema.decodeUnknownSync(TiledSourceRulesCompilePreviewRequest)({
        manifestId: "",
        manifest,
      }),
    ).toThrow();

    expect(() =>
      Schema.decodeUnknownSync(TiledSourceRulesRuntimeApplyResponse)({
        manifestId,
        sourceDigest: "",
        output: applicationOutput,
      }),
    ).toThrow();
  });

  it("decodes reused SDK tagged errors from the contract error channel", () => {
    const variants = [
      {
        _tag: "InvalidSourceManifestError",
        message: "invalid manifest",
        reason: "schema decode failed",
      },
      {
        _tag: "MissingTilesetError",
        message: "missing tileset",
        ruleId,
        tilesetPath,
        localId: 7,
      },
      {
        _tag: "InvalidRuleOptionError",
        message: "invalid probability",
        ruleId,
        optionId: null,
      },
      {
        _tag: "ContradictoryRuleError",
        message: "duplicate path",
        ruleId,
      },
    ];

    for (const variant of variants) {
      expect(Schema.decodeUnknownSync(TiledSourceRulesContractErrors)(variant)).toMatchObject({
        _tag: variant._tag,
      });
    }
  });
});
