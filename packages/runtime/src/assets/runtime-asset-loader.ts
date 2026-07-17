import type { AssetPackManifest, AssetPackManifestAsset } from '@tileborne/asset-pipeline/pack';
import type { AssetId } from '@tileborne/core';
import { Effect } from 'effect';

import { RendererAssetError, rendererAssetError } from '../renderer/renderer-adapter.js';

export type RuntimeAssetManifest = AssetPackManifest;

export interface LoadedAsset {
  readonly id: AssetId;
  readonly path: string;
  readonly mime: string;
  readonly size: number;
  readonly hash: string;
  readonly bytes: Uint8Array;
}

export type LoadedAssets = ReadonlyMap<AssetId, LoadedAsset>;

export interface RuntimeAssetLoaderOptions {
  readonly capacity?: number;
  readonly basePath?: string;
  readonly baseUrl?: string | URL;
  readonly fetch?: (input: string | URL) => Promise<Response>;
  /** Host-owned local byte reader. The neutral runtime never imports Node filesystem APIs. */
  readonly readFile?: (path: string) => Promise<Uint8Array>;
}

export const DEFAULT_RUNTIME_ASSET_CACHE_CAPACITY = 256;

const isRemoteUrl = (value: string): boolean => /^(https?|data|blob|tileborne-asset):/u.test(value);

const toAssetIdString = (assetId: AssetId): string => assetId;

export class RuntimeAssetLoader {
  private readonly capacity: number;
  private readonly basePath: string | undefined;
  private readonly baseUrl: string | URL | undefined;
  private readonly fetchImpl: (input: string | URL) => Promise<Response>;
  private readonly readFileImpl: ((path: string) => Promise<Uint8Array>) | undefined;
  private readonly cache = new Map<AssetId, LoadedAsset>();

  constructor(options: RuntimeAssetLoaderOptions = {}) {
    this.capacity = options.capacity ?? DEFAULT_RUNTIME_ASSET_CACHE_CAPACITY;
    if (!Number.isInteger(this.capacity) || this.capacity <= 0) {
      throw new RangeError('runtime asset cache capacity must be a positive integer');
    }
    this.basePath = options.basePath;
    this.baseUrl = options.baseUrl;
    this.fetchImpl = options.fetch ?? ((input) => fetch(input));
    this.readFileImpl = options.readFile;
  }

  load(manifest: RuntimeAssetManifest): Effect.Effect<LoadedAssets, RendererAssetError> {
    return Effect.all(manifest.assets.map((asset) => this.loadOne(asset))).pipe(
      Effect.map((entries) => {
        const loaded = new Map<AssetId, LoadedAsset>();
        for (const entry of entries) {
          loaded.set(entry.id, entry);
        }
        return loaded;
      }),
    );
  }

  has(assetId: AssetId): boolean {
    return this.cache.has(assetId);
  }

  cacheSize(): number {
    return this.cache.size;
  }

  private loadOne(asset: AssetPackManifestAsset): Effect.Effect<LoadedAsset, RendererAssetError> {
    const cached = this.cache.get(asset.id);
    if (cached) {
      this.cache.delete(asset.id);
      this.cache.set(asset.id, cached);
      return Effect.succeed(cached);
    }

    return this.readBytes(asset).pipe(
      Effect.map((bytes) => {
        const loaded: LoadedAsset = {
          id: asset.id,
          path: asset.path,
          mime: asset.mime,
          size: asset.size,
          hash: asset.hash,
          bytes,
        };
        this.cache.set(asset.id, loaded);
        this.evictIfNeeded();
        return loaded;
      }),
    );
  }

  private readBytes(asset: AssetPackManifestAsset): Effect.Effect<Uint8Array, RendererAssetError> {
    const location = this.resolveLocation(asset.path);
    if (typeof location !== 'string' || isRemoteUrl(location)) {
      return this.fetchBytes(location, asset.id);
    }
    return this.readFileBytes(location, asset.id);
  }

  private resolveLocation(assetPath: string): string | URL {
    if (isRemoteUrl(assetPath)) {
      return assetPath;
    }
    if (this.baseUrl) {
      return new URL(assetPath, this.baseUrl);
    }
    if (this.basePath) {
      return `${this.basePath.replace(/\/$/u, '')}/${assetPath.replace(/^\//u, '')}`;
    }
    return assetPath;
  }

  private fetchBytes(
    location: string | URL,
    assetId: AssetId,
  ): Effect.Effect<Uint8Array, RendererAssetError> {
    return Effect.tryPromise({
      try: async () => {
        const response = await this.fetchImpl(location);
        if (!response.ok) {
          throw new Error(`fetch failed with ${response.status}`);
        }
        return new Uint8Array(await response.arrayBuffer());
      },
      catch: (cause) =>
        rendererAssetError(
          toAssetIdString(assetId),
          `failed to fetch asset ${toAssetIdString(assetId)}`,
          cause,
        ),
    });
  }

  private readFileBytes(
    path: string,
    assetId: AssetId,
  ): Effect.Effect<Uint8Array, RendererAssetError> {
    return Effect.tryPromise({
      try: async () => {
        if (this.readFileImpl === undefined) {
          throw new Error('local asset loading requires a host-provided readFile implementation');
        }
        return this.readFileImpl(path);
      },
      catch: (cause) =>
        rendererAssetError(
          toAssetIdString(assetId),
          `failed to read asset ${toAssetIdString(assetId)}`,
          cause,
        ),
    });
  }

  private evictIfNeeded(): void {
    while (this.cache.size > this.capacity) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) {
        return;
      }
      this.cache.delete(oldest);
    }
  }
}

export const createRuntimeAssetLoader = (options?: RuntimeAssetLoaderOptions): RuntimeAssetLoader =>
  new RuntimeAssetLoader(options);

export const loadRuntimeAssets = (
  manifest: RuntimeAssetManifest,
  options?: RuntimeAssetLoaderOptions,
): Effect.Effect<LoadedAssets, RendererAssetError> =>
  createRuntimeAssetLoader(options).load(manifest);
