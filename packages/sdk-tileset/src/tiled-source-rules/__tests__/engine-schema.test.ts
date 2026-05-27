import { describe, expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { tiledSourceApplicationInputSlice } from "../../../tests/fixtures/tiled-source-application-slice.js";
import {
  buildTiledSourceRulePack,
  compileTiledSourceRulePipeline,
  decodeTiledSourceSourceManifest,
  decodeTiledSourceRuleApplicationInput,
  projectTiledSourceRuleApplication,
} from "../compiler.js";

const TILESET_PATH = "TiledMap Editor/Tilesets/Terrain.tsx";
const RULE_PATH = "TiledMap Editor/Rules/wall-1-rule1-place.tmx";
const SOURCE_DIGEST = "tiled-source-tiled-source-v1:c4b43218";

const minimalSourceManifest = {
  schema: "tileborne.tiled-source-manifest.v1",
  version: 1,
  sourceRoot: "/licensed-tiled-source",
  tiledRoot: "TiledMap Editor",
  generatedAt: "2026-05-24T08:00:00.000Z",
  sourceDigest: SOURCE_DIGEST,
  summary: {
    tilesets: 1,
    maps: 0,
    exampleMaps: 0,
    automappingRules: 2,
    tiles: 2,
    wangSets: 1,
    wangTiles: 1,
    animations: 0,
    animationFrames: 0,
    tileProbabilities: 0,
    wangColorProbabilities: 1,
    probabilities: 1,
    imageCollectionTiles: 0,
    objectCollisionTiles: 0,
    objectCollisionObjects: 0,
    tileLayers: 4,
    nonEmptyTileLayerCells: 4,
    objectGroups: 2,
    objectGroupObjects: 2,
    ruleOptionObjects: 2,
  },
  tilesets: [
    {
      name: "Terrain",
      path: TILESET_PATH,
      tileWidth: 32,
      tileHeight: 32,
      tileCount: 2,
      columns: 2,
      imageCollection: false,
      image: {
        source: "../Tilesets/terrain.png",
        resolvedSource: "TiledMap Editor/Tilesets/terrain.png",
        width: 64,
        height: 32,
      },
      tiles: [
        { id: 0, probability: 1 },
        { id: 1, probability: 1 },
      ],
      wangSets: [
        {
          name: "Terrain Wang",
          type: "corner",
          tile: 0,
          colors: [{ name: "grass", color: "#3f8f3f", tile: 0, probability: 1 }],
          tiles: [{ tileId: 0, wangId: "1,1,1,1,1,1,1,1" }],
        },
      ],
    },
  ],
  maps: [],
  automappingRules: [
    rule({
      path: RULE_PATH,
      wall: "wall-1",
      transparent: false,
      phase: "place",
      phaseOrder: 10,
      inputLocalId: 0,
      outputLocalId: 1,
    }),
    rule({
      path: "TiledMap Editor/Rules/wall-1-rule0-reset.tmx",
      wall: "wall-1",
      transparent: false,
      phase: "reset",
      phaseOrder: 0,
      inputLocalId: 1,
      outputLocalId: 0,
    }),
  ],
};

function rule(input: {
  readonly path: string;
  readonly wall: string;
  readonly transparent: boolean;
  readonly phase: "reset" | "place" | "variation" | "unknown";
  readonly phaseOrder: number;
  readonly inputLocalId: number;
  readonly outputLocalId: number;
}) {
  return {
    name: input.path.split("/").pop() ?? input.path,
    path: input.path,
    width: 1,
    height: 1,
    tileWidth: 32,
    tileHeight: 32,
    tilesets: [
      {
        firstGid: 1,
        source: "../Tilesets/Terrain.tsx",
        path: TILESET_PATH,
        resolvedSource: TILESET_PATH,
      },
    ],
    properties: { MatchInOrder: true },
    layers: ["input_walls", "output_walls"],
    objectGroups: ["rule_options"],
    tileLayers: [
      {
        id: 1,
        name: "input_walls",
        width: 1,
        height: 1,
        opacity: 1,
        visible: true,
        tiles: [
          {
            column: 0,
            row: 0,
            rawGid: input.inputLocalId + 1,
            gid: input.inputLocalId + 1,
            localId: input.inputLocalId,
            tilesetPath: TILESET_PATH,
          },
        ],
      },
      {
        id: 2,
        name: "output_walls",
        width: 1,
        height: 1,
        opacity: 1,
        visible: true,
        tiles: [
          {
            column: 0,
            row: 0,
            rawGid: input.outputLocalId + 1,
            gid: input.outputLocalId + 1,
            localId: input.outputLocalId,
            tilesetPath: TILESET_PATH,
          },
        ],
      },
    ],
    objectGroupDetails: [
      {
        id: 3,
        name: "rule_options",
        offsetX: 0,
        offsetY: 0,
        objects: [
          {
            id: 1,
            x: 0,
            y: 0,
            width: 32,
            height: 32,
            properties: { Probability: 1, Disabled: false },
          },
        ],
      },
    ],
    wall: input.wall,
    transparent: input.transparent,
    phase: input.phase,
    phaseOrder: input.phaseOrder,
  };
}

const cloneManifest = () => structuredClone(minimalSourceManifest);

describe("Tiled source rule schemas", () => {
  it.effect("parses and compiles a minimal source manifest", () =>
    Effect.gen(function* () {
      const manifest = yield* decodeTiledSourceSourceManifest(cloneManifest());
      const pipeline = yield* compileTiledSourceRulePipeline(manifest);

      expect(manifest.sourceDigest).toBe(SOURCE_DIGEST);
      expect(pipeline.summary.wangSets).toBe(1);
      expect(pipeline.summary.automappingRules).toBe(2);
      expect(pipeline.summary.wallGroups).toBe(1);
      expect(pipeline.wangSets[0]?.id).toBe(`${TILESET_PATH}#Terrain Wang`);
      expect(pipeline.wallGroups[0]?.normalPhases).toEqual(["reset", "place"]);
      expect(pipeline.diagnostics).toEqual([]);
    }));

  it.effect("returns InvalidSourceManifestError for invalid input", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(decodeTiledSourceSourceManifest({ nope: true }));
      expect(error._tag).toBe("InvalidSourceManifestError");
    }));

  it.effect("returns MissingTilesetError for missing tile references", () =>
    Effect.gen(function* () {
      const input = cloneManifest();
      input.automappingRules[0]!.tileLayers[0]!.tiles[0]!.tilesetPath = "TiledMap Editor/Tilesets/Missing.tsx";
      const manifest = yield* decodeTiledSourceSourceManifest(input);
      const error = yield* Effect.flip(compileTiledSourceRulePipeline(manifest));
      expect(error._tag).toBe("MissingTilesetError");
      expect(error.ruleId).toBe(RULE_PATH);
    }));

  it.effect("returns InvalidRuleOptionError for invalid probabilities", () =>
    Effect.gen(function* () {
      const input = cloneManifest();
      input.automappingRules[0]!.objectGroupDetails[0]!.objects[0]!.properties.Probability = -1;
      const manifest = yield* decodeTiledSourceSourceManifest(input);
      const error = yield* Effect.flip(compileTiledSourceRulePipeline(manifest));
      expect(error._tag).toBe("InvalidRuleOptionError");
    }));

  it.effect("returns ContradictoryRuleError for duplicate rule paths with different signatures", () =>
    Effect.gen(function* () {
      const input = cloneManifest();
      input.automappingRules.push({
        ...structuredClone(input.automappingRules[0]!),
        wall: "wall-2",
      });
      const manifest = yield* decodeTiledSourceSourceManifest(input);
      const error = yield* Effect.flip(compileTiledSourceRulePipeline(manifest));
      expect(error._tag).toBe("ContradictoryRuleError");
    }));

  it.effect("emits typed diagnostics for missing and empty canonical rule layers", () =>
    Effect.gen(function* () {
      const input = cloneManifest();
      input.automappingRules[0]!.tileLayers = [
        {
          id: 1,
          name: "input_walls",
          width: 1,
          height: 1,
          opacity: 1,
          visible: true,
          tiles: [],
        },
      ];
      const manifest = yield* decodeTiledSourceSourceManifest(input);
      const pipeline = yield* compileTiledSourceRulePipeline(manifest);
      expect(pipeline.diagnostics.map((diagnostic) => diagnostic._tag)).toEqual([
        "EmptyRuleLayer",
        "MissingRuleLayer",
      ]);
    }));

  it.effect("is deterministic for equal manifests and rule application inputs", () =>
    Effect.gen(function* () {
      const packA = yield* buildTiledSourceRulePack(cloneManifest());
      const packB = yield* buildTiledSourceRulePack(cloneManifest());
      expect(packA.pipeline).toEqual(packB.pipeline);
      expect(packA.pipeline.pipelineDigest).toBe(packB.pipeline.pipelineDigest);

      const applicationInput = yield* decodeTiledSourceRuleApplicationInput(tiledSourceApplicationInputSlice);
      const outputA = yield* projectTiledSourceRuleApplication(packA.pipeline, applicationInput);
      const outputB = yield* projectTiledSourceRuleApplication(packA.pipeline, applicationInput);
      expect(outputA).toEqual(outputB);
      expect(outputA.projectionDigest).toBe(outputB.projectionDigest);
    }));

  it.effect("decodes a minimal Tiled source application fixture", () =>
    Effect.gen(function* () {
      const decoded = yield* decodeTiledSourceRuleApplicationInput(tiledSourceApplicationInputSlice);
      const firstSource = Option.getOrUndefined(decoded.terrainCells[0]?.sourceId ?? Option.none());
      expect(decoded.sourceDigest).toBe("tiled-source-tiled-source-v1:c4b43218");
      expect(firstSource).toBe("tiled-source:tiled-source-tilesets-tileset-terrain");
    }));
});
