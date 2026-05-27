import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { makeTileId, type Uuid } from "@tileborne/core";

import { resolveAnimatedTile } from "../../animation/resolve.js";
import { meadowPack } from "../../manifest/__fixtures__/fixtures.js";
import { parseTilesetManifest } from "../../manifest/parse.js";
import { TerrainClass } from "../../schemas/index.js";
import { selectVariant, type VariantContext } from "../../variants/select.js";
import { buildFrameIndex } from "../frame-index.js";
import { toPixiDescriptor } from "../pixi-adapter.js";

const uuid = (suffix: string): Uuid =>
  `62656465-0000-4000-8000-${suffix.padStart(12, "0")}` as Uuid;

const tileId = (suffix: string) => makeTileId(uuid(suffix));
const decodeTerrainClass = (value: string) => Schema.decodeUnknownSync(TerrainClass)(value);

const meadowResult = parseTilesetManifest(meadowPack);
const meadowPackValue = meadowResult.value!;

const animatedTileId = tileId("1");
const staticTileId = tileId("2");

describe("buildFrameIndex", () => {
  it("indexes static tiles with atlas asset id, uv, and source paths", () => {
    const index = buildFrameIndex(meadowPackValue);
    const frame = index.lookup(staticTileId);

    expect(frame).toEqual({
      imageAssetId: "asset:62656465-0000-4000-8000-000000000007",
      uv: { x: 32, y: 0, w: 32, h: 32 },
      sourceAssetPaths: ["atlases/meadow.png"],
    });
  });

  it("indexes animated tiles with animationId and compiled animation metadata", () => {
    const index = buildFrameIndex(meadowPackValue);
    const frame = index.lookup(animatedTileId);

    expect(frame?.animationId).toBe("animation:62656465-0000-4000-8000-000000000006");
    expect(frame?.uv).toEqual({ x: 0, y: 0, w: 32, h: 32 });

    const compiled = index.getCompiledAnimation("animation:62656465-0000-4000-8000-000000000006");
    expect(compiled).toBeDefined();
    expect(resolveAnimatedTile(compiled!, 0)).toBe(animatedTileId);
  });

  it("returns undefined for unknown tile ids", () => {
    const index = buildFrameIndex(meadowPackValue);
    expect(index.lookup(tileId("999"))).toBeUndefined();
  });
});

describe("lookupWithVariant", () => {
  const variantContext = (overrides: Partial<VariantContext> = {}): VariantContext => ({
    mapSeed: 42,
    layerId: "terrain",
    cellX: 3,
    cellY: 5,
    terrainClass: decodeTerrainClass("grass"),
    ...overrides,
  });

  it("is deterministic for the same variant context", () => {
    const index = buildFrameIndex(meadowPackValue);
    const context = variantContext();

    const first = index.lookupWithVariant(animatedTileId, context);
    const second = index.lookupWithVariant(animatedTileId, context);

    expect(second).toEqual(first);
  });

  it("selects the same tile as selectVariant before lookup", () => {
    const index = buildFrameIndex(meadowPackValue);
    const context = variantContext();
    const filter = meadowPackValue.tilesets[0]!.variantFilters[0]!;
    const selected = selectVariant(filter, context);

    const resolvedTileId = index.resolveVariantTileId(animatedTileId, context);
    const frame = index.lookupWithVariant(animatedTileId, context);

    expect(resolvedTileId).toBe(selected.tileId);
    expect(frame).toEqual(index.lookup(selected.tileId));
  });

  it("changes resolved uv when map seed changes", () => {
    const index = buildFrameIndex(meadowPackValue);
    const first = index.lookupWithVariant(animatedTileId, variantContext({ mapSeed: 111 }));
    const second = index.lookupWithVariant(animatedTileId, variantContext({ mapSeed: 222 }));

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first!.uv).not.toEqual(second!.uv);
  });

  it("falls back to direct lookup when tile is not in a variant filter", () => {
    const index = buildFrameIndex(meadowPackValue);
    const context = variantContext();

    expect(index.lookupWithVariant(staticTileId, context)).toEqual(index.lookup(staticTileId));
    expect(index.resolveVariantTileId(staticTileId, context)).toBe(staticTileId);
  });
});

describe("toPixiDescriptor", () => {
  it("maps uv rects to Pixi frame coordinates without importing Pixi", () => {
    const index = buildFrameIndex(meadowPackValue);
    const frame = index.lookup(staticTileId)!;

    expect(toPixiDescriptor(frame)).toEqual({
      imageAssetId: frame.imageAssetId,
      frame: {
        x: 32,
        y: 0,
        width: 32,
        height: 32,
      },
    });
  });
});

describe("renderer import boundary", () => {
  const rendererSources = import.meta.glob<string>("../**/*.ts", {
    query: "?raw",
    import: "default",
    eager: true,
  });
  const importPattern = /^\s*import\s+(?:type\s+)?(?:[\w*{}\s,]+from\s+)?['"]pixi\.js['"]/;

  it("does not import pixi.js anywhere under src/renderer/", () => {
    const violations = Object.entries(rendererSources).flatMap(([filePath, source]) => {
      if (filePath.includes("/__tests__/")) {
        return [];
      }

      return source.split("\n").flatMap((line, index) => {
        if (!importPattern.test(line)) {
          return [];
        }
        return [`${filePath}:${index + 1}: ${line.trim()}`];
      });
    });

    expect(violations).toEqual([]);
  });
});
