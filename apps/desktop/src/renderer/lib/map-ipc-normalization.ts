import {
  decodePersistedTileborneMapJson,
  type MapLayer,
  type MapObject,
  type TileborneMap,
} from '@tileborne/core';

const optionValue = <A>(
  value: A | { readonly _tag: string; readonly value?: A } | undefined,
): A | undefined => {
  if (typeof value === 'object' && value !== null && '_tag' in value) {
    return value._tag === 'Some' ? value.value : undefined;
  }
  return value;
};

const placementToJson = (placement: MapObject['placement'] | undefined): unknown => {
  if (placement === undefined) {
    return undefined;
  }
  return {
    packId: optionValue(placement.packId),
    placeableId: placement.placeableId,
    source: placement.source,
    assetId: optionValue(placement.assetId),
    tileId: optionValue(placement.tileId),
    gid: optionValue(placement.gid),
  };
};

const objectToJson = (object: MapObject) => ({
  id: object.id,
  kind: object.kind,
  x: object.x,
  y: object.y,
  width: optionValue(object.width),
  height: optionValue(object.height),
  layerId: object.layerId,
  properties: object.properties,
  placement: placementToJson(object.placement),
});

type LooseLayer = {
  readonly _tag?: MapLayer['_tag'];
  readonly kind?: MapLayer['_tag'];
  readonly id: MapLayer['id'];
  readonly name: string;
  readonly visible: boolean;
  readonly opacity: number;
  readonly chunks?: readonly {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly tiles: readonly number[];
  }[];
  readonly objectIds?: readonly string[];
  readonly assetId?: string;
  readonly x?: number;
  readonly y?: number;
};

const layerToJson = (layer: MapLayer): unknown => {
  const loose = layer as LooseLayer;
  const kind = loose._tag ?? loose.kind;
  switch (kind) {
    case 'tile':
    case 'collision':
      return {
        kind,
        id: loose.id,
        name: loose.name,
        visible: loose.visible,
        opacity: loose.opacity,
        chunks: (loose.chunks ?? []).map((chunk) => ({
          x: chunk.x,
          y: chunk.y,
          width: chunk.width,
          height: chunk.height,
          tiles: [...chunk.tiles],
        })),
      };
    case 'object':
      return {
        kind: 'object',
        id: loose.id,
        name: loose.name,
        visible: loose.visible,
        opacity: loose.opacity,
        objectIds: [...(loose.objectIds ?? [])],
      };
    case 'image':
      return {
        kind: 'image',
        id: loose.id,
        name: loose.name,
        visible: loose.visible,
        opacity: loose.opacity,
        assetId: loose.assetId,
        x: loose.x,
        y: loose.y,
      };
    default:
      throw new Error('Map layer is missing kind');
  }
};

export const mapToIpcJson = (map: TileborneMap): unknown => ({
  id: map.id,
  schemaVersion: map.schemaVersion,
  size: { width: map.size.width, height: map.size.height },
  tileSize: { width: map.tileSize.width, height: map.tileSize.height },
  layers: map.layers.map(layerToJson),
  objects: map.objects.map(objectToJson),
  properties: map.properties,
});

export const normalizeMapForIpc = (map: TileborneMap): unknown => {
  const encoded = mapToIpcJson(map);
  // Validate the IPC payload through the single persisted-map decode boundary
  // (ADR-0019) so this renderer path can never drift from the migration SSOT.
  decodePersistedTileborneMapJson(encoded);
  return encoded;
};
