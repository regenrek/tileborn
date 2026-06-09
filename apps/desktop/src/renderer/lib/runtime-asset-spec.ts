import { BundledAssetIdSchema, type BundledAssetSpec } from '@tileborne/runtime';
import { Schema } from 'effect';

import { assetProtocolUrl } from '@/lib/asset-url';

export const renderablePackAssetId = (
  namespace: string,
  packId: string,
  assetId: string,
): string => `${namespace}:${packId}:${assetId}`;

export const loadPackAssetBundledSpec = async (asset: {
  readonly renderableAssetId: string;
  readonly packId: string;
  readonly assetPath: string;
  readonly mime: string;
}): Promise<BundledAssetSpec> => {
  const response = await fetch(assetProtocolUrl(asset.packId, asset.assetPath));
  if (!response.ok) {
    throw new Error(`failed to load runtime atlas ${asset.assetPath}: ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return {
    assetId: Schema.decodeUnknownSync(BundledAssetIdSchema)(asset.renderableAssetId),
    path: `data:${asset.mime};base64,${btoa(binary)}`,
    mime: asset.mime,
  };
};
