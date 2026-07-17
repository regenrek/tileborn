import { createProcgenRng } from './rng.js';

export const MAP_GENERATE_PRESETS = ['open', 'dungeon', 'arena'] as const;
export type MapGeneratePreset = (typeof MAP_GENERATE_PRESETS)[number];

const FLOOR_TILE = 0;
const WALL_TILE = 1;

const fillTiles = (width: number, height: number, value: number): number[] =>
  Array.from({ length: width * height }, () => value);

const generateOpen = (width: number, height: number): number[] =>
  fillTiles(width, height, FLOOR_TILE);

const generateArena = (width: number, height: number): number[] => {
  const tiles = fillTiles(width, height, FLOOR_TILE);
  const border = Math.max(1, Math.min(3, Math.floor(Math.min(width, height) / 16)));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x < border || y < border || x >= width - border || y >= height - border) {
        tiles[y * width + x] = WALL_TILE;
      }
    }
  }
  return tiles;
};

const carveRegion = (
  tiles: number[],
  width: number,
  height: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void => {
  for (let y = y1; y <= y2; y += 1) {
    for (let x = x1; x <= x2; x += 1) {
      if (x >= 0 && x < width && y >= 0 && y < height) {
        tiles[y * width + x] = FLOOR_TILE;
      }
    }
  }
};

const splitRegion = (
  tiles: number[],
  width: number,
  height: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  depth: number,
  rng: ReturnType<typeof createProcgenRng>,
): void => {
  if (depth <= 0 || x2 - x1 < 6 || y2 - y1 < 6) {
    carveRegion(tiles, width, height, x1 + 1, y1 + 1, x2 - 1, y2 - 1);
    return;
  }
  const horizontal = x2 - x1 > y2 - y1;
  if (horizontal) {
    const splitX = rng.uniformInt(x1 + 2, x2 - 2);
    splitRegion(tiles, width, height, x1, y1, splitX, y2, depth - 1, rng);
    splitRegion(tiles, width, height, splitX + 1, y1, x2, y2, depth - 1, rng);
    return;
  }
  const splitY = rng.uniformInt(y1 + 2, y2 - 2);
  splitRegion(tiles, width, height, x1, y1, x2, splitY, depth - 1, rng);
  splitRegion(tiles, width, height, x1, splitY + 1, x2, y2, depth - 1, rng);
};

const generateDungeon = (width: number, height: number, seed: number): number[] => {
  const rng = createProcgenRng(seed);
  const tiles = fillTiles(width, height, WALL_TILE);
  splitRegion(tiles, width, height, 0, 0, width - 1, height - 1, 4, rng);
  return tiles;
};

export const generatePresetTiles = (
  preset: MapGeneratePreset,
  width: number,
  height: number,
  seed: number,
): number[] => {
  switch (preset) {
    case 'open':
      return generateOpen(width, height);
    case 'arena':
      return generateArena(width, height);
    case 'dungeon':
      return generateDungeon(width, height, seed);
  }
};
