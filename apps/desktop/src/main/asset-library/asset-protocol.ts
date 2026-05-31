import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { protocol } from 'electron';
import { Effect } from 'effect';

import type { ContentHash, PackId } from '@tileborne/core';
import { AssetService, packManifestContentHash } from '@tileborne/services-app';
import { HomeService } from '@tileborne/services-foundation';

import { runEffect } from '../runtime.js';
import {
  ASSET_PROTOCOL_SCHEME,
  type AssetThumbnailRequest,
  containedAssetPath,
  parseAssetProtocolRequest,
  parseAssetThumbnailRequest,
  thumbnailCacheDir,
  thumbnailCacheFileName,
} from './asset-protocol-url.js';
import { ensureThumbnail } from './thumbnail-generator.js';

export { ASSET_PROTOCOL_SCHEME } from './asset-protocol-url.js';

/**
 * Streams installed pack files (atlases, the manifest) to the renderer over the
 * `tileborne-asset` scheme. The renderer renders the bytes via `<img src>`
 * (decode happens off the main thread) or fetches them for Pixi textures,
 * avoiding the previous base64-data-URL-over-IPC path. Pure URL/containment
 * helpers live in asset-protocol-url.ts.
 */
const MANIFEST_PATH = 'tileborne-asset-pack.json';

interface ResolvedAsset {
  readonly filePath: string;
  readonly mime: string;
}

const installedPackRoot = (assetsRoot: string, packId: string, version: string): string =>
  path.join(assetsRoot, 'packs', `${packId}-${version}`);

const resolveAsset = (
  packIdRaw: string,
  assetPath: string,
): Effect.Effect<ResolvedAsset, never, HomeService | AssetService> =>
  Effect.gen(function* () {
    const home = yield* HomeService;
    const assets = yield* AssetService;
    const paths = yield* home.init();
    const pack = yield* assets.getPack(packIdRaw as PackId);
    const packRoot = installedPackRoot(paths.assets, pack.id, pack.version);

    if (assetPath === MANIFEST_PATH) {
      return { filePath: path.join(packRoot, MANIFEST_PATH), mime: 'application/json' };
    }

    const asset = pack.assets.find((candidate) => candidate.path === assetPath);
    if (asset === undefined) {
      return yield* Effect.die(new Error(`Asset not found in pack: ${assetPath}`));
    }
    const resolved = containedAssetPath(packRoot, asset.path);
    if (resolved === undefined) {
      return yield* Effect.die(new Error(`Asset path escapes pack root: ${assetPath}`));
    }
    return { filePath: resolved, mime: asset.mime };
  }).pipe(Effect.orDie);

interface ResolvedThumbnailContext {
  readonly sourceFilePath: string;
  readonly cacheFilePath: string;
}

const resolveThumbnailContext = (
  request: AssetThumbnailRequest,
): Effect.Effect<ResolvedThumbnailContext, never, HomeService | AssetService> =>
  Effect.gen(function* () {
    const home = yield* HomeService;
    const assets = yield* AssetService;
    const paths = yield* home.init();
    const pack = yield* assets.getPack(request.packId as PackId);
    const packRoot = installedPackRoot(paths.assets, pack.id, pack.version);
    const integrityHash: ContentHash = packManifestContentHash(pack);

    const asset = pack.assets.find((candidate) => candidate.path === request.assetPath);
    if (asset === undefined) {
      return yield* Effect.die(new Error(`Asset not found in pack: ${request.assetPath}`));
    }
    const sourceFilePath = containedAssetPath(packRoot, asset.path);
    if (sourceFilePath === undefined) {
      return yield* Effect.die(new Error(`Asset path escapes pack root: ${request.assetPath}`));
    }
    const cacheFilePath = path.join(
      thumbnailCacheDir(paths.cache, pack.id, integrityHash),
      thumbnailCacheFileName(request),
    );
    return { sourceFilePath, cacheFilePath };
  }).pipe(Effect.orDie);

const badRequest = (message: string): Response =>
  new Response(message, { status: 400, headers: { 'content-type': 'text/plain' } });

const notFound = (message: string): Response =>
  new Response(message, { status: 404, headers: { 'content-type': 'text/plain' } });

/**
 * Register the `tileborne-asset` protocol handler. Must be called after
 * `app.whenReady()` (the scheme itself is registered as privileged in main.ts
 * before app ready).
 */
export const registerAssetProtocol = (): void => {
  protocol.handle(ASSET_PROTOCOL_SCHEME, async (request) => {
    const thumbnail = parseAssetThumbnailRequest(request.url);
    if (thumbnail !== null) {
      try {
        const resolved = await runEffect(resolveThumbnailContext(thumbnail));
        const bytes = await ensureThumbnail({
          sourceFilePath: resolved.sourceFilePath,
          cacheFilePath: resolved.cacheFilePath,
          geometry: {
            x: thumbnail.x,
            y: thumbnail.y,
            width: thumbnail.width,
            height: thumbnail.height,
          },
        });
        return new Response(new Uint8Array(bytes), {
          status: 200,
          headers: {
            'content-type': 'image/png',
            // Content-addressed by pack integrity + crop; safe to cache hard.
            'cache-control': 'public, max-age=31536000, immutable',
            'access-control-allow-origin': '*',
          },
        });
      } catch (cause) {
        return notFound(cause instanceof Error ? cause.message : String(cause));
      }
    }

    const parsed = parseAssetProtocolRequest(request.url);
    if (parsed === null) {
      return badRequest('Missing or malformed id/path');
    }

    try {
      const resolved = await runEffect(resolveAsset(parsed.packId, parsed.assetPath));
      const bytes = await readFile(resolved.filePath);
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: {
          'content-type': resolved.mime,
          'cache-control': 'no-cache',
          // Renderer fetch() to this scheme is cross-origin (http/file origin);
          // allow it so the viewport atlas loader and manifest load succeed.
          'access-control-allow-origin': '*',
        },
      });
    } catch (cause) {
      return notFound(cause instanceof Error ? cause.message : String(cause));
    }
  });
};
