import { Option } from "effect";
import { describe, expect, it } from "vitest";

import { makeTileId, type Uuid } from "@tileborne/core";

import { compileTiledSourceWallRulePhase, importTiledSource } from "../index.js";
import type { TiledSourceReadFile } from "../import.js";

const SOURCE_ROOT = "/tiled-source";
const TILESET_PATH = "TiledMap Editor/Tilesets/test.tsx";
const MAP_PATH = "TiledMap Editor/sample.tmx";
const RULE_PATH = "TiledMap Editor/Rules/wall-test.tmx";
const PNG_BYTES = new Uint8Array([137, 80, 78, 71]);

const readFrom = (files: Readonly<Record<string, string | Uint8Array>>): TiledSourceReadFile =>
  (path) => {
    const normalized = path.replaceAll("\\", "/");
    const value = files[normalized];
    if (value === undefined) {
      throw new Error(`missing fixture: ${normalized}`);
    }
    return value;
  };

const baseTsx = `<?xml version="1.0" encoding="UTF-8"?>
<tileset name="wall-test" tilewidth="16" tileheight="16" tilecount="4" columns="2">
  <image source="../../Tilesets/test.png" width="32" height="32"/>
  <tile id="1" probability="0.5">
    <animation>
      <frame tileid="1" duration="80"/>
      <frame tileid="2" duration="120"/>
    </animation>
  </tile>
  <wangsets>
    <wangset name="wall-test" type="corner" tile="1">
      <wangcolor name="wall" color="#ff0000" tile="1" probability="1"/>
      <wangtile tileid="1" wangid="0,1,0,1,0,1,0,1"/>
    </wangset>
  </wangsets>
</tileset>`;

const noAnimationTsx = `<?xml version="1.0" encoding="UTF-8"?>
<tileset name="waterfall-test" tilewidth="16" tileheight="16" tilecount="2" columns="2">
  <image source="../../Tilesets/waterfall.png" width="32" height="16"/>
</tileset>`;

const imageCollectionTsx = `<?xml version="1.0" encoding="UTF-8"?>
<tileset name="Atlas-Props-Sprites" tilewidth="96" tileheight="128" tilecount="1" columns="0">
  <tile id="0" type="statue">
    <image width="96" height="128" source="../../Props/statue.png"/>
  </tile>
</tileset>`;

const unityMeta = `fileFormatVersion: 2
TextureImporter:
  spriteSheet:
    sprites:
    - serializedVersion: 2
      name: waterfall_0
      rect:
        serializedVersion: 2
        x: 0
        y: 0
        width: 16
        height: 16
    - serializedVersion: 2
      name: waterfall_1
      rect:
        serializedVersion: 2
        x: 16
        y: 0
        width: 16
        height: 16
`;

const sampleMap = `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.10" orientation="orthogonal" width="1" height="1" tilewidth="16" tileheight="16">
  <tileset firstgid="1" source="Tilesets/test.tsx"/>
  <layer id="1" name="ground" width="1" height="1">
    <data encoding="csv">1</data>
  </layer>
  <objectgroup id="2" name="spawns">
    <object id="1" name="Player Spawn" type="spawn" x="4" y="8">
      <point/>
    </object>
  </objectgroup>
</map>`;

const wallRule = `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.10" orientation="orthogonal" width="3" height="3" tilewidth="16" tileheight="16">
  <tileset firstgid="1" source="../Tilesets/test.tsx"/>
  <layer id="1" name="input_walls" width="3" height="3">
    <data encoding="csv">0,1,0,1,1,1,0,1,0</data>
  </layer>
  <layer id="2" name="output_walls" width="3" height="3">
    <data encoding="csv">0,0,0,0,2,0,0,0,0</data>
  </layer>
</map>`;

const tileId = (localTileId: number) =>
  makeTileId(`62656465-0000-4000-8000-${String(localTileId).padStart(12, "0")}` as Uuid);

const hasAnimation = (tile: { readonly animation: Option.Option<unknown> }): boolean =>
  Option.match(tile.animation, {
    onNone: () => false,
    onSome: () => true,
  });

describe("Tiled source importer", () => {
  it("round-trips synthetic TSX and TMX fixtures into a TilesetPack", async () => {
    const result = await importTiledSource({
      sourceRoot: SOURCE_ROOT,
      readFile: readFrom({
        [`${SOURCE_ROOT}/${TILESET_PATH}`]: baseTsx,
        [`${SOURCE_ROOT}/${MAP_PATH}`]: sampleMap,
        [`${SOURCE_ROOT}/${RULE_PATH}`]: wallRule,
        [`${SOURCE_ROOT}/Tilesets/test.png`]: PNG_BYTES,
      }),
      tsxFiles: [TILESET_PATH],
      mapFiles: [MAP_PATH],
      ruleFiles: [RULE_PATH],
      importedAt: "2026-05-23T00:00:00.000Z",
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(result.value?.tilesets).toHaveLength(1);
    const tileset = result.value!.tilesets[0]!;
    expect(tileset.tiles).toHaveLength(4);
    expect(tileset.autotileRules.length).toBeGreaterThanOrEqual(2);
    expect(tileset.variantFilters).toHaveLength(1);
    expect(hasAnimation(tileset.tiles[1]!)).toBe(true);
    expect(result.maps[0]?.layers.some((layer) => layer.kind === "object" && layer.role === "spawn")).toBe(true);
    expect(result.provenance.importedAt).toBe("2026-05-23T00:00:00.000Z");
  });

  it("uses Unity meta sprites as an animation fallback", async () => {
    const result = await importTiledSource({
      sourceRoot: SOURCE_ROOT,
      readFile: readFrom({
        [`${SOURCE_ROOT}/${TILESET_PATH}`]: noAnimationTsx,
        [`${SOURCE_ROOT}/Tilesets/waterfall.png`]: PNG_BYTES,
        [`${SOURCE_ROOT}/Tilesets/waterfall.png.meta`]: unityMeta,
      }),
      tsxFiles: [TILESET_PATH],
      mapFiles: [],
      ruleFiles: [],
    });

    const tile = result.value!.tilesets[0]!.tiles[0]!;
    expect(hasAnimation(tile)).toBe(true);
  });

  it("keeps image-collection props as placeables", async () => {
    const propsPath = "TiledMap Editor/Tilesets/props.tsx";
    const result = await importTiledSource({
      sourceRoot: SOURCE_ROOT,
      readFile: readFrom({
        [`${SOURCE_ROOT}/${propsPath}`]: imageCollectionTsx,
        [`${SOURCE_ROOT}/Props/statue.png`]: PNG_BYTES,
      }),
      tsxFiles: [propsPath],
      mapFiles: [],
      ruleFiles: [],
    });

    expect(result.value?.placeables).toHaveLength(1);
    expect(result.value?.placeables?.[0]?.size).toMatchObject({ width: 96, height: 128 });
    expect(result.value?.assets.some((asset) => asset.path === "Props/statue.png")).toBe(true);
  });

  it("reports missing referenced images", async () => {
    const result = await importTiledSource({
      sourceRoot: SOURCE_ROOT,
      readFile: readFrom({
        [`${SOURCE_ROOT}/${TILESET_PATH}`]: baseTsx,
      }),
      tsxFiles: [TILESET_PATH],
      mapFiles: [],
      ruleFiles: [],
    });

    expect(result.diagnostics.some((diagnostic) => diagnostic._tag === "TiledSourceMissingImageRef")).toBe(true);
  });

  it("compiles Tiled source wall rule phases into wang rules", () => {
    const rule = compileTiledSourceWallRulePhase({
      rulePath: RULE_PATH,
      raw: wallRule,
      tileIdForSource: (_sourcePath, localTileId) => tileId(localTileId),
    });

    expect(rule.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(rule.value?.rule._tag).toBe("wang4corner");
  });

  it("preserves per-tile provenance in tags and importer metadata", async () => {
    const result = await importTiledSource({
      sourceRoot: SOURCE_ROOT,
      readFile: readFrom({
        [`${SOURCE_ROOT}/${TILESET_PATH}`]: baseTsx,
        [`${SOURCE_ROOT}/Tilesets/test.png`]: PNG_BYTES,
      }),
      tsxFiles: [TILESET_PATH],
      mapFiles: [],
      ruleFiles: [],
    });

    const firstTile = result.value!.tilesets[0]!.tiles[0]!;
    expect(firstTile.tags).toContain(`tiled-source:source=${TILESET_PATH}`);
    expect(result.tileProvenance[0]).toMatchObject({ sourcePath: TILESET_PATH, localTileId: 0 });
  });
});
