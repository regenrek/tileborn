import {
  readCollisionFootprintOffset,
  type CollisionFootprintComponent,
  type CollisionFootprintPart,
  type GameObjectType,
  type RuntimeObjectPlacement,
  type TileborneMap,
} from '@tileborne/core';
import type { TileIdType, TilesetPack } from '@tileborne/sdk-tileset/schemas';

import type {
  CollisionChunkArtifact,
  MapCollisionArtifact,
  ObjectCollisionRectArtifact,
} from './types/artifact.js';

/**
 * Collision extraction for the ADR-0030 `buildBattleRoyaleRuntimeState`
 * package path: map paint layers + catalog footprints → runtime collision
 * state.
 */

const tileIdByTileIndex = (pack: TilesetPack): readonly (TileIdType | null)[] => {
  const tileIds: Array<TileIdType | null> = [null];
  for (const tileset of pack.tilesets) {
    for (const tile of tileset.tiles) {
      tileIds.push(tile.id);
    }
  }
  return tileIds;
};

export const extractCollisionArtifact = (
  map: TileborneMap,
  tilesetPack: TilesetPack | undefined,
): MapCollisionArtifact | undefined => {
  if (tilesetPack === undefined) {
    return undefined;
  }

  const chunks: CollisionChunkArtifact[] = [];
  for (const layer of map.layers) {
    const tag =
      '_tag' in layer && typeof layer._tag === 'string'
        ? layer._tag
        : (layer as { kind?: string }).kind;
    if (
      (tag !== 'tile' && tag !== 'collision') ||
      !('chunks' in layer) ||
      !Array.isArray(layer.chunks)
    ) {
      continue;
    }
    for (const chunk of layer.chunks) {
      chunks.push({
        x: chunk.x,
        y: chunk.y,
        width: chunk.width,
        height: chunk.height,
        tiles: [...chunk.tiles],
      });
    }
  }

  if (chunks.length === 0) {
    return undefined;
  }

  return {
    tileWidth: map.tileSize.width,
    tileHeight: map.tileSize.height,
    chunks,
    tileIdByIndex: tileIdByTileIndex(tilesetPack),
  };
};

const findCollisionFootprint = (
  objectType: GameObjectType,
): CollisionFootprintComponent | undefined =>
  objectType.components.find(
    (component): component is CollisionFootprintComponent =>
      component._tag === 'collision-footprint',
  );

const placeFootprintPart = (
  placement: RuntimeObjectPlacement,
  part: CollisionFootprintPart,
): ObjectCollisionRectArtifact | undefined => {
  if (part.width <= 0 || part.height <= 0) {
    return undefined;
  }
  const offset = readCollisionFootprintOffset(placement.instanceProperties ?? {});
  return {
    objectId: placement.objectId,
    x: placement.x + offset.x + part.x,
    y: placement.y + offset.y + part.y,
    width: part.width,
    height: part.height,
    blocksMovement: part.blocksMovement,
    blocksProjectiles: part.blocksProjectiles,
    blocksVision: part.blocksVision,
  };
};

export const extractObjectCollisionRects = (
  placements: readonly RuntimeObjectPlacement[],
  objectTypes: readonly GameObjectType[] | undefined,
): readonly ObjectCollisionRectArtifact[] => {
  if (objectTypes === undefined || objectTypes.length === 0) {
    return [];
  }
  const footprintByKind = new Map(
    objectTypes.flatMap((objectType) => {
      const footprint = findCollisionFootprint(objectType);
      return footprint === undefined ? [] : [[String(objectType.id), footprint] as const];
    }),
  );
  const rects: ObjectCollisionRectArtifact[] = [];
  for (const placement of placements) {
    const footprint = footprintByKind.get(String(placement.typeId));
    if (footprint === undefined) {
      continue;
    }
    for (const part of footprint.parts) {
      const rect = placeFootprintPart(placement, part);
      if (rect !== undefined) {
        rects.push(rect);
      }
    }
  }
  return rects.sort(
    (left, right) =>
      left.objectId.localeCompare(right.objectId) ||
      left.y - right.y ||
      left.x - right.x ||
      left.width - right.width,
  );
};
