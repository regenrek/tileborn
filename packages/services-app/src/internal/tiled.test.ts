import {
  MapObject,
  MapObjectPlacement,
  ObjectLayer,
  TileChunk,
  TileLayer,
  makeAssetId,
  makeLayerId,
  makeMapId,
  makeObjectId,
  makePackId,
  makePlaceableId,
  makeTileId,
} from "@tileborne/core";
import { Option } from "effect";
import { describe, expect, it } from "vitest";

import { exportMapToTiled } from "./tiled.js";

const UUID = "00000000-0000-4000-8000-000000000001";

describe("exportMapToTiled", () => {
  it("exports tile layers and object placement metadata", () => {
    const tileLayerId = makeLayerId(UUID);
    const objectLayerId = makeLayerId("00000000-0000-4000-8000-000000000002");
    const objectId = makeObjectId("00000000-0000-4000-8000-000000000003");

    const map = {
      id: makeMapId(UUID),
      schemaVersion: 1 as const,
      size: { width: 2, height: 2 },
      tileSize: { width: 32, height: 32 },
      layers: [
        new TileLayer({
          id: tileLayerId,
          name: "ground",
          visible: true,
          opacity: 1,
          chunks: [new TileChunk({ x: 0, y: 0, width: 2, height: 2, tiles: [1, 0, 0, 2] })],
        }),
        new ObjectLayer({
          id: objectLayerId,
          name: "objects",
          visible: true,
          opacity: 1,
          objectIds: [objectId],
        }),
      ],
      objects: [
        new MapObject({
          id: objectId,
          kind: "statue",
          x: 64,
          y: 96,
          width: Option.some(96),
          height: Option.some(128),
          layerId: objectLayerId,
          properties: {},
          placement: new MapObjectPlacement({
            packId: Option.some(makePackId("00000000-0000-4000-8000-000000000007")),
            placeableId: makePlaceableId("00000000-0000-4000-8000-000000000004"),
            source: "tiled-object",
            assetId: Option.some(makeAssetId("00000000-0000-4000-8000-000000000005")),
            tileId: Option.some(makeTileId("00000000-0000-4000-8000-000000000006")),
            gid: Option.some(1),
          }),
        }),
      ],
      properties: {},
    };

    const exported = exportMapToTiled(map);

    expect(exported).toMatchObject({
      type: "map",
      width: 2,
      height: 2,
      tilewidth: 32,
      tileheight: 32,
      layers: [
        { name: "ground", type: "tilelayer", data: [1, 0, 0, 2] },
        {
          name: "objects",
          type: "objectgroup",
          objects: [
            {
              name: "statue",
              type: "statue",
              x: 64,
              y: 96,
              width: 96,
              height: 128,
              placement: {
                packId: "pack:00000000-0000-4000-8000-000000000007",
                placeableId: "placeable:00000000-0000-4000-8000-000000000004",
                source: "tiled-object",
                assetId: "asset:00000000-0000-4000-8000-000000000005",
                tileId: "tile:00000000-0000-4000-8000-000000000006",
                gid: 1,
              },
            },
          ],
        },
      ],
    });
  });
});
