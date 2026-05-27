import { Option, Schema } from "effect";

import { makeTileId, type Uuid } from "@tileborne/core";

import { compileAnimation } from "../animation/compile.js";
import { resolveAnimatedTile } from "../animation/resolve.js";
import { perfectGrid16, grid32MarginSpacing } from "../atlas/__fixtures__/slice-fixtures.js";
import { sliceAtlas } from "../atlas/slice.js";
import { Around8Bits, formatMaskKey, NEIGHBORHOODS } from "../autotile/index.js";
import { compileTiledSourceWallRulePhase } from "../importers/tiled-source/wall-rules.js";
import { parseLdtkProject } from "../ldtk/ldtk-parse.js";
import { meadowPack } from "../manifest/__fixtures__/fixtures.js";
import { parseTilesetManifest } from "../manifest/parse.js";
import { writeTilesetManifest } from "../manifest/write.js";
import { compileCollisionFromTiledObject } from "../metadata/collision.js";
import { buildFrameIndex } from "../renderer/frame-index.js";
import { renderTileLayout, type RenderGridCell } from "../renderer/layout-snapshot.js";
import { AutotileRuleId, Blob47AutotileRule, TerrainClass } from "../schemas/index.js";
import { parseTmjSync } from "../tiled/tmj-parse.js";
import { parseTmx } from "../tiled/tmx-parse.js";
import { resolveTerrainCell } from "../terrain/transitions.js";
import type { TerrainClassRegistry } from "../terrain/types.js";
import { selectVariant } from "../variants/select.js";

import {
  crossFormatLdtkProject,
  crossFormatManifest,
  crossFormatTmj,
  crossFormatTmx,
  tiledWallRuleTmx,
  largeMapTileRefs,
  runtimePackagingManifest,
  tinyMapTileRefs,
  VERIFICATION_PACK_SEED,
  VERIFICATION_PROJECT_ROOT,
} from "./fixtures/cross-format.js";
import { normalizeLayoutSnapshot, normalizeMapCells, normalizePackForComparison } from "./normalize.js";
import { buildReferencedTilesetManifest, manifestSummary } from "./runtime-packaging.js";

const uuid = (suffix: string): Uuid =>
  `62656465-0000-4000-8000-${suffix.padStart(12, "0")}` as Uuid;

const tileId = (suffix: string) => makeTileId(uuid(suffix));
const ruleId = (suffix: string) =>
  Schema.decodeUnknownSync(AutotileRuleId)(`autotile-rule:${uuid(suffix)}`);
const terrain = (value: string) => Schema.decodeUnknownSync(TerrainClass)(value);

const meadowPackValue = parseTilesetManifest(meadowPack).value!;
const variantTileId = tileId("1");
const staticTileId = tileId("2");

const makeCheckerGrid = (size: number): RenderGridCell[] => {
  const cells: RenderGridCell[] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      cells.push({
        x,
        y,
        tileId: (x + y) % 2 === 0 ? variantTileId : staticTileId,
        ...((x + y) % 3 === 0 ? { flipH: true } : {}),
      });
    }
  }
  return cells;
};

const importCrossFormatTiled = async () => {
  const tmj = parseTmjSync(crossFormatTmj, {
    packIdSeed: VERIFICATION_PACK_SEED,
    projectRoot: VERIFICATION_PROJECT_ROOT,
    sourcePath: `${VERIFICATION_PROJECT_ROOT}/maps/test.tmj`,
  });
  const tmx = await parseTmx(crossFormatTmx, {
    packIdSeed: VERIFICATION_PACK_SEED,
    projectRoot: VERIFICATION_PROJECT_ROOT,
    sourcePath: `${VERIFICATION_PROJECT_ROOT}/maps/test.tmx`,
  });
  return { tmj, tmx };
};

const importCrossFormatLdtk = () =>
  parseLdtkProject({
    projectPath: `${VERIFICATION_PROJECT_ROOT}/world.ldtk`,
    projectJson: crossFormatLdtkProject,
  });

const importCrossFormatManifest = () => parseTilesetManifest(crossFormatManifest).value!;

const tiledTileLayer = (map: TiledMapImport): TiledMapTileLayer | undefined => {
  const layer = map.layers.find((entry) => entry.kind === "tile");
  return layer?.kind === "tile" ? layer : undefined;
};

const tiledMapCells = (
  pack: TilesetPack,
  layer: TiledMapTileLayer,
): ReadonlyArray<{ readonly x: number; readonly y: number; readonly tileId: string }> =>
  layer.cells.flatMap((cell, index) => {
    if (cell.gid === 0) {
      return [];
    }
    const tile = pack.tilesets[0]?.tiles[cell.localTileIndex];
    return [
      {
        x: index % layer.width,
        y: Math.floor(index / layer.width),
        tileId: tile === undefined ? `local:${cell.localTileIndex}` : String(tile.id),
      },
    ];
  });

const tiledRenderGrid = (pack: TilesetPack, layer: TiledMapTileLayer): RenderGridCell[] =>
  layer.cells.flatMap((cell, index) => {
    if (cell.gid === 0) {
      return [];
    }
    const tile = pack.tilesets[0]?.tiles[cell.localTileIndex];
    if (tile === undefined) {
      return [];
    }
    return [
      {
        x: index % layer.width,
        y: Math.floor(index / layer.width),
        tileId: tile.id,
        ...(cell.flippedHorizontal ? { flipH: true } : {}),
        ...(cell.flippedVertical ? { flipV: true } : {}),
        ...(cell.flippedDiagonal ? { flipD: true } : {}),
      },
    ];
  });

const tileLayerCells = (
  pack: TilesetPack,
  map: TiledMapImport,
): ReadonlyArray<{ readonly x: number; readonly y: number; readonly tileId: string }> => {
  const layer = tiledTileLayer(map);
  return layer === undefined ? [] : tiledMapCells(pack, layer);
};

const ldtkTileLayerCells = (result: ReturnType<typeof parseLdtkProject>) => {
  const tileLayer = result.levels[0]?.layers.find((layer) => layer.type === "tiles");
  if (tileLayer?.type !== "tiles") {
    return [];
  }
  return tileLayer.cells.map((cell) => ({
    x: cell.px[0] / tileLayer.gridSize,
    y: cell.px[1] / tileLayer.gridSize,
    tileId: String(cell.tileId),
  }));
};

export const buildCrossFormatEquivalenceGolden = async () => {
  const { tmj, tmx } = await importCrossFormatTiled();
  const ldtk = importCrossFormatLdtk();
  const manifest = importCrossFormatManifest();

  const formats = {
    tmj: {
      pack: normalizePackForComparison(tmj.value!.pack),
      mapCells: normalizeMapCells(tmj.value!.pack, tileLayerCells(tmj.value!.pack, tmj.value!.tiledMap)),
      layout: normalizeLayoutSnapshot(
        tmj.value!.pack,
        renderTileLayout(
          tmj.value!.pack,
          tiledRenderGrid(tmj.value!.pack, tiledTileLayer(tmj.value!.tiledMap)!),
        ),
      ),
    },
    tmx: {
      pack: normalizePackForComparison(tmx.value!.pack),
      mapCells: normalizeMapCells(tmx.value!.pack, tileLayerCells(tmx.value!.pack, tmx.value!.tiledMap)),
      layout: normalizeLayoutSnapshot(
        tmx.value!.pack,
        renderTileLayout(
          tmx.value!.pack,
          tiledRenderGrid(tmx.value!.pack, tiledTileLayer(tmx.value!.tiledMap)!),
        ),
      ),
    },
    ldtk: {
      pack: normalizePackForComparison(ldtk.pack),
      mapCells: normalizeMapCells(ldtk.pack, ldtkTileLayerCells(ldtk)),
      layout: normalizeLayoutSnapshot(
        ldtk.pack,
        renderTileLayout(
          ldtk.pack,
          ldtkTileLayerCells(ldtk).map((cell) => ({
            x: cell.x,
            y: cell.y,
            tileId: makeTileId(cell.tileId as Uuid),
          })),
        ),
      ),
    },
    manifest: {
      pack: normalizePackForComparison(manifest),
      layout: normalizeLayoutSnapshot(
        manifest,
        renderTileLayout(manifest, [
          { x: 0, y: 0, tileId: makeTileId("62656465-0000-4000-8000-000000000103" as Uuid) },
          { x: 1, y: 0, tileId: makeTileId("62656465-0000-4000-8000-000000000104" as Uuid) },
          { x: 0, y: 1, tileId: makeTileId("62656465-0000-4000-8000-000000000104" as Uuid) },
          { x: 1, y: 1, tileId: makeTileId("62656465-0000-4000-8000-000000000103" as Uuid) },
        ]),
      ),
    },
  };

  return {
    reference: formats.tmj,
    formats,
  };
};

export const buildReplayGolden = () => {
  const filter = meadowPackValue.tilesets[0]!.variantFilters[0]!;
  const brushSequence = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 3, y: 2 },
    { x: 4, y: 2 },
  ];

  const replayOnce = () =>
    brushSequence.map((cell) => {
      const selected = selectVariant(filter, {
        mapSeed: 4242,
        layerId: "terrain-brush",
        cellX: cell.x,
        cellY: cell.y,
        terrainClass: terrain("grass"),
      });
      return {
        x: cell.x,
        y: cell.y,
        tileId: String(selected.tileId),
        index: selected.index,
      };
    });

  const firstRun = replayOnce();
  const secondRun = replayOnce();

  return {
    seed: 4242,
    brushSequence,
    firstRun,
    secondRun,
    byteIdentical: JSON.stringify(firstRun) === JSON.stringify(secondRun),
  };
};

export const buildLayoutGoldens = () => ({
  "4x4-basic": renderTileLayout(meadowPackValue, makeCheckerGrid(4), {
    mapSeed: 1337,
    layerId: "ground",
  }),
  "4x4-variants": renderTileLayout(meadowPackValue, makeCheckerGrid(4), {
    mapSeed: 1337,
    layerId: "ground",
    terrainClass: terrain("grass"),
    useVariants: true,
  }),
  "8x8-basic": renderTileLayout(meadowPackValue, makeCheckerGrid(8), {
    mapSeed: 2048,
    layerId: "ground",
  }),
  "16x16-basic": renderTileLayout(meadowPackValue, makeCheckerGrid(16), {
    mapSeed: 4096,
    layerId: "ground",
  }),
});

export const buildUvGoldens = () => {
  const perfect = sliceAtlas(perfectGrid16.params).value!;
  const marginSpacing = sliceAtlas(grid32MarginSpacing.params).value!;
  const index = buildFrameIndex(meadowPackValue);

  return {
    "perfect-grid-16": {
      columns: perfect.columns,
      rows: perfect.rows,
      totalTiles: perfect.totalTiles,
      tiles: perfect.tiles,
    },
    "grid-32-margin-spacing": {
      columns: marginSpacing.columns,
      rows: marginSpacing.rows,
      totalTiles: marginSpacing.totalTiles,
      tiles: marginSpacing.tiles,
    },
    "meadow-frame-index": {
      static: index.lookup(staticTileId),
      animated: index.lookup(variantTileId),
    },
  };
};

export const buildAnimationDeterminismGolden = () => {
  const animation = Option.getOrThrow(meadowPackValue.tilesets[0]!.tiles[0]!.animation);
  const compiled = compileAnimation(animation).value!;
  const ticks = Array.from({ length: 60 }, (_, tick) => ({
    tick,
    timeMs: tick * 16,
    frameTileId: String(resolveAnimatedTile(compiled, tick * 16)),
  }));

  const replay = Array.from({ length: 60 }, (_, tick) =>
    String(resolveAnimatedTile(compiled, tick * 16)),
  );

  return {
    totalDurationMs: compiled.totalDurationMs,
    ticks,
    replayMatches: JSON.stringify(replay) === JSON.stringify(ticks.map((entry) => entry.frameTileId)),
  };
};

export const buildCollisionRoundtripGolden = () => {
  const tiledMask = compileCollisionFromTiledObject({
    id: 1,
    x: 2,
    y: 4,
    polygon: [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 8 },
    ],
  });

  const pack = parseTmjSync(crossFormatTmj, {
    packIdSeed: VERIFICATION_PACK_SEED,
    projectRoot: VERIFICATION_PROJECT_ROOT,
    sourcePath: `${VERIFICATION_PROJECT_ROOT}/maps/collision.tmj`,
  }).value!.pack;

  const manifestJson = writeTilesetManifest(pack) as Record<string, unknown>;
  const roundtrip = parseTilesetManifest(manifestJson).value!;
  const roundtripMask = roundtrip.tilesets
    .flatMap((tileset) => tileset.tiles)
    .flatMap((tile) =>
      Option.match(tile.collisionMask, {
        onNone: () => [],
        onSome: (mask) => [{ tileId: String(tile.id), mask }],
      }),
    );

  return {
    tiled: tiledMask,
    roundtripCount: roundtripMask.length,
    roundtrip: roundtripMask.map((entry) => ({
      tileId: entry.tileId,
      tag: entry.mask._tag,
      ...(entry.mask._tag === "polygon"
        ? { edgeCount: entry.mask.edges.length, blocksMovement: entry.mask.blocksMovement }
        : { passable: entry.mask.passable, blocked: entry.mask.blocked }),
    })),
  };
};

export const buildRuntimePackagingGoldens = () => {
  const manifest = runtimePackagingManifest as Record<string, unknown>;
  const tiny = buildReferencedTilesetManifest(manifest, tinyMapTileRefs);
  const large = buildReferencedTilesetManifest(manifest, largeMapTileRefs);

  return {
    tiny: {
      referencedTileIds: [...tinyMapTileRefs],
      summary: manifestSummary(tiny),
    },
    large: {
      referencedTileIds: [...largeMapTileRefs],
      summary: manifestSummary(large),
      bounded: manifestSummary(large).tileCount <= largeMapTileRefs.length + 2,
    },
  };
};

export const buildTiledSourceWallRulesGolden = () => {
  const compiled = compileTiledSourceWallRulePhase({
    rulePath: "Rules/verification-wall.tmx",
    raw: tiledWallRuleTmx,
    tileIdForSource: (_sourcePath, localTileId) => tileId(String(localTileId + 1)),
  });

  const maskTable = Object.fromEntries(
    Object.entries(compiled.value!.rule.maskToTileIds)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([mask, ids]) => [mask, ids.map(String)]),
  );

  return {
    ruleTag: compiled.value!.rule._tag,
    ruleName: compiled.value!.rule.name,
    maskTable,
  };
};

export const buildTerrainTransitionGolden = () => {
  const grassToWaterRuleId = ruleId("30");
  const grassToWaterRule = new Blob47AutotileRule({
    id: grassToWaterRuleId,
    name: "grass-water-verification",
    terrainClasses: [terrain("grass"), terrain("water")],
    maskToTileIds: {
      [formatMaskKey(1 << Around8Bits.N, NEIGHBORHOODS.around8)]: [tileId("31")],
      [formatMaskKey(1 << Around8Bits.E, NEIGHBORHOODS.around8)]: [tileId("32")],
      [formatMaskKey((1 << Around8Bits.N) | (1 << Around8Bits.E), NEIGHBORHOODS.around8)]: [
        tileId("33"),
      ],
    },
    fallbackTileId: Option.none(),
  });

  const transitions = [
    {
      from: terrain("grass"),
      to: terrain("water"),
      ruleId: grassToWaterRuleId,
    },
  ];

  const rulesById = new Map([[grassToWaterRuleId, grassToWaterRule]]);
  const registry: TerrainClassRegistry = {
    baseTileForClass: (terrainClass) =>
      terrainClass === terrain("grass") ? tileId("10") : tileId("11"),
    ruleForId: (id) => rulesById.get(id),
  };

  const grid = [
    { x: 0, y: 0, terrainClass: terrain("grass") },
    { x: 1, y: 0, terrainClass: terrain("water") },
    { x: 2, y: 0, terrainClass: terrain("grass") },
    { x: 0, y: 1, terrainClass: terrain("grass") },
    { x: 1, y: 1, terrainClass: terrain("grass") },
    { x: 2, y: 1, terrainClass: terrain("grass") },
    { x: 0, y: 2, terrainClass: terrain("grass") },
    { x: 1, y: 2, terrainClass: terrain("water") },
    { x: 2, y: 2, terrainClass: terrain("grass") },
  ];

  const center = grid[4]!;
  const neighbors = [{ dx: 0, dy: -1, terrainClass: terrain("water") }];

  const resolved = resolveTerrainCell({
    cell: center,
    neighbors,
    transitions,
    classRegistry: registry,
  });

  return {
    grid: grid.map((cell) => ({
      x: cell.x,
      y: cell.y,
      terrainClass: cell.terrainClass,
    })),
    center: {
      x: center.x,
      y: center.y,
      base: String(resolved.base),
      overlays: resolved.overlays.map(String),
      debug: resolved.debug,
    },
  };
};

export const allGoldenScenarios = async () => ({
  "cross-format-equivalence": await buildCrossFormatEquivalenceGolden(),
  replay: buildReplayGolden(),
  layouts: buildLayoutGoldens(),
  uvs: buildUvGoldens(),
  "animation-determinism": buildAnimationDeterminismGolden(),
  "collision-roundtrip": buildCollisionRoundtripGolden(),
  "runtime-packaging": buildRuntimePackagingGoldens(),
  "tiled-wall-rules": buildTiledSourceWallRulesGolden(),
  "terrain-transition-grass-water": buildTerrainTransitionGolden(),
});
