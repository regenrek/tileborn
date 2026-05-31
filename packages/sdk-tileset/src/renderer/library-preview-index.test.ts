import {
  AssetLibraryReference,
  makeAssetId,
  makePackId,
  makePlaceableId,
  makeTileId,
  type Uuid,
} from "@tileborne/core";
import { Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  CellSize,
  Placeable,
  PlaceableFrameRef,
  PlaceableSize,
  Tile,
  Tileset,
  TilesetId,
  TilesetPack,
  TilesetPackAsset,
  TilesetPackLicense,
  TiledPlaceableSource,
  UVRect,
} from "../schemas/index.js";
import { buildLibraryPreviewIndex } from "./library-preview-index.js";

const uuid = (suffix: string): Uuid => `660e8400-e29b-41d4-a716-${suffix.padStart(12, "0")}` as Uuid;

const packId = makePackId("a6ffcd59-011f-4f05-a4e2-832b87155ade");
const atlasAssetId = makeAssetId(uuid("010"));
const propAssetId = makeAssetId(uuid("011"));
const tileId = makeTileId(uuid("200"));
const placeableId = makePlaceableId(uuid("300"));

const pack = new TilesetPack({
  schemaVersion: 1,
  id: packId,
  name: "Sample",
  version: "1.0.0",
  license: new TilesetPackLicense({
    spdxId: "CC0-1.0",
    attribution: Option.none(),
    sourceUrl: Option.none(),
    notes: Option.none(),
    redistributable: true,
  }),
  tilesets: [
    new Tileset({
      id: Schema.decodeUnknownSync(TilesetId)(`tileset:${uuid("100")}`),
      name: "Terrain",
      atlasAssetId,
      cellSize: new CellSize({ width: 32, height: 32 }),
      margin: 0,
      spacing: 0,
      tiles: [
        new Tile({
          id: tileId,
          uv: new UVRect({ x: 64, y: 32, w: 32, h: 32 }),
          tags: [],
          terrainClass: Option.none(),
          collisionMask: Option.none(),
          animation: Option.none(),
        }),
      ],
      autotileRules: [],
      variantFilters: [],
      terrainTransitions: [],
    }),
  ],
  assets: [
    new TilesetPackAsset({ id: atlasAssetId, path: "tiles/terrain.png", mime: "image/png" }),
    new TilesetPackAsset({ id: propAssetId, path: "props/rock.png", mime: "image/png" }),
  ],
  placeables: [
    new Placeable({
      id: placeableId,
      name: "Rock",
      size: new PlaceableSize({ width: 48, height: 64 }),
      frames: [
        new PlaceableFrameRef({
          assetId: propAssetId,
          tileId: makeTileId(uuid("301")),
          uv: new UVRect({ x: 0, y: 0, w: 48, h: 64 }),
          durationMs: Option.none(),
        }),
      ],
      tags: [],
      placementMode: "object",
      source: new TiledPlaceableSource({
        format: "tiled",
        tilesetName: "Props",
        localTileId: 0,
        image: Option.some("props/rock.png"),
        imageWidth: Option.some(48),
        imageHeight: Option.some(64),
        objectType: Option.none(),
        objectClass: Option.none(),
        properties: {},
      }),
    }),
  ],
});

describe("buildLibraryPreviewIndex", () => {
  const index = buildLibraryPreviewIndex(pack);

  it("resolves a tile ref to its atlas path and uv rect", () => {
    const preview = index.previewForRef(
      new AssetLibraryReference({ packId, kind: "tile", refId: tileId, tileId }),
    );
    expect(preview).toEqual({ assetPath: "tiles/terrain.png", x: 64, y: 32, width: 32, height: 32 });
  });

  it("resolves a placeable ref to its frame asset and placeable size", () => {
    const preview = index.previewForRef(
      new AssetLibraryReference({ packId, kind: "placeable", refId: placeableId }),
    );
    expect(preview).toEqual({ assetPath: "props/rock.png", x: 0, y: 0, width: 48, height: 64 });
  });

  it("returns undefined for an unknown ref", () => {
    const preview = index.previewForRef(
      new AssetLibraryReference({ packId, kind: "tile", refId: makeTileId(uuid("999")) }),
    );
    expect(preview).toBeUndefined();
  });
});
