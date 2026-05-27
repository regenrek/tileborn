import type { TerrainClass } from "../schemas/terrain-class.js";

/** 32-bit string hash (xmur3-style mixer). */
const hashString = (value: string): number => {
  let hash = 1779033703 ^ value.length;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  return splitmix32(hash);
};

/** One splitmix32 round — fast deterministic 32-bit mixing. */
export const splitmix32 = (state: number): number => {
  let mixed = (state + 0x9e37_79b9) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x85eb_ca6b) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2_ae35) >>> 0;
  return (mixed ^ (mixed >>> 16)) >>> 0;
};

const mixField = (seed: number, value: number | string): number =>
  splitmix32(seed ^ (typeof value === "number" ? value >>> 0 : hashString(value)));

/**
 * Deterministic per-cell hash from map seed, layer, coordinates, terrain, and salt.
 * Animation time and other transient state must not participate.
 */
export const mixSeed = (
  mapSeed: number | string,
  layerId: string,
  cellX: number,
  cellY: number,
  terrainClass: TerrainClass | undefined,
  seedSalt: string,
): number => {
  let seed = typeof mapSeed === "number" ? mapSeed >>> 0 : hashString(String(mapSeed));
  seed = mixField(seed, layerId);
  seed = mixField(seed, cellX);
  seed = mixField(seed, cellY);
  seed = mixField(seed, terrainClass ?? "");
  seed = mixField(seed, seedSalt);
  return seed >>> 0;
};
