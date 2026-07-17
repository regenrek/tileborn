import type { ExportedArtifact } from '../types/artifact.js';
import type { PluginWorld } from '../types/runtime-plugin.js';
import { COLLISION_BODY_COMPONENT, type CollisionBody } from './components.js';
import type { CollisionRect } from './rect.js';
import { resolveCircleRect } from './circle-rect.js';

export type { CollisionRect } from './rect.js';
export { resolveCircleRect } from './circle-rect.js';

export interface PluginCollisionRect extends CollisionRect {
  readonly blocksMovement: boolean;
  readonly blocksProjectiles: boolean;
  readonly blocksVision: boolean;
}

export class PluginCollisionEnvironment {
  readonly rects: readonly PluginCollisionRect[];
  readonly blockingRects: readonly CollisionRect[];

  private constructor(rects: readonly PluginCollisionRect[]) {
    this.rects = rects;
    this.blockingRects = rects.filter((rect) => rect.blocksMovement);
  }

  static fromArtifact(artifact: ExportedArtifact): PluginCollisionEnvironment | undefined {
    return PluginCollisionEnvironment.fromRects([
      ...tileCollisionRectsFromArtifact(artifact),
      ...(artifact.objectCollisionRects ?? []),
    ]);
  }

  static fromTileArtifact(artifact: ExportedArtifact): PluginCollisionEnvironment | undefined {
    return PluginCollisionEnvironment.fromRects(tileCollisionRectsFromArtifact(artifact));
  }

  static fromRects(rects: readonly PluginCollisionRect[]): PluginCollisionEnvironment | undefined {
    if (rects.length === 0) {
      return undefined;
    }
    return new PluginCollisionEnvironment([...rects]);
  }
}

type CollisionMaskValue = {
  readonly _tag?: string;
  readonly blocked?: unknown;
  readonly blocksMovement?: unknown;
};

type RuntimeTilesetPack = NonNullable<ExportedArtifact['tilesetPack']>;
type RuntimeCollisionArtifact = NonNullable<ExportedArtifact['collision']>;

const readCollisionMask = (input: unknown): CollisionMaskValue | undefined => {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  if ('_tag' in input && input._tag === 'None') {
    return undefined;
  }
  if ('_tag' in input && input._tag === 'Some' && 'value' in input) {
    return readCollisionMask(input.value);
  }
  return input as CollisionMaskValue;
};

const collisionMaskByTileIndex = (
  pack: RuntimeTilesetPack,
  tileIdByIndex: RuntimeCollisionArtifact['tileIdByIndex'],
): ReadonlyMap<number, CollisionMaskValue> => {
  const masksByTileId = new Map<string, CollisionMaskValue>();
  for (const tileset of pack.tilesets) {
    for (const tile of tileset.tiles) {
      const mask = readCollisionMask(tile.collisionMask);
      if (mask !== undefined) {
        masksByTileId.set(String(tile.id), mask);
      }
    }
  }

  const byIndex = new Map<number, CollisionMaskValue>();
  for (const [tileIndex, tileId] of tileIdByIndex.entries()) {
    if (tileId === null) {
      continue;
    }
    const mask = masksByTileId.get(String(tileId));
    if (mask !== undefined) {
      byIndex.set(tileIndex, mask);
    }
  }
  return byIndex;
};

const collisionMaskBlocksMovement = (mask: CollisionMaskValue): boolean => {
  if (mask._tag === 'bitmask') {
    return typeof mask.blocked === 'number' && mask.blocked !== 0;
  }
  return mask.blocksMovement === true;
};

const tileCollisionRectsFromArtifact = (
  artifact: ExportedArtifact,
): readonly PluginCollisionRect[] => {
  const rects: PluginCollisionRect[] = [];
  const collision = artifact.collision;
  if (collision === undefined || artifact.tilesetPack === undefined) {
    return rects;
  }

  const collisionMasks = collisionMaskByTileIndex(artifact.tilesetPack, collision.tileIdByIndex);
  for (const chunk of collision.chunks) {
    for (let localY = 0; localY < chunk.height; localY += 1) {
      for (let localX = 0; localX < chunk.width; localX += 1) {
        const tileIndex = chunk.tiles[localY * chunk.width + localX] ?? 0;
        if (tileIndex === 0) {
          continue;
        }
        const mask = collisionMasks.get(tileIndex);
        if (mask === undefined || !collisionMaskBlocksMovement(mask)) {
          continue;
        }
        rects.push({
          x: (chunk.x + localX) * collision.tileWidth,
          y: (chunk.y + localY) * collision.tileHeight,
          width: collision.tileWidth,
          height: collision.tileHeight,
          blocksMovement: true,
          blocksProjectiles: true,
          blocksVision: true,
        });
      }
    }
  }
  return rects;
};

const objectCollisionRectsFromWorld = (world: PluginWorld): readonly PluginCollisionRect[] => {
  const bodies = world.getComponent<CollisionBody>(COLLISION_BODY_COMPONENT);
  const rects: PluginCollisionRect[] = [];
  for (const [, body] of bodies.entries()) {
    if (
      body.objectId === undefined ||
      (!body.blocksMovement && !body.blocksProjectiles && !body.blocksVision)
    ) {
      continue;
    }
    rects.push({ ...body });
  }
  return rects;
};

export const buildRuntimeCollisionEnvironment = (
  world: PluginWorld,
  tileEnvironment: PluginCollisionEnvironment | undefined,
): PluginCollisionEnvironment | undefined =>
  PluginCollisionEnvironment.fromRects([
    ...(tileEnvironment?.rects ?? []),
    ...objectCollisionRectsFromWorld(world),
  ]);

export const resolvePlayerCollision = (
  position: { x: number; y: number },
  environment: PluginCollisionEnvironment,
  radius: number,
  offset: { readonly x: number; readonly y: number },
): void => {
  for (const rect of environment.blockingRects) {
    resolveCircleRect(position, rect, radius, offset);
  }
};
