import { Option } from "effect";
import { describe, expect, it } from "vitest";

import { hashJsonStable } from "@tileborne/core";

import { diagnosticTag } from "../../diagnostics.js";
import { CustomAutotileRule } from "../../schemas/autotile-rule.js";
import { customAutotilePack, meadowPack } from "../__fixtures__/fixtures.js";
import { parseTilesetManifest } from "../parse.js";
import { writeTilesetManifest } from "../write.js";

describe("parseTilesetManifest", () => {
  it("round-trips the meadow golden fixture into a TilesetPack", () => {
    const result = parseTilesetManifest(meadowPack);

    expect(result.diagnostics).toEqual([]);
    expect(result.value).toBeDefined();
    expect(result.value?.schemaVersion).toBe(1);
    expect(result.value?.name).toBe("Meadow Pack");
    expect(result.value?.tilesets).toHaveLength(1);
    expect(result.value?.tilesets[0]?.tiles).toHaveLength(2);
    expect(result.value?.tilesets[0]?.autotileRules[0]?._tag).toBe("wang2corner");
    expect(Option.isSome(result.value?.tilesets[0]?.tiles[0]?.collisionMask ?? Option.none())).toBe(
      true,
    );
  });

  it("decodes custom autotile rules with preserved source metadata", () => {
    const result = parseTilesetManifest(customAutotilePack);

    expect(result.diagnostics).toEqual([]);
    expect(result.value?.tilesets[0]?.autotileRules[0]).toBeInstanceOf(CustomAutotileRule);
    expect(result.value?.tilesets[0]?.autotileRules[0]?.source).toEqual({
      kind: "tiled",
      ruleMap: "Rules/wall-1-rule1.tmx",
    });
  });

  it("round-trips manifest placeables into TilesetPack objects", () => {
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
      tags: ["prop", "tiled:type=statue"],
      placementMode: "object",
      source: {
        format: "tiled",
        tilesetName: "Props",
        localTileId: 0,
        objectClass: "statue",
        image: "Props/statue.png",
        imageWidth: 96,
        imageHeight: 128,
        properties: {},
      },
    };

    const first = parseTilesetManifest({
      ...meadowPack,
      placeables: [placeable],
    });
    const written = writeTilesetManifest(first.value!, {
      provenance: meadowPack.provenance,
    });
    const second = parseTilesetManifest(written);

    expect(first.diagnostics).toEqual([]);
    expect(first.value?.placeables).toHaveLength(1);
    expect(first.value?.placeables?.[0]).toMatchObject({
      id: placeable.id,
      name: "Sample Statue",
      size: { width: 96, height: 128 },
    });
    expect(second.value?.placeables?.[0]).toEqual(first.value?.placeables?.[0]);
    expect(written).toMatchObject({ placeables: [placeable] });
  });

  it("rejects placeables with unknown frame assets", () => {
    const result = parseTilesetManifest({
      ...meadowPack,
      placeables: [
        {
          id: "placeable:62656465-0000-4000-8000-000000000010",
          name: "Broken Statue",
          size: { width: 96, height: 128 },
          frames: [
            {
              assetId: "asset:62656465-0000-4000-8000-000000009999",
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
            properties: {},
          },
        },
      ],
    });

    expect(result.value).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _tag: "InvalidManifestField",
          path: "/placeables/0/frames/0/assetId",
        }),
      ]),
    );
  });

  it("keeps parsing when a placeable frame tile is object-only", () => {
    const result = parseTilesetManifest({
      ...meadowPack,
      placeables: [
        {
          id: "placeable:62656465-0000-4000-8000-000000000011",
          name: "External Tile Statue",
          size: { width: 96, height: 128 },
          frames: [
            {
              assetId: meadowPack.assets[0]!.id,
              tileId: "tile:62656465-0000-4000-8000-000000009999",
              uv: { x: 0, y: 0, w: 96, h: 128 },
            },
          ],
          tags: ["prop"],
          placementMode: "object",
          source: {
            format: "tiled",
            tilesetName: "Props",
            localTileId: 0,
            properties: {},
          },
        },
      ],
    });

    expect(result.value).toBeDefined();
    expect(result.value?.placeables).toHaveLength(1);
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects unknown autotile patterns with a typed diagnostic", () => {
    const result = parseTilesetManifest({
      ...meadowPack,
      autotileRules: [
        {
          _tag: "wang3corner",
          tilesetId: meadowPack.tilesets[0]!.id,
          id: meadowPack.autotileRules[0]!.id,
          name: "bad",
          terrainClasses: ["grass"],
          maskToTileIds: { "0001": [meadowPack.tiles[0]!.id] },
        },
      ],
    });

    expect(result.value).toBeUndefined();
    expect(diagnosticTag(result.diagnostics[0]!)).toBe("UnknownAutotilePattern");
  });

  it("rejects manifests with missing terrain class declarations", () => {
    const result = parseTilesetManifest({
      ...meadowPack,
      terrainClasses: ["grass"],
      tiles: [
        {
          ...meadowPack.tiles[0]!,
          terrainClass: "sand",
        },
      ],
    });

    expect(result.value).toBeUndefined();
    expect(diagnosticTag(result.diagnostics[0]!)).toBe("MissingTerrainClassRef");
    expect(result.diagnostics[0]?.path).toBe("/tiles/0/terrainClass");
  });

  it("rejects malformed manifests with schema diagnostics", () => {
    const result = parseTilesetManifest({
      schemaVersion: 1,
      name: "Missing required pack fields",
    });

    expect(result.value).toBeUndefined();
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics.every((diagnostic) => diagnosticTag(diagnostic) === "InvalidManifestField")).toBe(
      true,
    );
  });

  it("is idempotent under parse -> write -> parse for pack semantics", () => {
    const first = parseTilesetManifest(meadowPack);
    const written = writeTilesetManifest(first.value!, {
      provenance: meadowPack.provenance,
    });
    const second = parseTilesetManifest(written);

    expect(second.diagnostics).toEqual([]);
    expect(second.value).toEqual(first.value);
  });

  it("keeps canonical manifest hashes stable through write and read", () => {
    const placeable = {
      id: "placeable:62656465-0000-4000-8000-000000000012",
      name: "Hash Stable Statue",
      size: { width: 96, height: 128 },
      frames: [
        {
          assetId: meadowPack.assets[0]!.id,
          tileId: meadowPack.tiles[0]!.id,
          uv: { x: 0, y: 0, w: 96, h: 128 },
        },
      ],
      tags: ["prop", "hash-stable"],
      placementMode: "object",
      source: {
        format: "tiled",
        tilesetName: "Props",
        localTileId: 0,
        objectClass: "statue",
        image: "Props/statue.png",
        imageWidth: 96,
        imageHeight: 128,
        properties: {},
      },
    };
    const first = parseTilesetManifest({
      ...meadowPack,
      placeables: [placeable],
    });
    const written = writeTilesetManifest(first.value!, {
      provenance: meadowPack.provenance,
    });
    const second = parseTilesetManifest(written);
    const rewritten = writeTilesetManifest(second.value!, {
      provenance: meadowPack.provenance,
    });

    expect(second.diagnostics).toEqual([]);
    expect(hashJsonStable(rewritten)).toBe(hashJsonStable(written));
    expect(written).toMatchObject({
      license: expect.objectContaining({ redistributable: false }),
      provenance: meadowPack.provenance,
      placeables: [expect.objectContaining({ placementMode: "object" })],
    });
  });

  it("matches a stable written manifest snapshot", () => {
    const parsed = parseTilesetManifest(meadowPack);
    const written = writeTilesetManifest(parsed.value!, {
      provenance: meadowPack.provenance,
    });

    expect(written).toMatchSnapshot();
  });
});
