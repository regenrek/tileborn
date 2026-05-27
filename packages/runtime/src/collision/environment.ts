import { CollisionLayer, makeLayerId, Size2D, TileChunk } from "@tileborne/core";

import type { CollisionRect } from "./rect.js";

export class CollisionEnvironment {
  readonly blockingRects: readonly CollisionRect[];

  private constructor(blockingRects: readonly CollisionRect[]) {
    this.blockingRects = blockingRects;
  }

  static fromRects(rects: readonly CollisionRect[]): CollisionEnvironment {
    return new CollisionEnvironment([...rects]);
  }

  /** Converts a CollisionLayer chunk mask into axis-aligned blocking rects. */
  static fromCollisionLayer(layer: CollisionLayer, tileSize: Size2D): CollisionEnvironment {
    const rects: CollisionRect[] = [];
    for (const chunk of layer.chunks) {
      for (let localY = 0; localY < chunk.height; localY += 1) {
        for (let localX = 0; localX < chunk.width; localX += 1) {
          const tileIndex = chunk.tiles[localY * chunk.width + localX] ?? 0;
          if (tileIndex === 0) {
            continue;
          }
          rects.push({
            x: (chunk.x + localX) * tileSize.width,
            y: (chunk.y + localY) * tileSize.height,
            width: tileSize.width,
            height: tileSize.height,
          });
        }
      }
    }
    return new CollisionEnvironment(rects);
  }
}

export const buildCollisionLayerFromRects = (
  rects: readonly CollisionRect[],
  tileSize: number,
): CollisionLayer => {
  const tilesByChunk = new Map<string, { readonly chunkX: number; readonly chunkY: number; tiles: number[] }>();
  for (const rect of rects) {
    const startTileX = Math.floor(rect.x / tileSize);
    const startTileY = Math.floor(rect.y / tileSize);
    const endTileX = Math.ceil((rect.x + rect.width) / tileSize);
    const endTileY = Math.ceil((rect.y + rect.height) / tileSize);
    for (let tileY = startTileY; tileY < endTileY; tileY += 1) {
      for (let tileX = startTileX; tileX < endTileX; tileX += 1) {
        const chunkX = Math.floor(tileX / 32) * 32;
        const chunkY = Math.floor(tileY / 32) * 32;
        const key = `${chunkX}:${chunkY}`;
        const entry = tilesByChunk.get(key) ?? {
          chunkX,
          chunkY,
          tiles: Array.from({ length: 32 * 32 }, () => 0),
        };
        const localX = tileX - chunkX;
        const localY = tileY - chunkY;
        if (localX >= 0 && localX < 32 && localY >= 0 && localY < 32) {
          entry.tiles[localY * 32 + localX] = 1;
        }
        tilesByChunk.set(key, entry);
      }
    }
  }
  return new CollisionLayer({
    id: makeLayerId("00000000-0000-4000-8000-000000000002"),
    name: "collision-fixture",
    visible: true,
    opacity: 1,
    chunks: [...tilesByChunk.values()].map(
      (entry) =>
        new TileChunk({
          x: entry.chunkX,
          y: entry.chunkY,
          width: 32,
          height: 32,
          tiles: entry.tiles,
        }),
    ),
  });
};
