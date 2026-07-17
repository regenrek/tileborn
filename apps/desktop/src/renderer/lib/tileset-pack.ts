import { type PackId } from '@tileborne/core';
import { parseTilesetManifest } from '@tileborne/sdk-tileset/manifest';
import type { TilesetPack } from '@tileborne/sdk-tileset/schemas';

import { assetProtocolUrl } from '@/lib/asset-url';

export const TILESET_MANIFEST_PATH = 'tileborne-asset-pack.json';

const diagnosticsMessage = (diagnostics: readonly { readonly message: string }[]): string =>
  diagnostics.map((diagnostic) => diagnostic.message).join('; ');

const normalizeInstalledTilesetManifestJson = (json: unknown): unknown => {
  if (
    typeof json !== 'object' ||
    json === null ||
    !Array.isArray((json as { placeables?: unknown }).placeables)
  ) {
    return json;
  }
  return {
    ...(json as Record<string, unknown>),
    placeables: (json as { readonly placeables: readonly unknown[] }).placeables.map(
      (placeable) => {
        if (typeof placeable !== 'object' || placeable === null || 'placementMode' in placeable) {
          return placeable;
        }
        return { ...placeable, placementMode: 'object' };
      },
    ),
  };
};

export const parseTilesetPackJson = (json: unknown): TilesetPack => {
  const result = parseTilesetManifest(normalizeInstalledTilesetManifestJson(json));
  if (result.value === undefined) {
    throw new Error(`invalid tileset manifest: ${diagnosticsMessage(result.diagnostics)}`);
  }
  return result.value;
};

export const loadTilesetPack = async (packId: PackId): Promise<TilesetPack> => {
  // Fetch the manifest through the `tileborne-asset` protocol instead of a
  // base64 data URL over IPC: this avoids allocating/decoding a ~12MB base64
  // string for large packs and lets the network stack stream the JSON.
  const response = await fetch(assetProtocolUrl(packId, TILESET_MANIFEST_PATH));
  if (!response.ok) {
    throw new Error(`failed to load tileset manifest for ${packId}: ${response.status}`);
  }
  const json = (await response.json()) as unknown;
  return parseTilesetPackJson(json);
};
