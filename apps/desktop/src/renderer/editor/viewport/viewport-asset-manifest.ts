import {
  makeAssetId,
  makePackId,
  PackId,
  ProjectId,
  type ContentHash,
  type TileborneMap,
} from '@tileborne/core';
import { buildFrameIndex, type FrameIndex } from '@tileborne/sdk-tileset/renderer';
import type { TileIdType, TilesetPack } from '@tileborne/sdk-tileset/schemas';
import { createRuntimeAssetManifest, type RuntimeAssetManifest } from '@tileborne/runtime';
import {
  buildRuntimeManifestFromTilesetPack,
  collisionMaskByTileIndex,
  loadTilesetPack,
  tileIdByTileIndex,
  tileIndexByTileId,
} from '@/lib/tileset-pack';
import { Effect, Schema } from 'effect';

/** 1×1 transparent PNG used when no pack is available for the viewport. */
const BLANK_TEXTURE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export interface ViewportAssetManifestRequest {
  readonly projectId?: string;
  readonly packId?: PackId;
  readonly map?: TileborneMap;
}

export interface ViewportAssetBundle {
  readonly packId?: PackId;
  readonly pack?: TilesetPack | undefined;
  readonly frameIndex?: FrameIndex | undefined;
  readonly manifest: RuntimeAssetManifest;
  readonly tileIndexByTileId: ReadonlyMap<TileIdType, number>;
  readonly tileIdByTileIndex: ReadonlyMap<number, TileIdType>;
  readonly collisionMaskByTileIndex: ReturnType<typeof collisionMaskByTileIndex>;
  readonly renderableAssetIdByPath: ReadonlyMap<string, number>;
}

const viewportAssetBundleCache = new Map<string, Promise<ViewportAssetBundle>>();

export const clearViewportAssetBundleCache = (): void => {
  viewportAssetBundleCache.clear();
};

export const resolveViewportPackId = async (
  request: ViewportAssetManifestRequest,
): Promise<PackId | undefined> => {
  if (request.packId !== undefined) {
    return request.packId;
  }
  const mapPackId = request.map?.properties.tilesetPackId;
  if (typeof mapPackId === 'string' && mapPackId.length > 0) {
    return Schema.decodeUnknownSync(PackId)(mapPackId);
  }
  if (request.projectId !== undefined && request.projectId.length > 0) {
    const { project } = await window.tileborne.projects.get({
      projectId: request.projectId as ProjectId,
    });
    const ref = project.assetPacks[0];
    if (ref !== undefined) {
      return Schema.decodeUnknownSync(PackId)(ref.id);
    }
  }
  const { packs } = await window.tileborne.assets.listPacks({});
  return packs[0]?.id;
};

export const buildRuntimeViewportManifest = (
  packManifest: TilesetPack,
  textureDataUrls: ReadonlyMap<string, string>,
): RuntimeAssetManifest =>
  buildRuntimeManifestFromTilesetPack(packManifest, textureDataUrls);

export const createBlankViewportManifest = (): RuntimeAssetManifest =>
  createRuntimeAssetManifest({
    id: makePackId('00000000-0000-4000-8000-000000000097'),
    name: 'viewport-blank-fallback',
    version: '0.0.0',
    license: {
      spdxId: 'MIT',
    },
    assets: [
      {
        id: makeAssetId('00000000-0000-4000-8000-000000000098'),
        path: BLANK_TEXTURE_DATA_URL,
        mime: 'image/png',
        size: 68,
        hash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000' as ContentHash,
      },
    ],
  });

export const loadViewportAssetManifest = (
  request: ViewportAssetManifestRequest = {},
): Effect.Effect<RuntimeAssetManifest, never> =>
  loadViewportAssetBundle(request).pipe(Effect.map((bundle) => bundle.manifest));

export const loadViewportAssetBundle = (
  request: ViewportAssetManifestRequest = {},
): Effect.Effect<ViewportAssetBundle, never> =>
  Effect.gen(function* () {
    const packId = yield* Effect.tryPromise({
      try: () => resolveViewportPackId(request),
      catch: (cause) => new Error(String(cause)),
    });
    if (packId === undefined) {
      console.info('[tileborne] no asset pack available for viewport; using blank texture fallback');
      return {
        manifest: createBlankViewportManifest(),
        tileIndexByTileId: new Map(),
        tileIdByTileIndex: new Map(),
        collisionMaskByTileIndex: new Map(),
        renderableAssetIdByPath: new Map(),
      };
    }

    const cacheKey = String(packId);
    let cached = viewportAssetBundleCache.get(cacheKey);
    if (cached === undefined) {
      cached = Effect.runPromise(loadViewportAssetBundleForPack(packId)).catch((error: unknown) => {
        viewportAssetBundleCache.delete(cacheKey);
        throw error;
      });
      viewportAssetBundleCache.set(cacheKey, cached);
    }

    return yield* Effect.tryPromise({
      try: () => cached,
      catch: (cause) => new Error(String(cause)),
    });
  }).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        console.info(
          '[tileborne] failed to load viewport asset pack; using blank texture fallback',
          error,
        );
        return {
          manifest: createBlankViewportManifest(),
          tileIndexByTileId: new Map(),
          tileIdByTileIndex: new Map(),
          collisionMaskByTileIndex: new Map(),
          renderableAssetIdByPath: new Map(),
        };
      }),
    ),
  );

const loadViewportAssetBundleForPack = (
  packId: PackId,
): Effect.Effect<ViewportAssetBundle, Error> =>
  Effect.gen(function* () {
    const pack = yield* Effect.tryPromise({
      try: () => loadTilesetPack(packId),
      catch: (cause) => new Error(String(cause)),
    });
    const frameIndex = buildFrameIndex(pack);

    // Fetch paint atlases plus image-collection placeable frames. Do not fetch
    // unrelated preview/sample art from large packs.
    const renderableAssetIds = new Set([
      ...pack.tilesets.map((tileset) => String(tileset.atlasAssetId)),
      ...(pack.placeables ?? []).flatMap((placeable) =>
        placeable.frames.map((frame) => String(frame.assetId)),
      ),
    ]);
    const renderableAssets = pack.assets.filter(
      (asset) => asset.mime.startsWith('image/') && renderableAssetIds.has(String(asset.id)),
    );
    const renderableAssetIdByPath = new Map<string, number>();
    renderableAssets.forEach((asset, index) => {
      renderableAssetIdByPath.set(asset.path, index + 1);
    });

    const textureEntries = yield* Effect.forEach(
      renderableAssets,
      (asset) =>
        Effect.tryPromise({
          try: () =>
            window.tileborne.assets.getAssetDataUrl({
              packId,
              assetPath: asset.path,
            }),
          catch: (cause) => new Error(String(cause)),
        }).pipe(Effect.map(({ dataUrl }) => [asset.path, dataUrl] as const)),
      { concurrency: 8 },
    );
    const textureDataUrls = new Map<string, string>(textureEntries);

    return {
      packId,
      pack,
      frameIndex,
      manifest: buildRuntimeViewportManifest(pack, textureDataUrls),
      tileIndexByTileId: tileIndexByTileId(pack),
      tileIdByTileIndex: tileIdByTileIndex(pack),
      collisionMaskByTileIndex: collisionMaskByTileIndex(pack),
      renderableAssetIdByPath,
    };
  });
