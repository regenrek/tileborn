import { Option } from "effect";
import { describe, expect, it } from "vitest";

import { resolveAutotile } from "../../autotile/index.js";
import { parseTilesetManifest } from "../../manifest/parse.js";
import { buildFrameIndex } from "../../renderer/frame-index.js";
import { toPixiDescriptor } from "../../renderer/pixi-adapter.js";
import type { CollisionMask } from "../../schemas/collision-mask.js";
import type { TileId, TilesetPack } from "../../schemas/index.js";
import { meadowPack } from "../../manifest/__fixtures__/fixtures.js";
import { buildEditorTilesetIndex } from "../build.js";
import { decodeEditorTilesetIndex } from "../decode.js";

const placeable = {
  id: "placeable:62656465-0000-4000-8000-000000000009",
  name: "Sample Statue",
  size: { width: 96, height: 128 },
  frames: [
    {
      assetId: meadowPack.assets[0]!.id,
      tileId: meadowPack.tiles[0]!.id,
      uv: { x: 0, y: 0, w: 96, h: 128 },
    },
  ],
  tags: ["prop"],
  placementMode: "object",
  source: {
    format: "tiled",
    tilesetName: "Props",
    localTileId: 0,
    image: "Props/statue.png",
    imageWidth: 96,
    imageHeight: 128,
    properties: {},
  },
} as const;

/** Global 1..N tile index ordering used by `tileset-pack.ts` (source of truth). */
const tileIndexByTileIdFromPack = (pack: TilesetPack): Map<TileId, number> => {
  const map = new Map<TileId, number>();
  let tileIndex = 1;
  for (const tileset of pack.tilesets) {
    for (const tile of tileset.tiles) {
      map.set(tile.id, tileIndex);
      tileIndex += 1;
    }
  }
  return map;
};

const collisionByTileIndexFromPack = (pack: TilesetPack): Map<number, CollisionMask> => {
  const map = new Map<number, CollisionMask>();
  let tileIndex = 1;
  for (const tileset of pack.tilesets) {
    for (const tile of tileset.tiles) {
      const mask = Option.getOrUndefined(tile.collisionMask);
      if (mask !== undefined) {
        map.set(tileIndex, mask);
      }
      tileIndex += 1;
    }
  }
  return map;
};

const parsePack = (json: unknown): TilesetPack => {
  const result = parseTilesetManifest(json);
  if (result.value === undefined) {
    throw new Error(`fixture failed to parse: ${JSON.stringify(result.diagnostics)}`);
  }
  return result.value;
};

describe("editor tileset index golden parity", () => {
  const pack = parsePack({ ...meadowPack, placeables: [placeable] });
  const index = buildEditorTilesetIndex(pack, "sha256:test");
  // Round-trip through JSON to mirror disk persistence + IPC serialization
  // (drops `undefined`-valued keys), which the decode path must tolerate.
  const decoded = decodeEditorTilesetIndex(JSON.parse(JSON.stringify(index)) as typeof index);

  it("persists only plain JSON (no Option/class instances)", () => {
    const roundTripped = JSON.parse(JSON.stringify(index));
    expect(roundTripped).toEqual(index);
  });

  it("matches the manifest-derived global tile-index ordering", () => {
    const expected = tileIndexByTileIdFromPack(pack);
    expect(decoded.tileIndexByTileId).toEqual(expected);
    for (const [tileId, tileIndex] of expected) {
      expect(decoded.tileIdByTileIndex.get(tileIndex)).toBe(tileId);
    }
  });

  it("matches manifest-derived frame uv + asset path per tile index", () => {
    const frameIndex = buildFrameIndex(pack);
    for (const [tileId, tileIndex] of tileIndexByTileIdFromPack(pack)) {
      const frame = frameIndex.lookup(tileId);
      const assetPath = frame?.sourceAssetPaths[0];
      if (frame === undefined || assetPath === undefined) {
        expect(decoded.tileFramesByIndex.get(tileIndex)).toBeUndefined();
        continue;
      }
      const descriptor = toPixiDescriptor(frame);
      expect(decoded.tileFramesByIndex.get(tileIndex)).toEqual({
        tileId,
        assetPath,
        x: descriptor.frame.x,
        y: descriptor.frame.y,
        width: descriptor.frame.width,
        height: descriptor.frame.height,
      });
    }
  });

  it("matches manifest-derived collision masks per tile index", () => {
    const expected = collisionByTileIndexFromPack(pack);
    expect(decoded.collisionMaskByTileIndex.size).toBe(expected.size);
    for (const [tileIndex, mask] of expected) {
      expect(decoded.collisionMaskByTileIndex.get(tileIndex)).toEqual(mask);
    }
  });

  it("preserves autotile rule mask→tile resolution", () => {
    const packRules = pack.tilesets.flatMap((tileset) => tileset.autotileRules);
    expect(decoded.autotileRules).toHaveLength(packRules.length);
    const resolveOrThrow = (rule: (typeof packRules)[number], mask: number): string => {
      try {
        return String(resolveAutotile(rule, mask).tileId);
      } catch {
        return "__no_match__";
      }
    };
    decoded.autotileRules.forEach((decodedRule, ruleIndex) => {
      const packRule = packRules[ruleIndex]!;
      expect(decodedRule).toEqual(packRule);
      // The decoded rule must resolve every possible neighbourhood mask exactly
      // like the manifest-parsed rule, so painted autotile indices never drift.
      for (let mask = 0; mask < 256; mask += 1) {
        expect(resolveOrThrow(decodedRule, mask)).toBe(resolveOrThrow(packRule, mask));
      }
    });
  });

  it("preserves terrain transitions and representative tiles", () => {
    expect(decoded.terrainTransitions).toEqual(
      pack.tilesets.flatMap((tileset) => tileset.terrainTransitions),
    );

    const tileIndexByTileId = tileIndexByTileIdFromPack(pack);
    const expectedFirstTileId = new Map<string, TileId>();
    const expectedDirectTileIndex = new Map<string, number>();
    for (const tileset of pack.tilesets) {
      for (const tile of tileset.tiles) {
        const terrainClass = Option.getOrUndefined(tile.terrainClass);
        if (terrainClass === undefined) {
          continue;
        }
        if (!expectedFirstTileId.has(terrainClass)) {
          expectedFirstTileId.set(terrainClass, tile.id); // first-tile representative
        }
        expectedDirectTileIndex.set(terrainClass, tileIndexByTileId.get(tile.id)!); // last wins
      }
    }
    expect(new Map(decoded.terrainFirstTileId)).toEqual(expectedFirstTileId);
    expect(new Map(decoded.directTileIndexByTerrainClass)).toEqual(expectedDirectTileIndex);
  });

  it("derives representative terrain tiles from autotile rule classes when per-tile classes are absent", () => {
    const firstTileId = meadowPack.tiles[0]!.id;
    const secondTileId = meadowPack.tiles[1]!.id;
    const rulesOnlyPack = parsePack({
      ...meadowPack,
      terrainClasses: ["auto-grass", "auto-wall"],
      tiles: meadowPack.tiles.map((tile) => ({
        id: tile.id,
        tilesetId: tile.tilesetId,
        uv: tile.uv,
        tags: tile.tags,
        ...(tile.animationId === undefined ? {} : { animationId: tile.animationId }),
      })),
      autotileRules: [
        {
          _tag: "wang2corner",
          tilesetId: meadowPack.tilesets[0]!.id,
          id: "autotile-rule:62656465-0000-4000-8000-000000000041",
          name: "auto grass",
          terrainClasses: ["auto-grass"],
          maskToTileIds: {
            "0001": [firstTileId],
          },
        },
        {
          _tag: "wang2corner",
          tilesetId: meadowPack.tilesets[0]!.id,
          id: "autotile-rule:62656465-0000-4000-8000-000000000042",
          name: "auto wall",
          terrainClasses: ["auto-wall"],
          maskToTileIds: {
            "0001": [secondTileId],
          },
        },
      ],
      variantFilters: [],
      terrainTransitions: [],
    });
    const rulesOnlyIndex = buildEditorTilesetIndex(rulesOnlyPack, "sha256:rules-only");
    const rulesOnlyDecoded = decodeEditorTilesetIndex(
      JSON.parse(JSON.stringify(rulesOnlyIndex)) as typeof rulesOnlyIndex,
    );

    expect(new Map(rulesOnlyDecoded.terrainFirstTileId)).toEqual(
      new Map([
        ["auto-grass", firstTileId as TileId],
        ["auto-wall", secondTileId as TileId],
      ]),
    );
    expect(new Map(rulesOnlyDecoded.directTileIndexByTerrainClass)).toEqual(
      new Map([
        ["auto-grass", 1],
        ["auto-wall", 2],
      ]),
    );
  });

  it("preserves placeable frames and sizes", () => {
    expect(decoded.placeables).toEqual(pack.placeables ?? []);
    const decodedPlaceable = decoded.placeables[0]!;
    expect(decodedPlaceable.size).toEqual({ width: 96, height: 128 });
    expect(decodedPlaceable.frames[0]!.uv).toEqual({ x: 0, y: 0, w: 96, h: 128 });
  });

  it("round-trips placeable animation clips through build + decode", () => {
    const clipFrame = {
      assetId: meadowPack.assets[0]!.id,
      tileId: meadowPack.tiles[0]!.id,
      uv: { x: 0, y: 0, w: 32, h: 32 },
      durationMs: 120,
    } as const;
    const animatedPlaceable = {
      id: "placeable:62656465-0000-4000-8000-000000000030",
      name: "Animated Hero",
      size: { width: 32, height: 32 },
      frames: [clipFrame],
      clips: [
        {
          id: "clip:62656465-0000-4000-8000-000000000031",
          name: "idle",
          frames: [clipFrame, clipFrame],
          loop: true,
          defaultDurationMs: 120,
        },
      ],
      tags: ["sprite"],
      placementMode: "object",
      source: {
        format: "tiled",
        tilesetName: "Heroes",
        localTileId: 0,
        properties: {},
      },
    } as const;

    const animatedPack = parsePack({ ...meadowPack, placeables: [animatedPlaceable] });
    const animatedIndex = buildEditorTilesetIndex(animatedPack, "sha256:clip");
    const animatedDecoded = decodeEditorTilesetIndex(
      JSON.parse(JSON.stringify(animatedIndex)) as typeof animatedIndex,
    );

    expect(animatedDecoded.placeables).toEqual(animatedPack.placeables ?? []);
    const clips = animatedDecoded.placeables[0]!.clips;
    expect(clips).toHaveLength(1);
    expect(clips?.[0]?.name).toBe("idle");
    expect(clips?.[0]?.frames).toHaveLength(2);
    expect(clips?.[0]?.loop).toBe(true);
    expect(clips?.[0]?.defaultDurationMs).toBe(120);
  });

  it("exposes atlas asset paths and pack metadata", () => {
    expect(decoded.atlasAssetPaths).toEqual(["atlases/meadow.png"]);
    expect(decoded.packMeta.name).toBe("Meadow Pack");
    expect(decoded.assets.map((asset) => asset.path)).toEqual(["atlases/meadow.png"]);
  });
});
