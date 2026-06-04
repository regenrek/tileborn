import {
  TILED_FLIPPED_DIAGONALLY_FLAG,
  TILED_FLIPPED_HORIZONTALLY_FLAG,
  TILED_FLIPPED_VERTICALLY_FLAG,
  TILED_GID_MASK,
  TILED_ROTATED_HEXAGONAL_120_FLAG,
} from "./types.js";
import type { TiledGidTransform } from "./types.js";

export type DecodedTiledGid = {
  readonly gid: number;
  readonly transform: TiledGidTransform;
};

export const decodeTiledGid = (raw: number): DecodedTiledGid => {
  const unsigned = raw >>> 0;
  return {
    gid: unsigned & TILED_GID_MASK,
    transform: {
      flippedHorizontal: (unsigned & TILED_FLIPPED_HORIZONTALLY_FLAG) !== 0,
      flippedVertical: (unsigned & TILED_FLIPPED_VERTICALLY_FLAG) !== 0,
      flippedDiagonal: (unsigned & TILED_FLIPPED_DIAGONALLY_FLAG) !== 0,
      rotatedHexagonal120: (unsigned & TILED_ROTATED_HEXAGONAL_120_FLAG) !== 0,
    },
  };
};

/** Inverse of {@link decodeTiledGid}: re-apply flip/rotation flags to a masked gid. */
export const encodeTiledGid = (decoded: DecodedTiledGid): number => {
  let raw = decoded.gid & TILED_GID_MASK;
  if (decoded.transform.flippedHorizontal) raw |= TILED_FLIPPED_HORIZONTALLY_FLAG;
  if (decoded.transform.flippedVertical) raw |= TILED_FLIPPED_VERTICALLY_FLAG;
  if (decoded.transform.flippedDiagonal) raw |= TILED_FLIPPED_DIAGONALLY_FLAG;
  if (decoded.transform.rotatedHexagonal120) raw |= TILED_ROTATED_HEXAGONAL_120_FLAG;
  return raw >>> 0;
};

export const isIdentityTiledTransform = (transform: TiledGidTransform): boolean =>
  !transform.flippedHorizontal &&
  !transform.flippedVertical &&
  !transform.flippedDiagonal &&
  !transform.rotatedHexagonal120;

export type TiledTilesetWindow = {
  readonly firstgid: number;
  readonly tileCount: number;
  readonly tileborneTileCount: number;
  readonly tileborneTileIndexOffset: number;
  readonly name: string;
};

export const locateTiledGid = (
  raw: number,
  windows: readonly TiledTilesetWindow[],
): { readonly window: TiledTilesetWindow; readonly localId: number } | null => {
  const decoded = decodeTiledGid(raw);
  if (decoded.gid === 0) return null;
  let best: TiledTilesetWindow | undefined;
  for (const window of windows) {
    if (decoded.gid >= window.firstgid) {
      if (!best || window.firstgid > best.firstgid) best = window;
    }
  }
  if (!best) return null;
  const localId = decoded.gid - best.firstgid;
  if (localId < 0 || localId >= best.tileCount) return null;
  return { window: best, localId };
};

export const tileborneTileIndexForTiledGid = (
  raw: number,
  windows: readonly TiledTilesetWindow[],
): number => {
  const located = locateTiledGid(raw, windows);
  if (located === null || located.localId >= located.window.tileborneTileCount) return 0;
  return located.window.tileborneTileIndexOffset + located.localId + 1;
};

/**
 * Inverse of {@link tileborneTileIndexForTiledGid}: map a 1-based Tileborne tile
 * index back to the bare Tiled gid (without flip flags). Returns 0 for the empty
 * tile index (0) or indices that fall outside any tileset window.
 */
export const tiledGidForTileborneTileIndex = (
  tileIndex: number,
  windows: readonly TiledTilesetWindow[],
): number => {
  if (tileIndex <= 0) return 0;
  for (const window of windows) {
    const start = window.tileborneTileIndexOffset + 1;
    const end = window.tileborneTileIndexOffset + window.tileborneTileCount;
    if (tileIndex >= start && tileIndex <= end) {
      return window.firstgid + (tileIndex - start);
    }
  }
  return 0;
};
