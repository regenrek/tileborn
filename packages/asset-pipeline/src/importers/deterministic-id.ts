import {
  hashBytes,
  makeAssetId,
  makeTileId,
  makeTileSetId,
  type AssetId,
  type TileId,
  type TileSetId,
  type Uuid,
} from '@tileborne/core';

const encoder = new TextEncoder();

const uuidFromSeed = (seed: string): Uuid => {
  const hex = hashBytes(encoder.encode(seed)).slice('sha256:'.length);
  const variant = ['8', '9', 'a', 'b'][Number.parseInt(hex[16]!, 16) % 4]!;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(
    17,
    20,
  )}-${hex.slice(20, 32)}` as Uuid;
};

export const deterministicAssetId = (seed: string): AssetId => makeAssetId(uuidFromSeed(seed));

export const deterministicTileId = (seed: string): TileId => makeTileId(uuidFromSeed(seed));

export const deterministicTileSetId = (seed: string): TileSetId =>
  makeTileSetId(uuidFromSeed(seed));
