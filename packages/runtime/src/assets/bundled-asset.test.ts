import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  BundledAssetIdSchema,
  createBundledAssetRegistry,
  type BundledAssetId,
} from './bundled-asset.js';

const decodeBundledAssetId = (value: string): BundledAssetId =>
  Schema.decodeUnknownSync(BundledAssetIdSchema)(value);

describe('BundledAssetIdSchema', () => {
  it('accepts plugin-namespaced bundled asset ids', () => {
    expect(decodeBundledAssetId('@tileborne-plugins/battle-royale:default-pet')).toBe(
      '@tileborne-plugins/battle-royale:default-pet',
    );
  });

  it('rejects real asset UUID-style ids', () => {
    expect(() => decodeBundledAssetId('asset:00000000-0000-0000-0000-000000000000')).toThrow();
  });

  it('rejects ids without a namespace separator', () => {
    expect(() => decodeBundledAssetId('no-colon')).toThrow();
  });
});

describe('createBundledAssetRegistry', () => {
  it('round-trips registered assets through get and list', () => {
    const registry = createBundledAssetRegistry();
    const assetId = decodeBundledAssetId('@tileborne-plugins/battle-royale:default-pet');

    const registered = registry.register({
      assetId,
      path: 'data:image/png;base64,AAAA',
      mime: 'image/png',
      width: 24,
      height: 24,
    });

    expect(registry.get(assetId)).toBe(registered);
    expect(registry.list()).toEqual([registered]);
  });
});
