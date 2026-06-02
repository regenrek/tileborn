import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  MapObject,
  MapObjectPlacement,
  ObjectLayer,
  TileTransform,
  TileborneMap,
  gameObjectTypeIdForKey,
  type Uuid,
  makeAssetId,
  makeLayerId,
  makePackId,
  makeObjectId,
  makePlaceableId,
  makeTileId,
  type ProjectId,
} from "@tileborne/core";
import { FoundationLayer } from "@tileborne/services-foundation";
import { Effect, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";

import { ServicesAppLayer } from "../../index.js";
import { ProjectService } from "../../project/index.js";
import { withTempHome } from "../../test-utils.js";
import { MapService, toMapIpcPayload } from "../index.js";

const appLayer = ServicesAppLayer.pipe(Layer.provideMerge(FoundationLayer));

const runApp = <A, E>(effect: Effect.Effect<A, E, ProjectService | MapService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(appLayer)));

const projectDir = (home: string, projectId: ProjectId) => path.join(home, "projects", projectId);

describe("MapService placement persistence", () => {
  it("loads persisted objects that omit optional object fields", () =>
    withTempHome(async () => {
      await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const projectId = yield* projects.create({ name: "Optional Object Fields" });
          const mapId = yield* maps.create(projectId, { width: 8, height: 8 });
          const base = yield* maps.load(projectId, mapId);
          const layerId = makeLayerId("00000000-0000-4000-8000-000000000062" as Uuid);
          const objectId = makeObjectId("00000000-0000-4000-8000-000000000063" as Uuid);
          const objectLayer = new ObjectLayer({
            id: layerId,
            name: "objects",
            visible: true,
            opacity: 1,
            objectIds: [objectId],
          });
          const object = new MapObject({
            id: objectId,
            kind: gameObjectTypeIdForKey("prop"),
            x: 64,
            y: 96,
            width: Option.none(),
            height: Option.none(),
            layerId,
            properties: {},
          });
          const updated = new TileborneMap({
            id: base.id,
            schemaVersion: base.schemaVersion,
            size: base.size,
            tileSize: base.tileSize,
            layers: [...base.layers, objectLayer],
            objects: [object],
            properties: base.properties,
          });

          yield* maps.save(projectId, updated);
          const loaded = yield* maps.load(projectId, mapId);

          expect(loaded.objects[0]?.id).toBe(objectId);
          expect(Option.isNone(loaded.objects[0]?.width ?? Option.some(0))).toBe(true);
          expect(Option.isNone(loaded.objects[0]?.height ?? Option.some(0))).toBe(true);
          expect(loaded.objects[0]?.placement).toBeUndefined();
          expect(toMapIpcPayload(loaded)).toMatchObject({
            objects: [{ width: undefined, height: undefined, placement: undefined }],
          });
        }),
      );
    }));

  it("round-trips MapObjectPlacement through save and load", () =>
    withTempHome(async (home) => {
      const ids = {
        layer: makeLayerId("00000000-0000-4000-8000-000000000052" as Uuid),
        object: makeObjectId("00000000-0000-4000-8000-000000000053" as Uuid),
        placeable: makePlaceableId("00000000-0000-4000-8000-000000000054" as Uuid),
        asset: makeAssetId("00000000-0000-4000-8000-000000000055" as Uuid),
        tile: makeTileId("00000000-0000-4000-8000-000000000056" as Uuid),
        pack: makePackId("00000000-0000-4000-8000-000000000057" as Uuid),
      };

      const { projectId, mapId, loaded } = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const projectId = yield* projects.create({ name: "Placement Roundtrip" });
          const mapId = yield* maps.create(projectId, { width: 8, height: 8 });
          const base = yield* maps.load(projectId, mapId);
          const objectLayer = new ObjectLayer({
            id: ids.layer,
            name: "objects",
            visible: true,
            opacity: 1,
            objectIds: [ids.object],
          });
          const object = new MapObject({
            id: ids.object,
            kind: gameObjectTypeIdForKey("placeable"),
            x: 64,
            y: 96,
            width: Option.some(96),
            height: Option.some(128),
            layerId: ids.layer,
            properties: {},
            placement: new MapObjectPlacement({
              packId: Option.some(ids.pack),
              placeableId: ids.placeable,
              source: "manual",
              assetId: Option.some(ids.asset),
              tileId: Option.some(ids.tile),
              gid: Option.some(7),
              transform: new TileTransform({
                flippedHorizontal: true,
                flippedVertical: false,
                flippedDiagonal: false,
                rotatedHexagonal120: false,
              }),
            }),
          });
          const updated = new TileborneMap({
            id: base.id,
            schemaVersion: base.schemaVersion,
            size: base.size,
            tileSize: base.tileSize,
            layers: [...base.layers, objectLayer],
            objects: [object],
            properties: base.properties,
          });
          yield* maps.save(projectId, updated);
          const loaded = yield* maps.load(projectId, mapId);
          return { projectId, mapId, loaded };
        }),
      );

      const persisted = JSON.parse(
        await readFile(path.join(projectDir(home, projectId), "maps", `${mapId}.json`), "utf8"),
      ) as {
        readonly objects?: readonly {
          readonly placement?: {
            readonly packId?: string;
            readonly placeableId?: string;
            readonly source?: string;
            readonly assetId?: string;
            readonly tileId?: string;
            readonly gid?: number;
            readonly transform?: {
              readonly flippedHorizontal: boolean;
              readonly flippedVertical: boolean;
              readonly flippedDiagonal: boolean;
              readonly rotatedHexagonal120: boolean;
            };
          };
        }[];
      };

      expect(persisted.objects?.[0]?.placement).toStrictEqual({
        packId: ids.pack,
        placeableId: ids.placeable,
        source: "manual",
        assetId: ids.asset,
        tileId: ids.tile,
        gid: 7,
        transform: {
          flippedHorizontal: true,
          flippedVertical: false,
          flippedDiagonal: false,
          rotatedHexagonal120: false,
        },
      });

      const placement = loaded.objects[0]?.placement;
      expect(Option.getOrUndefined(placement?.packId ?? Option.none())).toBe(ids.pack);
      expect(placement?.placeableId).toBe(ids.placeable);
      expect(placement?.source).toBe("manual");
      expect(Option.getOrUndefined(placement?.assetId ?? Option.none())).toBe(ids.asset);
      expect(Option.getOrUndefined(placement?.tileId ?? Option.none())).toBe(ids.tile);
      expect(Option.getOrUndefined(placement?.gid ?? Option.none())).toBe(7);
      expect(placement?.transform).toMatchObject({
        flippedHorizontal: true,
        flippedVertical: false,
        flippedDiagonal: false,
        rotatedHexagonal120: false,
      });
    }));

  it("round-trips placements that omit optional nested refs", () =>
    withTempHome(async (home) => {
      const ids = {
        layer: makeLayerId("00000000-0000-4000-8000-000000000072" as Uuid),
        object: makeObjectId("00000000-0000-4000-8000-000000000073" as Uuid),
        placeable: makePlaceableId("00000000-0000-4000-8000-000000000074" as Uuid),
      };

      const { projectId, mapId, loaded } = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const projectId = yield* projects.create({ name: "Placement Optional Refs" });
          const mapId = yield* maps.create(projectId, { width: 8, height: 8 });
          const base = yield* maps.load(projectId, mapId);
          const objectLayer = new ObjectLayer({
            id: ids.layer,
            name: "objects",
            visible: true,
            opacity: 1,
            objectIds: [ids.object],
          });
          const object = new MapObject({
            id: ids.object,
            kind: gameObjectTypeIdForKey("placeable"),
            x: 64,
            y: 96,
            width: Option.some(96),
            height: Option.some(128),
            layerId: ids.layer,
            properties: {},
            placement: new MapObjectPlacement({
              packId: Option.none(),
              placeableId: ids.placeable,
              source: "manual",
              assetId: Option.none(),
              tileId: Option.none(),
              gid: Option.none(),
            }),
          });
          const updated = new TileborneMap({
            id: base.id,
            schemaVersion: base.schemaVersion,
            size: base.size,
            tileSize: base.tileSize,
            layers: [...base.layers, objectLayer],
            objects: [object],
            properties: base.properties,
          });
          yield* maps.save(projectId, updated);
          const loaded = yield* maps.load(projectId, mapId);
          return { projectId, mapId, loaded };
        }),
      );

      const persisted = JSON.parse(
        await readFile(path.join(projectDir(home, projectId), "maps", `${mapId}.json`), "utf8"),
      ) as {
        readonly objects?: readonly {
          readonly placement?: Record<string, unknown>;
        }[];
      };

      expect(persisted.objects?.[0]?.placement).toStrictEqual({
        placeableId: ids.placeable,
        source: "manual",
      });

      const placement = loaded.objects[0]?.placement;
      expect(placement?.placeableId).toBe(ids.placeable);
      expect(placement?.source).toBe("manual");
      expect(Option.isNone(placement?.assetId ?? Option.some(""))).toBe(true);
      expect(Option.isNone(placement?.tileId ?? Option.some(""))).toBe(true);
      expect(Option.isNone(placement?.gid ?? Option.some(0))).toBe(true);
      expect(toMapIpcPayload(loaded)).toMatchObject({
        objects: [
          {
            placement: {
              assetId: undefined,
              tileId: undefined,
              gid: undefined,
            },
          },
        ],
      });
    }));
});
