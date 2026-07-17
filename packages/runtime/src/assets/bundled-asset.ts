import { Schema } from 'effect';

const BUNDLED_ASSET_ID_PATTERN =
  /^(?!asset:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$)[^\s:]+:[^\s]+$/i;

/**
 * Plugin-bundled asset id. This intentionally does not reuse core AssetId,
 * which remains reserved for durable asset-pack entries.
 */
export const BundledAssetIdSchema = Schema.String.check(
  Schema.isPattern(BUNDLED_ASSET_ID_PATTERN),
).pipe(Schema.brand('BundledAssetId'));

export type BundledAssetId = typeof BundledAssetIdSchema.Type;

export interface BundledAssetSpec {
  readonly assetId: BundledAssetId;
  readonly path: string;
  readonly mime: string;
  readonly width?: number;
  readonly height?: number;
}

export interface RegisteredBundledAsset {
  readonly assetId: BundledAssetId;
  readonly path: string;
  readonly mime: string;
}

export interface BundledAssetRegistry {
  readonly register: (spec: BundledAssetSpec) => RegisteredBundledAsset;
  readonly get: (id: BundledAssetId) => RegisteredBundledAsset | undefined;
  readonly list: () => readonly RegisteredBundledAsset[];
}

export const createBundledAssetRegistry = (): BundledAssetRegistry => {
  const assets = new Map<BundledAssetId, RegisteredBundledAsset>();

  return {
    register: (spec) => {
      const registered: RegisteredBundledAsset = {
        assetId: spec.assetId,
        path: spec.path,
        mime: spec.mime,
      };
      assets.set(spec.assetId, registered);
      return registered;
    },
    get: (id) => assets.get(id),
    list: () => [...assets.values()],
  };
};
