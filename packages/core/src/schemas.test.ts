import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  makeAssetId,
  makeLayerId,
  makeMapId,
  makeObjectId,
  makePackId,
  makePlaceableId,
  makeProjectId,
  makeTileId,
  makeTileSetId,
} from "./ids.js";
import { PackCapability } from "./asset/index.js";
import {
  BrandConfigSummary,
  ProjectManifest,
  AssetPackManifestSummary,
  makeAssetPackManifestSummary,
  makeProjectManifest,
} from "./project/index.js";
import {
  CollisionLayerPersisted,
  ImageLayerPersisted,
  MapLayer,
  MapObject,
  MapObjectPlacement,
  ObjectLayerPersisted,
  TileLayerPersisted,
  TileborneMap,
  TileChunk,
  TileTransform,
} from "./map/index.js";
import { Asset, Tile, TileSet } from "./tileset/index.js";
import { hashJsonStable } from "./hashing/index.js";

const UUID = "550e8400-e29b-41d4-a716-446655440000";

const roundTrip = <A, I>(schema: Schema.Top, value: I) => {
  const codec = schema as Schema.Codec<A, I, never, never>;
  const decoded = Schema.decodeUnknownSync(codec)(value);
  const encoded = Schema.encodeSync(codec)(decoded);
  expect(encoded).toEqual(value);
};

describe("schema round-trips", () => {
  it("ProjectManifest", () => {
    roundTrip(ProjectManifest, {
      id: makeProjectId(UUID),
      name: "Example",
      schemaVersion: 1,
      engineVersion: "0.1.0",
      plugins: [{ id: "@tileborne-plugins/battle-royale", version: "0.1.0" }],
      assetPacks: [{ id: "kenney.tiny-dungeon", version: "1.0.0" }],
      maps: [{ id: "map_01", path: "maps/map_01.tileborne-map.json" }],
    });
  });

  it("AssetPackManifestSummary", () => {
    const hash = hashJsonStable({ id: "kenney.tiny-dungeon" });
    roundTrip(
      AssetPackManifestSummary,
      makeAssetPackManifestSummary({
        id: "kenney.tiny-dungeon",
        version: "1.0.0",
        displayName: "Tiny Dungeon",
        contentHash: hash,
      }),
    );
  });

  it("PackCapability", () => {
    roundTrip(PackCapability, {
      packId: makePackId(UUID),
      paintable: false,
      tilesetCount: 0,
      tileCount: 0,
      placeableCount: 0,
      autotileRuleCount: 0,
      terrainClassCount: 0,
      hasAnimations: false,
      hasCollisionMasks: false,
      source: "asset-only",
      diagnostics: [
        {
          _tag: "PACK.missing-asset",
          assetId: "asset:550e8400-e29b-41d4-a716-446655440001",
          path: "/tilesets/0/atlasAssetId",
          message: "Tileset atlas asset is missing or not an image.",
        },
      ],
    });
  });

  it("BrandConfigSummary", () => {
    roundTrip(BrandConfigSummary, {
      title: "Tileborne",
      schemaVersion: 1,
      palette: { primary: "#336699" },
      lobbyCopy: { tagline: "Build worlds", cta: "Play" },
    });
  });

  it("TileborneMap and layer union", () => {
    const layerId = makeLayerId(UUID);
    const objectId = makeObjectId(UUID);

    roundTrip(TileTransform, {
      flippedHorizontal: true,
      flippedVertical: false,
      flippedDiagonal: true,
      rotatedHexagonal120: false,
    });

    roundTrip(TileChunk, { x: 0, y: 0, width: 16, height: 16, tiles: [1, 0, 2] });
    roundTrip(TileChunk, {
      x: 0,
      y: 0,
      width: 2,
      height: 1,
      tiles: [1, 2],
      transforms: [
        {
          flippedHorizontal: true,
          flippedVertical: false,
          flippedDiagonal: false,
          rotatedHexagonal120: false,
        },
        {
          flippedHorizontal: false,
          flippedVertical: true,
          flippedDiagonal: true,
          rotatedHexagonal120: false,
        },
      ],
    });

    roundTrip(TileLayerPersisted, {
      kind: "tile",
      id: layerId,
      name: "Ground",
      visible: true,
      opacity: 1,
      chunks: [],
    });

    roundTrip(ObjectLayerPersisted, {
      kind: "object",
      id: layerId,
      name: "Objects",
      visible: true,
      opacity: 1,
      objectIds: [objectId],
    });

    roundTrip(ImageLayerPersisted, {
      kind: "image",
      id: layerId,
      name: "Backdrop",
      visible: true,
      opacity: 0.5,
      assetId: makeAssetId(UUID),
      x: 0,
      y: 0,
    });

    roundTrip(CollisionLayerPersisted, {
      kind: "collision",
      id: layerId,
      name: "Collision",
      visible: false,
      opacity: 1,
      chunks: [],
    });

    roundTrip(MapObject, {
      id: objectId,
      kind: "spawn",
      x: 32,
      y: 64,
      width: undefined,
      height: undefined,
      layerId,
      properties: { weight: 1 },
    });

    roundTrip(MapObjectPlacement, {
      packId: makePackId(UUID),
      placeableId: makePlaceableId(UUID),
      source: "tiled-object",
      assetId: makeAssetId(UUID),
      tileId: makeTileId(UUID),
      gid: 1,
      transform: {
        flippedHorizontal: true,
        flippedVertical: false,
        flippedDiagonal: false,
        rotatedHexagonal120: false,
      },
    });

    roundTrip(MapObject, {
      id: objectId,
      kind: "statue",
      x: 32,
      y: 96,
      width: 96,
      height: 128,
      layerId,
      properties: {},
      placement: {
        packId: makePackId(UUID),
        placeableId: makePlaceableId(UUID),
        source: "tiled-object",
        assetId: makeAssetId(UUID),
        tileId: makeTileId(UUID),
        gid: 1,
        transform: {
          flippedHorizontal: true,
          flippedVertical: false,
          flippedDiagonal: false,
          rotatedHexagonal120: false,
        },
      },
    });

    roundTrip(TileborneMap, {
      id: makeMapId(UUID),
      schemaVersion: 1,
      size: { width: 4, height: 4 },
      tileSize: { width: 16, height: 16 },
      layers: [
        {
          kind: "tile",
          id: layerId,
          name: "Ground",
          visible: true,
          opacity: 1,
          chunks: [{ x: 0, y: 0, width: 4, height: 4, tiles: [0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }],
        },
      ],
      objects: [],
      properties: {},
    });

    roundTrip(TileborneMap, {
      id: makeMapId(UUID),
      schemaVersion: 1,
      size: { width: 64, height: 64 },
      tileSize: { width: 16, height: 16 },
      layers: [
        {
          kind: "tile",
          id: layerId,
          name: "Ground",
          visible: true,
          opacity: 1,
          chunks: [],
        },
      ],
      objects: [],
      properties: {},
    });

    roundTrip(MapLayer, {
      id: layerId,
      kind: "tile",
      name: "Ground",
      visible: true,
      opacity: 1,
      chunks: [],
    });
  });

  it("tileset entities", () => {
    roundTrip(
      Asset,
      new Asset({
        id: makeAssetId(UUID),
        kind: "image",
        path: "tiles/terrain.png",
        properties: {},
      }),
    );

    roundTrip(
      Tile,
      new Tile({
        id: makeTileId(UUID),
        localId: 0,
        width: 16,
        height: 16,
        properties: {},
      }),
    );

    roundTrip(TileSet, {
      id: makeTileSetId(UUID),
      name: "Terrain",
      kind: "grid",
      tileWidth: 16,
      tileHeight: 16,
      tileCount: 4,
      columns: 2,
      imageAssetId: makeAssetId(UUID),
      tiles: [],
      properties: {},
    });
  });
});

describe("factories", () => {
  it("builds a project manifest with defaults", () => {
    const manifest = makeProjectManifest({
      id: makeProjectId(UUID),
      name: "Example",
    });
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.engineVersion).toBe("0.1.0");
  });
});
