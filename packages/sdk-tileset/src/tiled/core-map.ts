import {
  ImageLayer,
  MapObject,
  MapObjectPlacement,
  ObjectLayer,
  TileChunk,
  TileLayer,
  makeTileborneMap,
  type AssetId,
  type LayerId,
  type ObjectId,
  type PackId,
  type PlaceableId,
  type TileId,
  type TileborneMap,
} from "@tileborne/core";
import { Option } from "effect";

import { deterministicLayerId, deterministicMapId, deterministicObjectId } from "./deterministic-ids.js";
import type { TiledMapImport, TiledMapObject } from "./types.js";

const chunkFromCells = (
  width: number,
  height: number,
  cells: readonly { readonly tileIndex: number }[],
  chunkWidth = 32,
  chunkHeight = 32,
): readonly TileChunk[] => {
  const chunks: TileChunk[] = [];
  for (let cy = 0; cy < height; cy += chunkHeight) {
    for (let cx = 0; cx < width; cx += chunkWidth) {
      const cw = Math.min(chunkWidth, width - cx);
      const ch = Math.min(chunkHeight, height - cy);
      const tiles: number[] = [];
      for (let y = 0; y < ch; y += 1) {
        for (let x = 0; x < cw; x += 1) {
          tiles.push(cells[(cy + y) * width + cx + x]?.tileIndex ?? 0);
        }
      }
      chunks.push(new TileChunk({ x: cx, y: cy, width: cw, height: ch, tiles }));
    }
  }
  return chunks;
};

const layerIdFor = (seed: string, sourceId: string): LayerId =>
  deterministicLayerId(`${seed}/layer/${sourceId}`);

const objectIdFor = (seed: string, sourceId: string): ObjectId =>
  deterministicObjectId(`${seed}/object/${sourceId}`);

const corePlacement = (
  placement: TiledMapObject["placement"] | undefined,
  packId: PackId | undefined,
): MapObjectPlacement | undefined =>
  placement === undefined
    ? undefined
    : new MapObjectPlacement({
        packId: packId === undefined ? Option.none() : Option.some(packId),
        placeableId: placement.placeableId as PlaceableId,
        source: placement.source,
        assetId: Option.some(placement.assetId as AssetId),
        tileId: Option.some(placement.tileId as TileId),
        gid: Option.some(placement.gid),
      });

export const compileTileborneMap = (input: {
  readonly map: TiledMapImport;
  readonly sourcePath: string;
  readonly mapIdSeed?: string;
  readonly packId?: PackId;
}): TileborneMap => {
  const seed = input.mapIdSeed ?? input.sourcePath;
  const layers: Array<TileborneMap["layers"][number]> = [];
  const objects: MapObject[] = [];
  const objectIdsByLayerId = new Map<string, ObjectId[]>();
  const objectLayerMeta = new Map<
    string,
    { readonly name: string; readonly visible: boolean; readonly opacity: number }
  >();

  for (const layer of input.map.layers) {
    if (layer.kind === "tile") {
      const id = layerIdFor(seed, layer.id);
      const chunks = chunkFromCells(layer.width, layer.height, layer.cells);
      layers.push(new TileLayer({ id, name: layer.name, visible: layer.visible, opacity: layer.opacity, chunks: [...chunks] }));
      continue;
    }
    if (layer.kind === "image") {
      layers.push(
        new ImageLayer({
          id: layerIdFor(seed, layer.id),
          name: layer.name,
          visible: layer.visible,
          opacity: layer.opacity,
          assetId: layer.image as AssetId,
          x: layer.x ?? 0,
          y: layer.y ?? 0,
        }),
      );
      continue;
    }
    if (layer.kind === "group") {
      continue;
    }
    const layerId = layerIdFor(seed, layer.layerId);
    const objectId = objectIdFor(seed, layer.id);
    objectLayerMeta.set(String(layerId), {
      name: layer.layerName,
      visible: layer.layerVisible,
      opacity: layer.layerOpacity,
    });
    objectIdsByLayerId.set(String(layerId), [...(objectIdsByLayerId.get(String(layerId)) ?? []), objectId]);
    objects.push(
      new MapObject({
        id: objectId,
        kind: layer.class ?? layer.role,
        x: layer.x,
        y: layer.y,
        width: layer.width === undefined ? Option.none() : Option.some(layer.width),
        height: layer.height === undefined ? Option.none() : Option.some(layer.height),
        layerId,
        properties: layer.properties,
        ...(layer.placement === undefined ? {} : { placement: corePlacement(layer.placement, input.packId) }),
      }),
    );
  }

  for (const [layerId, objectIds] of objectIdsByLayerId) {
    const meta = objectLayerMeta.get(layerId);
    layers.push(
      new ObjectLayer({
        id: layerId as LayerId,
        name: meta?.name ?? "objects",
        visible: meta?.visible ?? true,
        opacity: meta?.opacity ?? 1,
        objectIds,
      }),
    );
  }

  return makeTileborneMap({
    id: deterministicMapId(`${seed}/map`),
    width: input.map.width,
    height: input.map.height,
    tileWidth: input.map.tileWidth,
    tileHeight: input.map.tileHeight,
    layers,
    objects,
    properties: input.map.properties,
  });
};
