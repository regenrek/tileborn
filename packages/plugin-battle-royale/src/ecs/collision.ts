import { Option } from "effect";
import type { CollisionMaskType, TileIdType, TilesetPack } from "@tileborne/sdk-tileset/schemas";

import type { ExportedArtifact } from "../types/artifact.js";
import type { CollisionRect } from "./rect.js";
import { resolveCircleRect } from "./circle-rect.js";

export type { CollisionRect } from "./rect.js";
export { resolveCircleRect } from "./circle-rect.js";

export class PluginCollisionEnvironment {
  readonly blockingRects: readonly CollisionRect[];

  private constructor(blockingRects: readonly CollisionRect[]) {
    this.blockingRects = blockingRects;
  }

  static fromArtifact(artifact: ExportedArtifact): PluginCollisionEnvironment | undefined {
    const collision = artifact.collision;
    if (!collision || collision.chunks.length === 0) {
      return undefined;
    }

    if (artifact.tilesetPack === undefined) {
      return undefined;
    }

    const collisionMasks = collisionMaskByTileIndex(artifact.tilesetPack, collision.tileIdByIndex);
    const rects: CollisionRect[] = [];
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
          });
        }
      }
    }

    return new PluginCollisionEnvironment(rects);
  }
}

const collisionMaskByTileIndex = (
  pack: TilesetPack,
  tileIdByIndex: readonly (TileIdType | null)[],
): ReadonlyMap<number, CollisionMaskType> => {
  const masksByTileId = new Map<string, CollisionMaskType>();
  for (const tileset of pack.tilesets) {
    for (const tile of tileset.tiles) {
      const mask = Option.getOrUndefined(tile.collisionMask);
      if (mask !== undefined) {
        masksByTileId.set(String(tile.id), mask);
      }
    }
  }

  const byIndex = new Map<number, CollisionMaskType>();
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

const collisionMaskBlocksMovement = (mask: CollisionMaskType): boolean => {
  if (mask._tag === "bitmask") {
    return mask.blocked !== 0;
  }
  return mask.blocksMovement;
};

export const resolvePlayerCollision = (
  position: { x: number; y: number },
  environment: PluginCollisionEnvironment,
  radius: number,
  offsetY: number,
): void => {
  for (const rect of environment.blockingRects) {
    resolveCircleRect(position, rect, radius, offsetY);
  }
};
