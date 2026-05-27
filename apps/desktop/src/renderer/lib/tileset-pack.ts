import { hashBytes, type ContentHash, type PackId } from '@tileborne/core';
import { createRuntimeAssetManifest, type RuntimeAssetManifest } from '@tileborne/runtime';
import { parseTilesetManifest } from '@tileborne/sdk-tileset/manifest';
import type { CollisionMaskType, TileIdType, TilesetPack } from '@tileborne/sdk-tileset/schemas';
import { Option } from 'effect';

export const TILESET_MANIFEST_PATH = 'tileborne-asset-pack.json';

const parseDataUrlJson = (dataUrl: string): unknown => {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex === -1) {
    throw new Error('invalid asset data URL');
  }
  const payload = dataUrl.slice(commaIndex + 1);
  return JSON.parse(atob(payload)) as unknown;
};

const diagnosticsMessage = (diagnostics: readonly { readonly message: string }[]): string =>
  diagnostics.map((diagnostic) => diagnostic.message).join('; ');

const normalizeInstalledTilesetManifestJson = (json: unknown): unknown => {
  if (typeof json !== 'object' || json === null || !Array.isArray((json as { placeables?: unknown }).placeables)) {
    return json;
  }
  return {
    ...(json as Record<string, unknown>),
    placeables: (json as { readonly placeables: readonly unknown[] }).placeables.map((placeable) => {
      if (typeof placeable !== 'object' || placeable === null || 'placementMode' in placeable) {
        return placeable;
      }
      return { ...placeable, placementMode: 'object' };
    }),
  };
};

export const parseTilesetPackJson = (json: unknown): TilesetPack => {
  const result = parseTilesetManifest(normalizeInstalledTilesetManifestJson(json));
  if (result.value === undefined) {
    throw new Error(
      `invalid tileset manifest: ${diagnosticsMessage(result.diagnostics)}`,
    );
  }
  return result.value;
};

export const loadTilesetPack = async (packId: PackId): Promise<TilesetPack> => {
  const { dataUrl } = await window.tileborne.assets.getAssetDataUrl({
    packId,
    assetPath: TILESET_MANIFEST_PATH,
  });
  return parseTilesetPackJson(parseDataUrlJson(dataUrl));
};

export const tileIndexByTileId = (pack: TilesetPack): ReadonlyMap<TileIdType, number> => {
  const byTileId = new Map<TileIdType, number>();
  let tileIndex = 1;
  for (const tileset of pack.tilesets) {
    for (const tile of tileset.tiles) {
      byTileId.set(tile.id, tileIndex);
      tileIndex += 1;
    }
  }
  return byTileId;
};

export const tileIdByTileIndex = (pack: TilesetPack): ReadonlyMap<number, TileIdType> => {
  const byTileIndex = new Map<number, TileIdType>();
  let tileIndex = 1;
  for (const tileset of pack.tilesets) {
    for (const tile of tileset.tiles) {
      byTileIndex.set(tileIndex, tile.id);
      tileIndex += 1;
    }
  }
  return byTileIndex;
};

export const collisionMaskByTileIndex = (pack: TilesetPack): ReadonlyMap<number, CollisionMaskType> => {
  const byTileIndex = new Map<number, CollisionMaskType>();
  let tileIndex = 1;
  for (const tileset of pack.tilesets) {
    for (const tile of tileset.tiles) {
      const mask = Option.getOrUndefined(tile.collisionMask);
      if (mask !== undefined) {
        byTileIndex.set(tileIndex, mask);
      }
      tileIndex += 1;
    }
  }
  return byTileIndex;
};

const contentHashForDataUrl = (dataUrl: string): ContentHash =>
  hashBytes(new TextEncoder().encode(dataUrl));

export const buildRuntimeManifestFromTilesetPack = (
  pack: TilesetPack,
  textureDataUrls: ReadonlyMap<string, string>,
): RuntimeAssetManifest => {
  const assets: Array<Parameters<typeof createRuntimeAssetManifest>[0]['assets'][number]> = [];
  for (const asset of pack.assets) {
    if (!asset.mime.startsWith('image/') || !textureDataUrls.has(asset.path)) {
      continue;
    }
    const dataUrl = textureDataUrls.get(asset.path)!;
    assets.push({
      id: asset.id,
      path: dataUrl,
      mime: asset.mime,
      size: dataUrl.length,
      hash: contentHashForDataUrl(dataUrl),
      license: Option.none(),
    });
  }

  return createRuntimeAssetManifest({
    id: pack.id,
    name: pack.name,
    version: pack.version,
    license: {
      spdxId: pack.license.spdxId,
      attribution: pack.license.attribution,
      sourceUrl: pack.license.sourceUrl,
      notes: pack.license.notes,
    },
    // The caller decides which textures to materialise; the viewport pipeline
    // now passes only atlas paths so we no longer require every pack image to
    // have a corresponding data URL. Image assets without a provided data URL
    // are skipped — the runtime manifest only describes textures we will
    // actually upload to the renderer this session.
    assets,
  });
};
