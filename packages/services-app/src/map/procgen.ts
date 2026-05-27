import { randomUUID } from "node:crypto";

import { makeLayerId, TileChunk, TileLayer, type Uuid } from "@tileborne/core";
import {
  generatePresetTiles,
  MAP_GENERATE_PRESETS,
  type MapGeneratePreset,
} from "@tileborne/runtime-wasm";

export { MAP_GENERATE_PRESETS };
export type { MapGeneratePreset };

const CHUNK_SIZE = 32;

const makeChunks = (width: number, height: number, tiles: readonly number[]): TileChunk[] => {
  const chunks: TileChunk[] = [];
  for (let chunkY = 0; chunkY < height; chunkY += CHUNK_SIZE) {
    for (let chunkX = 0; chunkX < width; chunkX += CHUNK_SIZE) {
      const chunkWidth = Math.min(CHUNK_SIZE, width - chunkX);
      const chunkHeight = Math.min(CHUNK_SIZE, height - chunkY);
      const chunkTiles: number[] = [];
      for (let localY = 0; localY < chunkHeight; localY += 1) {
        for (let localX = 0; localX < chunkWidth; localX += 1) {
          chunkTiles.push(tiles[(chunkY + localY) * width + chunkX + localX] ?? 0);
        }
      }
      chunks.push(
        new TileChunk({
          x: chunkX,
          y: chunkY,
          width: chunkWidth,
          height: chunkHeight,
          tiles: chunkTiles,
        }),
      );
    }
  }
  return chunks;
};

export const makeGeneratedLayers = (
  preset: MapGeneratePreset,
  width: number,
  height: number,
  seed: number,
): TileLayer[] => {
  const tiles = generatePresetTiles(preset, width, height, seed).map((tile) => tile + 1);
  return [
    new TileLayer({
      id: makeLayerId(randomUUID() as Uuid),
      name: "terrain",
      visible: true,
      opacity: 1,
      chunks: makeChunks(width, height, tiles),
    }),
    new TileLayer({
      id: makeLayerId(randomUUID() as Uuid),
      name: "props",
      visible: true,
      opacity: 1,
      chunks: [],
    }),
    new TileLayer({
      id: makeLayerId(randomUUID() as Uuid),
      name: "entities",
      visible: true,
      opacity: 1,
      chunks: [],
    }),
  ];
};
