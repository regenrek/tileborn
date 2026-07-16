import { Option, Schema } from 'effect';
import {
  CollisionLayer,
  ImageLayer,
  makeLayerId,
  makeObjectId,
  MapObject,
  MapObjectPlacement,
  ObjectLayer,
  TileborneMap,
  TileChunk,
  TileLayer,
  TRIGGER_REGION_OBJECT_TYPE_ID,
  type GameObjectTypeId,
  type LayerId,
  type MapLayer,
  type ObjectId,
} from '@tileborne/core';

export const CHUNK_SIZE = 32;

const cloneLayer = (layer: MapLayer): MapLayer => {
  if (layer._tag === 'tile') {
    return new TileLayer({
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      chunks: layer.chunks.map(cloneChunk),
    });
  }
  if (layer._tag === 'collision') {
    return new CollisionLayer({
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      chunks: layer.chunks.map(cloneChunk),
    });
  }
  if (layer._tag === 'object') {
    return new ObjectLayer({
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      objectIds: [...layer.objectIds],
    });
  }
  if (layer._tag === 'image') {
    return new ImageLayer({
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      assetId: layer.assetId,
      x: layer.x,
      y: layer.y,
    });
  }
  return layer;
};

const cloneChunk = (chunk: TileChunk): TileChunk =>
  new TileChunk({
    x: chunk.x,
    y: chunk.y,
    width: chunk.width,
    height: chunk.height,
    tiles: [...chunk.tiles],
  });

const optionFromMaybeEncoded = <Value>(value: unknown): Option.Option<Value> => {
  if (Option.isOption(value)) {
    return value as Option.Option<Value>;
  }
  if (value === undefined || value === null) {
    return Option.none();
  }
  if (typeof value === 'object' && value !== null) {
    if (Object.keys(value).length === 0) {
      return Option.none();
    }
    if ('_tag' in value) {
      return value._tag === 'Some'
        ? Option.some((value as unknown as { readonly value: Value }).value)
        : Option.none();
    }
    if ('value' in value) {
      return Option.some((value as { readonly value: Value }).value);
    }
  }
  return Option.some(value as Value);
};

const clonePlacement = (placement: MapObject['placement']): MapObjectPlacement | undefined => {
  if (placement === undefined) {
    return undefined;
  }
  return new MapObjectPlacement({
    packId: optionFromMaybeEncoded(placement.packId),
    placeableId: placement.placeableId,
    source: placement.source,
    assetId: optionFromMaybeEncoded(placement.assetId),
    tileId: optionFromMaybeEncoded(placement.tileId),
    gid: optionFromMaybeEncoded(placement.gid),
  });
};

const cloneObject = (object: MapObject): MapObject =>
  new MapObject({
    id: object.id,
    kind: object.kind,
    x: object.x,
    y: object.y,
    width: optionFromMaybeEncoded(object.width),
    height: optionFromMaybeEncoded(object.height),
    layerId: object.layerId,
    properties: { ...object.properties },
    placement: clonePlacement(object.placement),
  });

interface RebuildMapOverrides {
  readonly layers?: readonly MapLayer[] | undefined;
  readonly objects?: readonly MapObject[] | undefined;
  readonly properties?: TileborneMap['properties'] | undefined;
}

export const rebuildMap = (map: TileborneMap, overrides: RebuildMapOverrides = {}): TileborneMap =>
  new TileborneMap({
    id: map.id,
    schemaVersion: map.schemaVersion,
    size: map.size,
    tileSize: map.tileSize,
    layers: (overrides.layers ?? map.layers).map(cloneLayer),
    objects: (overrides.objects ?? map.objects).map(cloneObject),
    properties: { ...(overrides.properties ?? map.properties) },
  });

export const findTileLayer = (map: TileborneMap, layerId?: LayerId): TileLayer | undefined => {
  if (layerId) {
    const layer = map.layers.find((entry) => entry._tag === 'tile' && entry.id === layerId);
    return layer?._tag === 'tile' ? layer : undefined;
  }
  const layer = map.layers.find((entry) => entry._tag === 'tile');
  return layer?._tag === 'tile' ? layer : undefined;
};

export const findCollisionLayer = (map: TileborneMap): CollisionLayer | undefined => {
  const layer = map.layers.find((entry) => entry._tag === 'collision');
  return layer?._tag === 'collision' ? layer : undefined;
};

export const findObjectLayer = (map: TileborneMap, layerId?: LayerId): ObjectLayer | undefined => {
  if (layerId) {
    const layer = map.layers.find((entry) => entry._tag === 'object' && entry.id === layerId);
    return layer?._tag === 'object' ? layer : undefined;
  }
  const layer = map.layers.find((entry) => entry._tag === 'object');
  return layer?._tag === 'object' ? layer : undefined;
};

export const findLayerById = (map: TileborneMap, layerId: LayerId): MapLayer | undefined =>
  map.layers.find((entry) => entry.id === layerId);

const cloneLayerWithVisible = (layer: MapLayer, visible: boolean): MapLayer => {
  if (layer._tag === 'tile') {
    return new TileLayer({
      id: layer.id,
      name: layer.name,
      visible,
      opacity: layer.opacity,
      chunks: layer.chunks,
    });
  }
  if (layer._tag === 'collision') {
    return new CollisionLayer({
      id: layer.id,
      name: layer.name,
      visible,
      opacity: layer.opacity,
      chunks: layer.chunks,
    });
  }
  if (layer._tag === 'object') {
    return new ObjectLayer({
      id: layer.id,
      name: layer.name,
      visible,
      opacity: layer.opacity,
      objectIds: layer.objectIds,
    });
  }
  return new ImageLayer({
    id: layer.id,
    name: layer.name,
    visible,
    opacity: layer.opacity,
    assetId: layer.assetId,
    x: layer.x,
    y: layer.y,
  });
};

export const setLayerVisible = (
  map: TileborneMap,
  layerId: LayerId,
  visible: boolean,
): TileborneMap => {
  const target = map.layers.find((entry) => entry.id === layerId);
  if (!target || target.visible === visible) {
    return map;
  }
  return rebuildMap(map, {
    layers: map.layers.map((layer) =>
      layer.id === layerId ? cloneLayerWithVisible(layer, visible) : layer,
    ),
  });
};

const chunkOrigin = (tileX: number, tileY: number): { chunkX: number; chunkY: number } => ({
  chunkX: Math.floor(tileX / CHUNK_SIZE) * CHUNK_SIZE,
  chunkY: Math.floor(tileY / CHUNK_SIZE) * CHUNK_SIZE,
});

export const getTileIndex = (
  map: TileborneMap,
  layerId: LayerId,
  tileX: number,
  tileY: number,
): number => {
  const layer = findLayerById(map, layerId);
  if (!layer || (layer._tag !== 'tile' && layer._tag !== 'collision')) {
    return 0;
  }
  const { chunkX, chunkY } = chunkOrigin(tileX, tileY);
  const chunk = layer.chunks.find((entry) => entry.x === chunkX && entry.y === chunkY);
  if (!chunk) {
    return 0;
  }
  const localX = tileX - chunkX;
  const localY = tileY - chunkY;
  if (localX < 0 || localY < 0 || localX >= chunk.width || localY >= chunk.height) {
    return 0;
  }
  return chunk.tiles[localY * chunk.width + localX] ?? 0;
};

export interface TileCellChange {
  readonly tileX: number;
  readonly tileY: number;
  readonly oldIndex: number;
  readonly newIndex: number;
  readonly chunkX: number;
  readonly chunkY: number;
}

const replaceLayer = (
  map: TileborneMap,
  layerId: LayerId,
  replace: (layer: TileLayer | CollisionLayer) => MapLayer,
): TileborneMap =>
  rebuildMap(map, {
    layers: map.layers.map((layer) => {
      if (layer.id !== layerId) {
        return layer;
      }
      if (layer._tag === 'tile' || layer._tag === 'collision') {
        return replace(layer);
      }
      return layer;
    }),
  });

const structurallyShareMap = (map: TileborneMap, layers: readonly MapLayer[]): TileborneMap =>
  new TileborneMap({
    id: map.id,
    schemaVersion: map.schemaVersion,
    size: map.size,
    tileSize: map.tileSize,
    layers: layers.map((layer) =>
      layer instanceof TileLayer ||
      layer instanceof CollisionLayer ||
      layer instanceof ObjectLayer ||
      layer instanceof ImageLayer
        ? layer
        : cloneLayer(layer),
    ),
    objects: map.objects.map((object) =>
      object instanceof MapObject ? object : cloneObject(object),
    ),
    properties: map.properties,
  });

export const setTileIndex = (
  map: TileborneMap,
  layerId: LayerId,
  tileX: number,
  tileY: number,
  tileIndex: number,
): TileborneMap => {
  const layerIndex = map.layers.findIndex((entry) => entry.id === layerId);
  const layer = map.layers[layerIndex];
  if (layerIndex < 0 || (layer?._tag !== 'tile' && layer?._tag !== 'collision')) {
    return map;
  }
  const { chunkX, chunkY } = chunkOrigin(tileX, tileY);
  const chunkIndex = layer.chunks.findIndex((entry) => entry.x === chunkX && entry.y === chunkY);
  const existing = chunkIndex >= 0 ? layer.chunks[chunkIndex] : undefined;
  const chunk =
    existing ??
    new TileChunk({
      x: chunkX,
      y: chunkY,
      width: CHUNK_SIZE,
      height: CHUNK_SIZE,
      tiles: Array.from({ length: CHUNK_SIZE * CHUNK_SIZE }, () => 0),
    });
  const localX = tileX - chunkX;
  const localY = tileY - chunkY;
  const index = localY * chunk.width + localX;
  if ((chunk.tiles[index] ?? 0) === tileIndex) {
    return map;
  }
  const tiles = [...chunk.tiles];
  tiles[index] = tileIndex;
  const updatedChunk = new TileChunk({
    x: chunk.x,
    y: chunk.y,
    width: chunk.width,
    height: chunk.height,
    tiles,
  });
  const chunks = [...layer.chunks];
  if (chunkIndex >= 0) {
    chunks[chunkIndex] = updatedChunk;
  } else {
    chunks.push(updatedChunk);
  }
  const updatedLayer =
    layer._tag === 'tile'
      ? new TileLayer({
          id: layer.id,
          name: layer.name,
          visible: layer.visible,
          opacity: layer.opacity,
          chunks,
        })
      : new CollisionLayer({
          id: layer.id,
          name: layer.name,
          visible: layer.visible,
          opacity: layer.opacity,
          chunks,
        });
  const layers = [...map.layers];
  layers[layerIndex] = updatedLayer;
  return structurallyShareMap(map, layers);
};

export const collectRectTileChanges = (
  map: TileborneMap,
  layerId: LayerId,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  newIndex: number,
): readonly TileCellChange[] => {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  const changes: TileCellChange[] = [];
  for (let tileY = minY; tileY <= maxY; tileY += 1) {
    for (let tileX = minX; tileX <= maxX; tileX += 1) {
      if (tileX < 0 || tileY < 0 || tileX >= map.size.width || tileY >= map.size.height) {
        continue;
      }
      const oldIndex = getTileIndex(map, layerId, tileX, tileY);
      if (oldIndex === newIndex) {
        continue;
      }
      const origin = chunkOrigin(tileX, tileY);
      changes.push({
        tileX,
        tileY,
        oldIndex,
        newIndex,
        chunkX: origin.chunkX,
        chunkY: origin.chunkY,
      });
    }
  }
  return changes;
};

export const applyTileChanges = (
  map: TileborneMap,
  layerId: LayerId,
  changes: readonly TileCellChange[],
): TileborneMap => {
  if (changes.length === 0) {
    return map;
  }
  const layerIndex = map.layers.findIndex((entry) => entry.id === layerId);
  const layer = map.layers[layerIndex];
  if (layerIndex < 0 || (layer?._tag !== 'tile' && layer?._tag !== 'collision')) {
    return map;
  }

  const chunkIndexByKey = new Map<string, number>(
    layer.chunks.map((chunk, index) => [`${chunk.x}:${chunk.y}`, index] as const),
  );
  const drafts = new Map<
    string,
    {
      readonly chunkIndex: number;
      readonly chunk: TileChunk;
      readonly tiles: number[];
    }
  >();
  let changed = false;

  for (const change of changes) {
    const key = `${change.chunkX}:${change.chunkY}`;
    let draft = drafts.get(key);
    if (draft === undefined) {
      const chunkIndex = chunkIndexByKey.get(key) ?? -1;
      const chunk =
        chunkIndex >= 0
          ? layer.chunks[chunkIndex]!
          : new TileChunk({
              x: change.chunkX,
              y: change.chunkY,
              width: CHUNK_SIZE,
              height: CHUNK_SIZE,
              tiles: Array.from({ length: CHUNK_SIZE * CHUNK_SIZE }, () => 0),
            });
      draft = { chunkIndex, chunk, tiles: [...chunk.tiles] };
      drafts.set(key, draft);
    }

    const localX = change.tileX - draft.chunk.x;
    const localY = change.tileY - draft.chunk.y;
    if (localX < 0 || localY < 0 || localX >= draft.chunk.width || localY >= draft.chunk.height) {
      continue;
    }
    const index = localY * draft.chunk.width + localX;
    if ((draft.tiles[index] ?? 0) === change.newIndex) {
      continue;
    }
    draft.tiles[index] = change.newIndex;
    changed = true;
  }

  if (!changed) {
    return map;
  }

  const chunks = [...layer.chunks];
  for (const draft of drafts.values()) {
    const updatedChunk = new TileChunk({
      x: draft.chunk.x,
      y: draft.chunk.y,
      width: draft.chunk.width,
      height: draft.chunk.height,
      tiles: draft.tiles,
    });
    if (draft.chunkIndex >= 0) {
      chunks[draft.chunkIndex] = updatedChunk;
    } else {
      chunks.push(updatedChunk);
    }
  }

  const updatedLayer =
    layer._tag === 'tile'
      ? new TileLayer({
          id: layer.id,
          name: layer.name,
          visible: layer.visible,
          opacity: layer.opacity,
          chunks,
        })
      : new CollisionLayer({
          id: layer.id,
          name: layer.name,
          visible: layer.visible,
          opacity: layer.opacity,
          chunks,
        });
  const layers = [...map.layers];
  layers[layerIndex] = updatedLayer;
  return structurallyShareMap(map, layers);
};

export const placeObject = (
  map: TileborneMap,
  input: {
    kind: GameObjectTypeId;
    x: number;
    y: number;
    width?: number | undefined;
    height?: number | undefined;
    layerId?: LayerId | undefined;
    placement?: MapObjectPlacement | undefined;
    properties?: Record<string, unknown>;
  },
): { map: TileborneMap; objectId: ObjectId } => {
  let layer = findObjectLayer(map, input.layerId);
  let layers = map.layers;
  if (!layer) {
    layer = new ObjectLayer({
      id: makeLayerId('00000000-0000-4000-8000-000000000004'),
      name: 'objects',
      visible: true,
      opacity: 1,
      objectIds: [],
    });
    layers = [...map.layers, layer];
  }
  const objectId = makeObjectId(crypto.randomUUID());
  const object = new MapObject({
    id: objectId,
    kind: input.kind,
    x: input.x,
    y: input.y,
    width: input.width === undefined ? Option.none() : Option.some(input.width),
    height: input.height === undefined ? Option.none() : Option.some(input.height),
    layerId: layer.id,
    properties: input.properties ?? {},
    placement: input.placement,
  });
  const nextLayers = layers.map((entry) => {
    if (entry.id !== layer!.id || entry._tag !== 'object') {
      return entry;
    }
    return new ObjectLayer({
      id: entry.id,
      name: entry.name,
      visible: entry.visible,
      opacity: entry.opacity,
      objectIds: [...entry.objectIds, objectId],
    });
  });
  return {
    map: rebuildMap(map, {
      layers: nextLayers,
      objects: [...map.objects, object],
    }),
    objectId,
  };
};

export const moveObject = (
  map: TileborneMap,
  objectId: ObjectId,
  x: number,
  y: number,
): { map: TileborneMap; oldX: number; oldY: number } => {
  const object = map.objects.find((entry) => entry.id === objectId);
  if (!object) {
    return { map, oldX: 0, oldY: 0 };
  }
  const oldX = object.x;
  const oldY = object.y;
  return {
    map: rebuildMap(map, {
      objects: map.objects.map((entry) =>
        entry.id === objectId
          ? new MapObject({
              id: entry.id,
              kind: entry.kind,
              x,
              y,
              width: entry.width,
              height: entry.height,
              layerId: entry.layerId,
              properties: { ...entry.properties },
              placement: entry.placement,
            })
          : entry,
      ),
    }),
    oldX,
    oldY,
  };
};

/**
 * Replace a placed object's `properties` bag (its per-instance overrides),
 * reusing the canonical map-rebuild path. Returns the map unchanged when the
 * object is absent, so callers can persist via the standard `useUpdateMap`
 * flow without inventing a parallel object-edit path (ADR-0025 slice 5).
 */
export const setObjectProperties = (
  map: TileborneMap,
  objectId: ObjectId,
  properties: MapObject['properties'],
): TileborneMap => {
  const target = map.objects.find((entry) => entry.id === objectId);
  if (!target) {
    return map;
  }
  return rebuildMap(map, {
    objects: map.objects.map((entry) =>
      entry.id === objectId
        ? new MapObject({
            id: entry.id,
            kind: entry.kind,
            x: entry.x,
            y: entry.y,
            width: entry.width,
            height: entry.height,
            layerId: entry.layerId,
            properties: { ...properties },
            placement: entry.placement,
          })
        : entry,
    ),
  });
};

export const addTriggerRegion = (
  map: TileborneMap,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { map: TileborneMap; objectId: ObjectId } => {
  const minX = Math.min(x1, x2);
  const minY = Math.min(y1, y2);
  const width = Math.abs(x2 - x1) + 1;
  const height = Math.abs(y2 - y1) + 1;
  const tileSize = map.tileSize.width;
  return placeObject(map, {
    kind: TRIGGER_REGION_OBJECT_TYPE_ID,
    x: minX * tileSize,
    y: minY * tileSize,
    properties: {
      regionName: `region-${crypto.randomUUID().slice(0, 8)}`,
      tileWidth: width,
      tileHeight: height,
    },
  });
};

export const mapDeepEqual = (left: TileborneMap, right: TileborneMap): boolean => {
  const encode = Schema.encodeUnknownSync(TileborneMap);
  return JSON.stringify(encode(left)) === JSON.stringify(encode(right));
};

export const removeLayer = (map: TileborneMap, layerId: LayerId): TileborneMap =>
  rebuildMap(map, { layers: map.layers.filter((layer) => layer.id !== layerId) });

export const removeChunk = (
  map: TileborneMap,
  layerId: LayerId,
  chunkX: number,
  chunkY: number,
): TileborneMap =>
  replaceLayer(map, layerId, (layer) => {
    const chunks = layer.chunks.filter((entry) => entry.x !== chunkX || entry.y !== chunkY);
    if (layer._tag === 'tile') {
      return new TileLayer({
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        opacity: layer.opacity,
        chunks,
      });
    }
    return new CollisionLayer({
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      chunks,
    });
  });

export const chunkOriginAt = (tileX: number, tileY: number): { chunkX: number; chunkY: number } =>
  chunkOrigin(tileX, tileY);
