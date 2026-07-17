import { createHash } from 'node:crypto';
import path from 'node:path';

import { PERSISTED_SCHEMA_VERSIONS } from '@tileborne/core';

/**
 * Custom scheme that streams installed pack files to the renderer. Pure URL /
 * path helpers live here (no electron/runtime imports) so they are unit
 * testable without the Electron main process.
 *
 * Two request shapes share the scheme:
 *   - `tileborne-asset://pack?id=<packId>&path=<assetPath>` streams a raw pack
 *     file (atlas, manifest) as-is.
 *   - `tileborne-asset://thumb?id=<packId>&path=<assetPath>&x&y&w&h[&v]` serves a
 *     precomputed, disk-cached small thumbnail (a single tile/object crop scaled
 *     into a fixed box). See thumbnail-generator.ts.
 */
export const ASSET_PROTOCOL_SCHEME = 'tileborne-asset';
export const ASSET_PROTOCOL_PACK_HOST = 'pack';
export const ASSET_PROTOCOL_THUMB_HOST = 'thumb';

/** Longest-side pixel box every precomputed thumbnail fits into. */
export const THUMBNAIL_BOX_PX = 64;
/** Bumped whenever the thumbnail encoding/box changes so caches invalidate. */
export const THUMBNAIL_CACHE_SCHEMA_VERSION = PERSISTED_SCHEMA_VERSIONS.thumbnailCache;
const THUMBNAIL_CACHE_DIR = 'asset-library/thumbnails';

export interface AssetProtocolRequest {
  readonly packId: string;
  readonly assetPath: string;
}

export interface AssetThumbnailRequest {
  readonly packId: string;
  readonly assetPath: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly integrityHash?: string | undefined;
}

const urlHost = (rawUrl: string): { url: URL; host: string } | null => {
  try {
    const url = new URL(rawUrl);
    return { url, host: url.host };
  } catch {
    return null;
  }
};

/**
 * Parses a `tileborne-asset://pack?id=<packId>&path=<assetPath>` URL into its
 * `id`/`path` parameters. Returns `null` for malformed URLs, the wrong host, or
 * missing params.
 */
export const parseAssetProtocolRequest = (rawUrl: string): AssetProtocolRequest | null => {
  const parsed = urlHost(rawUrl);
  if (parsed === null || parsed.host !== ASSET_PROTOCOL_PACK_HOST) {
    return null;
  }
  const packId = parsed.url.searchParams.get('id');
  const assetPath = parsed.url.searchParams.get('path');
  if (packId === null || packId.length === 0 || assetPath === null || assetPath.length === 0) {
    return null;
  }
  return { packId, assetPath };
};

const parseFiniteInt = (value: string | null): number | null => {
  if (value === null || value.length === 0) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
};

/**
 * Parses a `tileborne-asset://thumb?...` URL into the pack id, source asset
 * path, and crop rect. Returns `null` for malformed URLs, the wrong host, or
 * missing/invalid params. The optional `v` integrity hash is a browser
 * cache-buster only; the handler always derives the authoritative hash.
 */
export const parseAssetThumbnailRequest = (rawUrl: string): AssetThumbnailRequest | null => {
  const parsed = urlHost(rawUrl);
  if (parsed === null || parsed.host !== ASSET_PROTOCOL_THUMB_HOST) {
    return null;
  }
  const params = parsed.url.searchParams;
  const packId = params.get('id');
  const assetPath = params.get('path');
  const x = parseFiniteInt(params.get('x'));
  const y = parseFiniteInt(params.get('y'));
  const width = parseFiniteInt(params.get('w'));
  const height = parseFiniteInt(params.get('h'));
  if (
    packId === null ||
    packId.length === 0 ||
    assetPath === null ||
    assetPath.length === 0 ||
    x === null ||
    y === null ||
    width === null ||
    height === null ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  const integrityHash = params.get('v') ?? undefined;
  return {
    packId,
    assetPath,
    x,
    y,
    width,
    height,
    ...(integrityHash !== undefined && integrityHash.length > 0 ? { integrityHash } : {}),
  };
};

/**
 * Resolves an asset path within a pack root, rejecting any path that escapes
 * the root (path traversal). Returns `undefined` when the path is not
 * contained.
 */
export const containedAssetPath = (packRoot: string, assetPath: string): string | undefined => {
  const resolved = path.resolve(packRoot, assetPath);
  if (resolved !== packRoot && !resolved.startsWith(`${packRoot}${path.sep}`)) {
    return undefined;
  }
  return resolved;
};

const safeCacheSegment = (value: string): string => value.replace(/[^a-zA-Z0-9.-]/g, '_');

/**
 * Per-pack, per-integrity thumbnail cache directory. Sibling of the library
 * index-metadata cache under the home cache root, content-addressed by pack
 * integrity so a reinstalled pack never serves stale crops.
 */
export const thumbnailCacheDir = (
  cacheRoot: string,
  packId: string,
  integrityHash: string,
): string =>
  path.join(
    cacheRoot,
    THUMBNAIL_CACHE_DIR,
    `v${THUMBNAIL_CACHE_SCHEMA_VERSION}-${safeCacheSegment(packId)}-${safeCacheSegment(
      integrityHash,
    )}`,
  );

/**
 * Deterministic file name for a single crop. Keyed by the crop geometry +
 * target box so identical crops (e.g. the same tile referenced by many groups)
 * share one cached file.
 */
export const thumbnailCacheFileName = (
  request: Pick<AssetThumbnailRequest, 'assetPath' | 'x' | 'y' | 'width' | 'height'>,
): string => {
  const digest = createHash('sha1')
    .update(
      `${request.assetPath}:${request.x}:${request.y}:${request.width}:${request.height}:${THUMBNAIL_BOX_PX}`,
    )
    .digest('hex');
  return `${digest}.png`;
};

export interface ThumbnailResizePlan {
  readonly crop: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly resize?: { readonly width: number; readonly height: number } | undefined;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/**
 * Pure crop/resize planner shared by the generator (and unit-tested without
 * electron). Clamps the requested crop into the decoded source bounds and only
 * downscales when the crop is larger than the target box — pixel art is never
 * upscaled here (the `<img>` upscales crisply via CSS instead).
 */
export const computeThumbnailResize = (
  source: { readonly width: number; readonly height: number },
  geometry: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
  box: number,
): ThumbnailResizePlan => {
  const x = clamp(Math.round(geometry.x), 0, Math.max(0, source.width - 1));
  const y = clamp(Math.round(geometry.y), 0, Math.max(0, source.height - 1));
  const width = clamp(Math.round(geometry.width), 1, Math.max(1, source.width - x));
  const height = clamp(Math.round(geometry.height), 1, Math.max(1, source.height - y));
  const crop = { x, y, width, height };
  const longest = Math.max(width, height);
  if (longest <= box) {
    return { crop };
  }
  const scale = box / longest;
  return {
    crop,
    resize: {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    },
  };
};
