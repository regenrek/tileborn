import { Asset, Tile, hashBytes, makeTileSet } from '@tileborne/core';
import { Result } from 'effect';

import {
  AssetTooLargeError,
  TilesetGridMismatchError,
  UnsupportedImporterInputError,
} from '../errors.js';
import { isImageMimeType } from '../security/mime-allowlist.js';
import { validateAssetCandidate } from '../security/security.js';
import { MAX_TILES_PER_TILESET } from '../security/size-limits.js';
import {
  deterministicAssetId,
  deterministicTileId,
  deterministicTileSetId,
} from './deterministic-id.js';
import type { AssetImporter, ImporterInput } from './importer.js';

export interface TilesetImporterInput extends ImporterInput {
  readonly mime: 'image/png' | 'image/webp' | 'image/jpeg';
  readonly name: string;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly columns: number;
  readonly rows: number;
}

const isPositiveInteger = (value: number): boolean => Number.isInteger(value) && value > 0;

const isTilesetImporterInput = (input: ImporterInput): input is TilesetImporterInput =>
  isImageMimeType(input.mime) &&
  typeof input.name === 'string' &&
  typeof input.imageWidth === 'number' &&
  typeof input.imageHeight === 'number' &&
  typeof input.tileWidth === 'number' &&
  typeof input.tileHeight === 'number' &&
  typeof input.columns === 'number' &&
  typeof input.rows === 'number';

export const tilesetImporter: AssetImporter = {
  id: 'tileborne.tileset.grid',
  supports: isTilesetImporterInput,
  import: (input) => {
    if (!isTilesetImporterInput(input)) {
      return Result.fail(
        new UnsupportedImporterInputError({
          importerId: tilesetImporter.id,
          mime: input.mime,
          message: 'Grid tileset importer requires image bytes and grid metadata',
        }),
      );
    }

    const grid = input;
    const validated = validateAssetCandidate(input);
    if (Result.isFailure(validated)) {
      return Result.fail(validated.failure);
    }

    const gridMatches =
      isPositiveInteger(grid.imageWidth) &&
      isPositiveInteger(grid.imageHeight) &&
      isPositiveInteger(grid.tileWidth) &&
      isPositiveInteger(grid.tileHeight) &&
      isPositiveInteger(grid.columns) &&
      isPositiveInteger(grid.rows) &&
      grid.tileWidth * grid.columns === grid.imageWidth &&
      grid.tileHeight * grid.rows === grid.imageHeight;

    if (!gridMatches) {
      return Result.fail(
        new TilesetGridMismatchError({
          imageWidth: grid.imageWidth,
          imageHeight: grid.imageHeight,
          tileWidth: grid.tileWidth,
          tileHeight: grid.tileHeight,
          columns: grid.columns,
          rows: grid.rows,
          message: 'Tileset grid does not cover the source image exactly',
        }),
      );
    }

    const tileCount = grid.columns * grid.rows;
    if (tileCount > MAX_TILES_PER_TILESET) {
      return Result.fail(
        new AssetTooLargeError({
          size: tileCount,
          maxSize: MAX_TILES_PER_TILESET,
          scope: 'tileset',
          message: `Tileset exceeds ${MAX_TILES_PER_TILESET} tiles`,
        }),
      );
    }

    const hash = hashBytes(input.bytes);
    const imageAssetId = deterministicAssetId(
      `${tilesetImporter.id}:image:${input.filename}:${hash}`,
    );
    const tileSetId = deterministicTileSetId(`${tilesetImporter.id}:tileset:${grid.name}:${hash}`);
    const tiles = Array.from(
      { length: tileCount },
      (_, localId) =>
        new Tile({
          id: deterministicTileId(`${tileSetId}:tile:${localId}`),
          localId,
          width: grid.tileWidth,
          height: grid.tileHeight,
          properties: {},
        }),
    );

    const imageAsset = new Asset({
      id: imageAssetId,
      kind: 'tileset',
      path: input.path ?? input.filename,
      properties: {
        hash,
        mime: input.mime,
        size: input.bytes.byteLength,
        imageWidth: grid.imageWidth,
        imageHeight: grid.imageHeight,
      },
    });

    const tileSet = makeTileSet({
      id: tileSetId,
      name: grid.name,
      kind: 'grid',
      tileWidth: grid.tileWidth,
      tileHeight: grid.tileHeight,
      tileCount,
      columns: grid.columns,
      imageAssetId,
      tiles,
      properties: {
        sourcePath: input.path ?? input.filename,
        sourceHash: hash,
      },
    });

    return Result.succeed([imageAsset, tileSet]);
  },
};
