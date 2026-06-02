import type { GameObjectTypeId, LayerId, MapObjectPlacement, ObjectId } from '@tileborne/core';
import { CollisionLayer, TileborneMap, makeLayerId } from '@tileborne/core';

import type { TileCellChange } from './map-utils.js';
import {
  addTriggerRegion,
  applyTileChanges,
  chunkOriginAt,
  collectRectTileChanges,
  findCollisionLayer,
  findLayerById,
  getTileIndex,
  moveObject,
  placeObject,
  removeChunk,
  removeLayer,
  rebuildMap,
  setLayerVisible,
  setTileIndex,
} from './map-utils.js';

export interface CommandPreview {
  readonly layerId: LayerId;
  readonly cells: readonly { readonly x: number; readonly y: number }[];
  readonly chunks: readonly { readonly chunkX: number; readonly chunkY: number }[];
}

export interface EditorCommand {
  readonly kind: string;
  apply(map: TileborneMap): TileborneMap;
  inverse(map: TileborneMap): EditorCommand;
  readonly preview?: CommandPreview | undefined;
}

export interface ObjectPlaceInput {
  readonly kind: GameObjectTypeId;
  readonly x: number;
  readonly y: number;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly layerId?: LayerId | undefined;
  readonly placement?: MapObjectPlacement | undefined;
}

const chunkKey = (chunkX: number, chunkY: number): string => `${chunkX}:${chunkY}`;

const previewForCells = (
  layerId: LayerId,
  cells: readonly { readonly x: number; readonly y: number }[],
): CommandPreview | undefined => {
  if (cells.length === 0) {
    return undefined;
  }
  const chunks = new Map<string, { readonly chunkX: number; readonly chunkY: number }>();
  for (const cell of cells) {
    const { chunkX, chunkY } = chunkOriginAt(cell.x, cell.y);
    chunks.set(chunkKey(chunkX, chunkY), { chunkX, chunkY });
  }
  return { layerId, cells, chunks: [...chunks.values()] };
};

const chunkPreview = (layerId: LayerId, tileX: number, tileY: number): CommandPreview =>
  previewForCells(layerId, [{ x: tileX, y: tileY }])!;

export class TileEditCommand implements EditorCommand {
  readonly kind = 'tile-edit';

  constructor(
    readonly layerId: LayerId,
    readonly tileX: number,
    readonly tileY: number,
    readonly newIndex: number,
    readonly oldIndex: number,
    readonly preview?: CommandPreview,
  ) {}

  apply(map: TileborneMap): TileborneMap {
    return setTileIndex(map, this.layerId, this.tileX, this.tileY, this.newIndex);
  }

  inverse(map: TileborneMap): EditorCommand {
    void map;
    return new TileEditCommand(
      this.layerId,
      this.tileX,
      this.tileY,
      this.oldIndex,
      this.newIndex,
      this.preview,
    );
  }
}

export class TileRectangleFillCommand implements EditorCommand {
  readonly kind = 'tile-rectangle-fill';

  constructor(
    readonly layerId: LayerId,
    readonly changes: readonly TileCellChange[],
    readonly preview?: CommandPreview,
  ) {}

  apply(map: TileborneMap): TileborneMap {
    return applyTileChanges(map, this.layerId, this.changes);
  }

  inverse(map: TileborneMap): EditorCommand {
    void map;
    const reversed = this.changes.map((change) => ({
      ...change,
      oldIndex: change.newIndex,
      newIndex: change.oldIndex,
    }));
    return new TileRectangleFillCommand(this.layerId, reversed, this.preview);
  }
}

export class EraseCommand implements EditorCommand {
  readonly kind = 'erase';

  constructor(
    readonly layerId: LayerId,
    readonly changes: readonly TileCellChange[],
    readonly preview?: CommandPreview,
  ) {}

  apply(map: TileborneMap): TileborneMap {
    return applyTileChanges(map, this.layerId, this.changes);
  }

  inverse(map: TileborneMap): EditorCommand {
    void map;
    const reversed = this.changes.map((change) => ({
      ...change,
      oldIndex: change.newIndex,
      newIndex: change.oldIndex,
    }));
    return new EraseCommand(this.layerId, reversed, this.preview);
  }
}

export class ObjectPlaceCommand implements EditorCommand {
  readonly kind = 'object-place';

  constructor(
    readonly objectId: ObjectId,
    readonly beforeMap: TileborneMap,
    readonly afterMap: TileborneMap,
  ) {}

  apply(map: TileborneMap): TileborneMap {
    void map;
    return this.afterMap;
  }

  inverse(map: TileborneMap): EditorCommand {
    void map;
    return new ObjectRestoreCommand(this.objectId, this.beforeMap, this.afterMap);
  }
}

class ObjectRestoreCommand implements EditorCommand {
  readonly kind = 'object-restore';

  constructor(
    readonly objectId: ObjectId,
    readonly beforeMap: TileborneMap,
    readonly afterMap: TileborneMap,
  ) {}

  apply(map: TileborneMap): TileborneMap {
    void map;
    return this.beforeMap;
  }

  inverse(map: TileborneMap): EditorCommand {
    void map;
    return new ObjectPlaceCommand(this.objectId, this.beforeMap, this.afterMap);
  }
}

export class ObjectMoveCommand implements EditorCommand {
  readonly kind = 'object-move';

  constructor(
    readonly objectId: ObjectId,
    readonly newX: number,
    readonly newY: number,
    readonly oldX: number,
    readonly oldY: number,
  ) {}

  apply(map: TileborneMap): TileborneMap {
    return moveObject(map, this.objectId, this.newX, this.newY).map;
  }

  inverse(map: TileborneMap): EditorCommand {
    void map;
    return new ObjectMoveCommand(this.objectId, this.oldX, this.oldY, this.newX, this.newY);
  }
}

class CollisionLayerRemoveCommand implements EditorCommand {
  readonly kind = 'collision-layer-remove';

  constructor(readonly layerId: LayerId) {}

  apply(map: TileborneMap): TileborneMap {
    return removeLayer(map, this.layerId);
  }

  inverse(map: TileborneMap): EditorCommand {
    void map;
    throw new Error('CollisionLayerRemoveCommand is not re-invertible');
  }
}

class CollisionChunkRemoveCommand implements EditorCommand {
  readonly kind = 'collision-chunk-remove';

  constructor(
    readonly layerId: LayerId,
    readonly chunkX: number,
    readonly chunkY: number,
    readonly preview?: CommandPreview,
  ) {}

  apply(map: TileborneMap): TileborneMap {
    return removeChunk(map, this.layerId, this.chunkX, this.chunkY);
  }

  inverse(map: TileborneMap): EditorCommand {
    void map;
    throw new Error('CollisionChunkRemoveCommand is not re-invertible');
  }
}

export class CollisionPaintCommand implements EditorCommand {
  readonly kind = 'collision-paint';

  constructor(
    readonly layerId: LayerId,
    readonly tileX: number,
    readonly tileY: number,
    readonly newIndex: number,
    readonly oldIndex: number,
    readonly createdLayer: boolean,
    readonly createdChunk: boolean,
    readonly preview?: CommandPreview,
  ) {}

  apply(map: TileborneMap): TileborneMap {
    let working = map;
    if (!findLayerById(map, this.layerId)) {
      working = rebuildMap(map, {
        layers: [
          ...map.layers,
          new CollisionLayer({
            id: this.layerId,
            name: 'collision',
            visible: true,
            opacity: 1,
            chunks: [],
          }),
        ],
      });
    }
    return setTileIndex(working, this.layerId, this.tileX, this.tileY, this.newIndex);
  }

  inverse(map: TileborneMap): EditorCommand {
    void map;
    if (this.createdLayer) {
      return new CollisionLayerRemoveCommand(this.layerId);
    }
    if (this.createdChunk) {
      const { chunkX, chunkY } = chunkOriginAt(this.tileX, this.tileY);
      return new CollisionChunkRemoveCommand(this.layerId, chunkX, chunkY, this.preview);
    }
    return new CollisionPaintCommand(
      this.layerId,
      this.tileX,
      this.tileY,
      this.oldIndex,
      this.newIndex,
      false,
      false,
      this.preview,
    );
  }
}

export class RegionMarkCommand implements EditorCommand {
  readonly kind = 'region-mark';

  constructor(
    readonly objectId: ObjectId,
    readonly beforeMap: TileborneMap,
    readonly afterMap: TileborneMap,
  ) {}

  apply(map: TileborneMap): TileborneMap {
    void map;
    return this.afterMap;
  }

  inverse(map: TileborneMap): EditorCommand {
    void map;
    return new RegionRestoreCommand(this.objectId, this.beforeMap, this.afterMap);
  }
}

class RegionRestoreCommand implements EditorCommand {
  readonly kind = 'region-restore';

  constructor(
    readonly objectId: ObjectId,
    readonly beforeMap: TileborneMap,
    readonly afterMap: TileborneMap,
  ) {}

  apply(map: TileborneMap): TileborneMap {
    void map;
    return this.beforeMap;
  }

  inverse(map: TileborneMap): EditorCommand {
    void map;
    return new RegionMarkCommand(this.objectId, this.beforeMap, this.afterMap);
  }
}

export const createTileEditCommand = (
  map: TileborneMap,
  layerId: LayerId,
  tileX: number,
  tileY: number,
  newIndex: number,
): TileEditCommand => {
  const oldIndex = getTileIndex(map, layerId, tileX, tileY);
  return new TileEditCommand(
    layerId,
    tileX,
    tileY,
    newIndex,
    oldIndex,
    chunkPreview(layerId, tileX, tileY),
  );
};

export const createRectangleFillCommand = (
  map: TileborneMap,
  layerId: LayerId,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  newIndex: number,
): TileRectangleFillCommand => {
  const changes = collectRectTileChanges(map, layerId, x1, y1, x2, y2, newIndex);
  const first = changes[0];
  return new TileRectangleFillCommand(
    layerId,
    changes,
    first === undefined
      ? undefined
      : previewForCells(
          layerId,
          changes.map((change) => ({ x: change.tileX, y: change.tileY })),
        ),
  );
};

export const createEraseCommand = (
  map: TileborneMap,
  layerId: LayerId,
  tileX: number,
  tileY: number,
): EraseCommand => {
  const oldIndex = getTileIndex(map, layerId, tileX, tileY);
  return new EraseCommand(
    layerId,
    [
      {
        tileX,
        tileY,
        oldIndex,
        newIndex: 0,
        chunkX: Math.floor(tileX / 32) * 32,
        chunkY: Math.floor(tileY / 32) * 32,
      },
    ],
    chunkPreview(layerId, tileX, tileY),
  );
};

export const createStrokeTileCommand = (
  layerId: LayerId,
  cells: readonly {
    readonly tileX: number;
    readonly tileY: number;
    readonly oldIndex: number;
    readonly newIndex: number;
  }[],
): TileRectangleFillCommand => {
  const changes: TileCellChange[] = [];
  for (const cell of cells) {
    if (cell.oldIndex === cell.newIndex) {
      continue;
    }
    const { chunkX, chunkY } = chunkOriginAt(cell.tileX, cell.tileY);
    changes.push({
      tileX: cell.tileX,
      tileY: cell.tileY,
      oldIndex: cell.oldIndex,
      newIndex: cell.newIndex,
      chunkX,
      chunkY,
    });
  }
  return new TileRectangleFillCommand(
    layerId,
    changes,
    previewForCells(
      layerId,
      changes.map((change) => ({ x: change.tileX, y: change.tileY })),
    ),
  );
};

export const createObjectPlaceCommand = (
  map: TileborneMap,
  input: ObjectPlaceInput,
): ObjectPlaceCommand => {
  const { map: afterMap, objectId } = placeObject(map, input);
  return new ObjectPlaceCommand(objectId, map, afterMap);
};

export const createObjectMoveCommand = (
  map: TileborneMap,
  objectId: ObjectId,
  newX: number,
  newY: number,
): ObjectMoveCommand => {
  const object = map.objects.find((entry) => entry.id === objectId);
  const oldX = object?.x ?? newX;
  const oldY = object?.y ?? newY;
  return new ObjectMoveCommand(objectId, newX, newY, oldX, oldY);
};

export const createCollisionPaintCommand = (
  map: TileborneMap,
  tileX: number,
  tileY: number,
): CollisionPaintCommand => {
  const existingLayer = findCollisionLayer(map);
  const layerId =
    existingLayer?.id ?? makeLayerId('00000000-0000-4000-8000-000000000003');
  const { chunkX, chunkY } = chunkOriginAt(tileX, tileY);
  const createdLayer = !existingLayer;
  const createdChunk = existingLayer
    ? !existingLayer.chunks.some((entry) => entry.x === chunkX && entry.y === chunkY)
    : true;
  const oldIndex = getTileIndex(map, layerId, tileX, tileY);
  const newIndex = oldIndex === 0 ? 1 : 0;
  return new CollisionPaintCommand(
    layerId,
    tileX,
    tileY,
    newIndex,
    oldIndex,
    createdLayer,
    createdChunk,
    chunkPreview(layerId, tileX, tileY),
  );
};

export class SetLayerVisibilityCommand implements EditorCommand {
  readonly kind = 'layer-visibility';

  constructor(
    readonly layerId: LayerId,
    readonly nextVisible: boolean,
    readonly prevVisible: boolean,
  ) {}

  apply(map: TileborneMap): TileborneMap {
    return setLayerVisible(map, this.layerId, this.nextVisible);
  }

  inverse(map: TileborneMap): EditorCommand {
    void map;
    return new SetLayerVisibilityCommand(this.layerId, this.prevVisible, this.nextVisible);
  }
}

export const createSetLayerVisibilityCommand = (
  map: TileborneMap,
  layerId: LayerId,
  nextVisible: boolean,
): SetLayerVisibilityCommand | undefined => {
  const layer = map.layers.find((entry) => entry.id === layerId);
  if (!layer) {
    return undefined;
  }
  return new SetLayerVisibilityCommand(layerId, nextVisible, layer.visible);
};

export const createRegionMarkCommand = (
  map: TileborneMap,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): RegionMarkCommand => {
  const { map: afterMap, objectId } = addTriggerRegion(map, x1, y1, x2, y2);
  return new RegionMarkCommand(objectId, map, afterMap);
};
