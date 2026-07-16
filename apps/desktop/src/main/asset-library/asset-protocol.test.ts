import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ASSET_PROTOCOL_SCHEME,
  computeThumbnailResize,
  containedAssetPath,
  parseAssetProtocolRequest,
  parseAssetThumbnailRequest,
  thumbnailCacheDir,
  thumbnailCacheFileName,
} from './asset-protocol-url.js';

const url = (packId: string, assetPath: string): string =>
  `${ASSET_PROTOCOL_SCHEME}://pack?id=${encodeURIComponent(packId)}&path=${encodeURIComponent(assetPath)}`;

// Mirrors the renderer's assetThumbnailUrl builder (apps/.../lib/asset-url.ts)
// so this suite verifies the main-side parser stays in sync with that format.
const thumbUrl = (
  packId: string,
  geometry: { assetPath: string; x: number; y: number; width: number; height: number },
  integrityHash?: string,
): string => {
  const params = new URLSearchParams({
    id: packId,
    path: geometry.assetPath,
    x: String(geometry.x),
    y: String(geometry.y),
    w: String(geometry.width),
    h: String(geometry.height),
  });
  if (integrityHash !== undefined) {
    params.set('v', integrityHash);
  }
  return `${ASSET_PROTOCOL_SCHEME}://thumb?${params.toString()}`;
};

describe('parseAssetProtocolRequest', () => {
  it('decodes pack id (with colon) and asset path (with slashes/spaces)', () => {
    const parsed = parseAssetProtocolRequest(
      url('pack:3bfbd024-3e49', 'Tilesets/Animated Terrains.png'),
    );
    expect(parsed).toEqual({
      packId: 'pack:3bfbd024-3e49',
      assetPath: 'Tilesets/Animated Terrains.png',
    });
  });

  it('returns null when params are missing', () => {
    expect(parseAssetProtocolRequest(`${ASSET_PROTOCOL_SCHEME}://pack`)).toBeNull();
    expect(parseAssetProtocolRequest(`${ASSET_PROTOCOL_SCHEME}://pack?id=x`)).toBeNull();
    expect(parseAssetProtocolRequest(`${ASSET_PROTOCOL_SCHEME}://pack?path=y`)).toBeNull();
  });

  it('returns null for a malformed URL', () => {
    expect(parseAssetProtocolRequest('not a url')).toBeNull();
  });

  it('returns null for a thumbnail-host URL (handled separately)', () => {
    expect(
      parseAssetProtocolRequest(
        thumbUrl('pack:x', { assetPath: 'a.png', x: 0, y: 0, width: 32, height: 32 }),
      ),
    ).toBeNull();
  });
});

describe('parseAssetThumbnailRequest', () => {
  it('round-trips the URL built by the renderer (id/path/crop/v)', () => {
    const built = thumbUrl(
      'pack:3bfbd024-3e49',
      { assetPath: 'Tilesets/Animated Terrains.png', x: 32, y: 64, width: 32, height: 48 },
      'sha256:abc',
    );
    expect(parseAssetThumbnailRequest(built)).toEqual({
      packId: 'pack:3bfbd024-3e49',
      assetPath: 'Tilesets/Animated Terrains.png',
      x: 32,
      y: 64,
      width: 32,
      height: 48,
      integrityHash: 'sha256:abc',
    });
  });

  it('omits the integrity hash when no v is present', () => {
    const parsed = parseAssetThumbnailRequest(
      thumbUrl('pack:x', { assetPath: 'a.png', x: 0, y: 0, width: 16, height: 16 }),
    );
    expect(parsed?.integrityHash).toBeUndefined();
  });

  it('returns null for a pack-host URL, missing crop, or non-positive size', () => {
    expect(parseAssetThumbnailRequest(url('pack:x', 'a.png'))).toBeNull();
    expect(
      parseAssetThumbnailRequest(
        `${ASSET_PROTOCOL_SCHEME}://thumb?id=x&path=a.png&x=0&y=0&w=0&h=16`,
      ),
    ).toBeNull();
    expect(
      parseAssetThumbnailRequest(`${ASSET_PROTOCOL_SCHEME}://thumb?id=x&path=a.png&x=0&y=0`),
    ).toBeNull();
  });
});

describe('thumbnailCacheFileName', () => {
  const base = { assetPath: 'tiles/a.png', x: 16, y: 0, width: 32, height: 32 } as const;

  it('is deterministic for identical crop geometry', () => {
    expect(thumbnailCacheFileName(base)).toBe(thumbnailCacheFileName({ ...base }));
    expect(thumbnailCacheFileName(base)).toMatch(/^[0-9a-f]{40}\.png$/);
  });

  it('differs when the crop geometry differs', () => {
    expect(thumbnailCacheFileName(base)).not.toBe(thumbnailCacheFileName({ ...base, x: 0 }));
    expect(thumbnailCacheFileName(base)).not.toBe(
      thumbnailCacheFileName({ ...base, assetPath: 'tiles/b.png' }),
    );
  });
});

describe('thumbnailCacheDir', () => {
  it('is content-addressed by pack id + integrity hash under the cache root', () => {
    const dir = thumbnailCacheDir('/home/cache', 'pack:abc', 'sha256:def');
    expect(dir).toBe(
      path.join('/home/cache', 'asset-library/thumbnails', 'v1-pack_abc-sha256_def'),
    );
  });
});

describe('computeThumbnailResize', () => {
  it('downscales the longest side into the box and preserves aspect', () => {
    const plan = computeThumbnailResize(
      { width: 1515, height: 1504 },
      { x: 0, y: 0, width: 256, height: 128 },
      64,
    );
    expect(plan.crop).toEqual({ x: 0, y: 0, width: 256, height: 128 });
    expect(plan.resize).toEqual({ width: 64, height: 32 });
  });

  it('does not upscale crops already within the box', () => {
    const plan = computeThumbnailResize(
      { width: 256, height: 256 },
      { x: 0, y: 0, width: 32, height: 32 },
      64,
    );
    expect(plan.crop).toEqual({ x: 0, y: 0, width: 32, height: 32 });
    expect(plan.resize).toBeUndefined();
  });

  it('clamps a crop that overflows the source bounds', () => {
    const plan = computeThumbnailResize(
      { width: 40, height: 40 },
      { x: 32, y: 32, width: 32, height: 32 },
      64,
    );
    expect(plan.crop).toEqual({ x: 32, y: 32, width: 8, height: 8 });
    expect(plan.resize).toBeUndefined();
  });
});

describe('containedAssetPath', () => {
  const packRoot = path.join('/home', 'packs', 'pack-1.0.0');

  it('resolves a contained asset path', () => {
    expect(containedAssetPath(packRoot, 'tiles/sample.png')).toBe(
      path.join(packRoot, 'tiles/sample.png'),
    );
  });

  it('rejects path traversal escaping the pack root', () => {
    expect(containedAssetPath(packRoot, '../../etc/passwd')).toBeUndefined();
    expect(containedAssetPath(packRoot, '../pack-2.0.0/secret.png')).toBeUndefined();
  });
});
