import { PERSISTED_SCHEMA_VERSIONS, type PackId } from '@tileborne/core';

export const TILE_PALETTE_METADATA_PATH = 'metadata/tileborne-palette.json';

export type TilePaletteCategory = 'terrain' | 'props' | 'characters' | string;

export interface TilePaletteFrame {
  readonly tileIndex: number;
  readonly category: TilePaletteCategory;
  readonly label: string;
  readonly assetPath: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly tags?: readonly string[];
}

export interface TilePaletteMetadata {
  readonly schemaVersion: typeof PERSISTED_SCHEMA_VERSIONS.tilePaletteMetadata;
  readonly name: string;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly categories: readonly TilePaletteCategory[];
  readonly tiles: readonly TilePaletteFrame[];
}

const parseDataUrlJson = (dataUrl: string): unknown => {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex === -1) {
    throw new Error('invalid palette metadata data URL');
  }
  return JSON.parse(atob(dataUrl.slice(commaIndex + 1))) as unknown;
};

const isFrame = (value: unknown): value is TilePaletteFrame => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const frame = value as Record<string, unknown>;
  return (
    typeof frame.tileIndex === 'number' &&
    typeof frame.category === 'string' &&
    typeof frame.label === 'string' &&
    typeof frame.assetPath === 'string' &&
    typeof frame.x === 'number' &&
    typeof frame.y === 'number' &&
    typeof frame.width === 'number' &&
    typeof frame.height === 'number'
  );
};

const decodePaletteMetadata = (value: unknown): TilePaletteMetadata => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('palette metadata must be an object');
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.schemaVersion !== PERSISTED_SCHEMA_VERSIONS.tilePaletteMetadata ||
    typeof candidate.name !== 'string' ||
    typeof candidate.tileWidth !== 'number' ||
    typeof candidate.tileHeight !== 'number' ||
    !Array.isArray(candidate.categories) ||
    !candidate.categories.every((entry) => typeof entry === 'string') ||
    !Array.isArray(candidate.tiles) ||
    !candidate.tiles.every(isFrame)
  ) {
    throw new Error('palette metadata shape is invalid');
  }
  return candidate as unknown as TilePaletteMetadata;
};

export const loadTilePaletteMetadata = async (
  packId: PackId,
): Promise<TilePaletteMetadata | undefined> => {
  try {
    const { dataUrl } = await window.tileborne.assets.getAssetDataUrl({
      packId,
      assetPath: TILE_PALETTE_METADATA_PATH,
    });
    return decodePaletteMetadata(parseDataUrlJson(dataUrl));
  } catch {
    return undefined;
  }
};
