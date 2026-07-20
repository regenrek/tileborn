import {
  hashBytes,
  makeAssetId,
  makePackId,
  PackId,
  PlaceableId,
  ProjectId,
  type AssetId,
  type ContentHash,
  type TileborneMap,
} from '@tileborne/core';
import {
  decodeEditorTilesetIndex,
  type DecodedEditorTilesetIndex,
  type EditorIndexAsset,
  type EditorIndexLicense,
  type EditorTileFrame,
  type EditorTilesetIndexJson,
} from '@tileborne/sdk-tileset/editor-index';
import type {
  AutotileRule,
  CollisionMaskType,
  Placeable,
  TerrainClassType,
  TerrainTransition,
  TileIdType,
} from '@tileborne/sdk-tileset/schemas';
import { createRuntimeAssetManifest, type RuntimeAssetManifest } from '@tileborne/runtime';
import { assetProtocolUrl } from '@/lib/asset-url';
import type { EditorViewportTileAtlas } from '@/editor/viewport/editor-viewport-controller';
import { Effect, Option, Schema } from 'effect';

/** 1×1 transparent PNG used when no pack is available for the viewport. */
const BLANK_TEXTURE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export interface ViewportAssetManifestRequest {
  readonly projectId?: string;
  readonly packId?: PackId;
  readonly extraPackIds?: readonly PackId[];
  readonly renderablePlaceableRefs?: readonly ViewportPlaceableRef[];
  readonly map?: TileborneMap;
}

export interface ViewportPlaceableRef {
  readonly packId?: PackId | undefined;
  readonly placeableId: PlaceableId;
}

export interface ViewportPlaceableEntry {
  readonly packId: PackId;
  readonly placeable: Placeable;
}

export interface ViewportAssetBundle {
  readonly packId?: PackId;
  readonly hasPack: boolean;
  readonly manifest: RuntimeAssetManifest;
  // Primary-pack derived lookups (match the previous `tileset-pack.ts` path).
  readonly tileIndexByTileId: ReadonlyMap<TileIdType, number>;
  readonly tileFramesByIndex: ReadonlyMap<number, EditorTileFrame>;
  readonly collisionMaskByTileIndex: ReadonlyMap<number, CollisionMaskType>;
  readonly terrainFirstTileId: ReadonlyMap<TerrainClassType, TileIdType>;
  readonly directTileIndexByTerrainClass: ReadonlyMap<TerrainClassType, number>;
  readonly autotileRules: readonly AutotileRule[];
  readonly terrainTransitions: readonly TerrainTransition[];
  // Aggregated across the loaded packs.
  readonly renderableAssetIdByPath: ReadonlyMap<string, AssetId>;
  readonly placeables: readonly ViewportPlaceableEntry[];
  readonly assetPathByPackAndId: ReadonlyMap<string, string>;
  readonly assetPathById: ReadonlyMap<string, string>;
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

const emptyViewportAssetBundle = (): ViewportAssetBundle => ({
  hasPack: false,
  manifest: createBlankViewportManifest(),
  tileIndexByTileId: new Map(),
  tileFramesByIndex: new Map(),
  collisionMaskByTileIndex: new Map(),
  terrainFirstTileId: new Map(),
  directTileIndexByTerrainClass: new Map(),
  autotileRules: [],
  terrainTransitions: [],
  renderableAssetIdByPath: new Map(),
  placeables: [],
  assetPathByPackAndId: new Map(),
  assetPathById: new Map(),
});

export const loadViewportAssetManifest = (
  request: ViewportAssetManifestRequest = {},
): Effect.Effect<RuntimeAssetManifest, never> =>
  loadViewportAssetBundle(request).pipe(Effect.map((bundle) => bundle.manifest));

/**
 * Projects a loaded viewport bundle into the tile-atlas options consumed by
 * {@link EditorViewportTileAtlas}. Both the editor and the playtest viewports
 * need the same per-pack lookups (tile frames, renderable ids, placeables,
 * autotile rules) so the controller can resolve real atlas textures instead of
 * falling back to the missing-texture diagnostic tiles.
 */
export const viewportControllerAtlas = (bundle: ViewportAssetBundle): EditorViewportTileAtlas => ({
  tileFramesByIndex: bundle.tileFramesByIndex,
  collisionMaskByTileIndex: bundle.collisionMaskByTileIndex,
  renderableAssetIdByPath: bundle.renderableAssetIdByPath,
  placeables: bundle.placeables,
  assetPathByPackAndId: bundle.assetPathByPackAndId,
  assetPathById: bundle.assetPathById,
  autotileRules: bundle.autotileRules,
  terrainTransitions: bundle.terrainTransitions,
});

export const loadViewportAssetBundle = (
  request: ViewportAssetManifestRequest = {},
): Effect.Effect<ViewportAssetBundle, never> =>
  Effect.gen(function* () {
    const packId = yield* Effect.tryPromise({
      try: () => resolveViewportPackId(request),
      catch: (cause) => new Error(String(cause)),
    });
    if (packId === undefined) {
      console.info(
        '[tileborne] no asset pack available for viewport; using blank texture fallback',
      );
      return emptyViewportAssetBundle();
    }

    const renderablePlaceableRefs = resolveRenderablePlaceableRefs(request);
    // Object placeables can reference a pack that is neither the map's tileset
    // pack nor part of the working palette (`extraPackIds`). Those packs must
    // still be loaded so existing map objects resolve their placeable frames and
    // atlas textures on map open instead of rendering blank. Primary pack stays
    // first to keep `renderableAssetIdByPath` indices stable.
    const packIds: PackId[] = [packId];
    const seenPackIds = new Set<string>([String(packId)]);
    for (const candidate of [
      ...(request.extraPackIds ?? []),
      ...renderablePlaceableRefs.flatMap((ref) => (ref.packId === undefined ? [] : [ref.packId])),
    ]) {
      const key = String(candidate);
      if (!seenPackIds.has(key)) {
        seenPackIds.add(key);
        packIds.push(candidate);
      }
    }
    // Catalog visual-refs identify globally unique placeables without coupling
    // the catalog to an asset-pack id. Search installed pack indexes only when
    // such an unscoped ref is actually needed; selected frame assets remain
    // bounded to the matched placeables below.
    if (renderablePlaceableRefs.some((ref) => ref.packId === undefined)) {
      const installed = yield* Effect.tryPromise({
        try: () => window.tileborne.assets.listPacks({}),
        catch: (cause) => new Error(String(cause)),
      });
      for (const candidate of installed.packs.map((entry) => entry.id)) {
        const key = String(candidate);
        if (!seenPackIds.has(key)) {
          seenPackIds.add(key);
          packIds.push(candidate);
        }
      }
    }
    const cacheKey = [
      packIds.map(String).join('|'),
      renderablePlaceableRefs
        .map((ref) => `${ref.packId ?? packId}:${ref.placeableId}`)
        .sort()
        .join('|'),
    ].join('::');
    let cached = viewportAssetBundleCache.get(cacheKey);
    if (cached === undefined) {
      cached = Effect.runPromise(
        loadViewportAssetBundleForPacks(packIds, renderablePlaceableRefs),
      ).catch((error: unknown) => {
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
        return emptyViewportAssetBundle();
      }),
    ),
  );

const loadEditorIndexForPack = async (
  packId: PackId,
): Promise<DecodedEditorTilesetIndex | undefined> => {
  try {
    const { indexJson } = await window.tileborne.assetLibrary.getEditorIndex({ packId });
    const json = JSON.parse(indexJson) as EditorTilesetIndexJson;
    return decodeEditorTilesetIndex(json);
  } catch (error) {
    console.info('[tileborne] skipped unavailable viewport asset pack', { packId, error });
    return undefined;
  }
};

const resolveRenderablePlaceableRefs = (
  request: ViewportAssetManifestRequest,
): readonly ViewportPlaceableRef[] => {
  const refs = new Map<string, ViewportPlaceableRef>();
  const add = (ref: ViewportPlaceableRef) => {
    refs.set(`${ref.packId ?? '*'}:${ref.placeableId}`, ref);
  };

  for (const ref of request.renderablePlaceableRefs ?? []) {
    add(ref);
  }
  for (const object of request.map?.objects ?? []) {
    if (object.kind !== 'placeable' || object.placement === undefined) {
      continue;
    }
    add({
      packId: Option.getOrUndefined(object.placement.packId),
      placeableId: object.placement.placeableId,
    });
  }
  return [...refs.values()];
};

const licenseToInput = (license: EditorIndexLicense) => ({
  spdxId: license.spdxId,
  attribution: license.attribution === undefined ? Option.none() : Option.some(license.attribution),
  sourceUrl: license.sourceUrl === undefined ? Option.none() : Option.some(license.sourceUrl),
  ...(license.sourcePath === undefined ? {} : { sourcePath: license.sourcePath }),
  ...(license.modifications === undefined ? {} : { modifications: license.modifications }),
  notes: license.notes === undefined ? Option.none() : Option.some(license.notes),
  redistributable: license.redistributable,
});

const hashForUrl = (url: string): ContentHash => hashBytes(new TextEncoder().encode(url));

const loadViewportAssetBundleForPacks = (
  packIds: readonly PackId[],
  renderablePlaceableRefs: readonly ViewportPlaceableRef[],
): Effect.Effect<ViewportAssetBundle, Error> =>
  Effect.gen(function* () {
    if (packIds.length === 0) {
      return emptyViewportAssetBundle();
    }

    const loaded = yield* Effect.forEach(
      packIds,
      (packId) =>
        Effect.tryPromise({
          try: () => loadEditorIndexForPack(packId),
          catch: (cause) => new Error(String(cause)),
        }),
      { concurrency: 4 },
    );
    const indexes = loaded.filter(
      (entry): entry is DecodedEditorTilesetIndex => entry !== undefined,
    );
    const primary = indexes[0];
    if (primary === undefined) {
      return emptyViewportAssetBundle();
    }

    // Renderable atlas + selected placeable-frame paths, in pack order. The
    // controller resolves by original asset path, then asks the Pixi adapter for
    // the manifest asset id that `loadAssets` registers as a loaded texture key.
    const renderableAssets: { readonly packId: PackId; readonly asset: EditorIndexAsset }[] = [];
    for (const index of indexes) {
      const selectedPlaceableIds = new Set(
        renderablePlaceableRefs
          .filter((ref) => ref.packId === undefined || ref.packId === index.packId)
          .map((ref) => String(ref.placeableId)),
      );
      const assetPathById = new Map(index.assets.map((asset) => [asset.id, asset.path]));
      const renderablePaths = new Set<string>(index.atlasAssetPaths);
      for (const placeable of index.placeables) {
        if (!selectedPlaceableIds.has(String(placeable.id))) {
          continue;
        }
        // Load every default-frame AND named-clip frame so ticker-driven
        // animation can swap among all clip frames without a missing texture.
        const clipFrames = (placeable.clips ?? []).flatMap((clip) => clip.frames);
        for (const frame of [...placeable.frames, ...clipFrames]) {
          const framePath = assetPathById.get(String(frame.assetId));
          if (framePath !== undefined) {
            renderablePaths.add(framePath);
          }
        }
      }
      for (const asset of index.assets) {
        if (asset.mime.startsWith('image/') && renderablePaths.has(asset.path)) {
          renderableAssets.push({ packId: index.packId, asset });
        }
      }
    }

    const renderableAssetIdByPath = new Map<string, AssetId>();
    renderableAssets.forEach(({ asset }) => {
      renderableAssetIdByPath.set(asset.path, asset.id as AssetId);
    });

    // Atlases stream via the `tileborne-asset` protocol and are decoded off the
    // main thread by the runtime asset loader (no base64 round-trip over IPC).
    const manifest = createRuntimeAssetManifest({
      id: primary.packId,
      name: primary.packMeta.name,
      version: primary.packMeta.version,
      license: licenseToInput(primary.packMeta.license),
      assets: renderableAssets.map(({ packId, asset }) => {
        const url = assetProtocolUrl(String(packId), asset.path);
        return {
          id: asset.id as AssetId,
          path: url,
          mime: asset.mime,
          size: url.length,
          hash: hashForUrl(url),
          license: Option.none(),
        };
      }),
    });

    const placeables: ViewportPlaceableEntry[] = indexes.flatMap((index) =>
      index.placeables.map((placeable) => ({ packId: index.packId, placeable })),
    );
    const assetPathByPackAndId = new Map<string, string>();
    const assetPathById = new Map<string, string>();
    for (const index of indexes) {
      for (const asset of index.assets) {
        assetPathByPackAndId.set(`${index.packId}:${asset.id}`, asset.path);
        assetPathById.set(asset.id, asset.path);
      }
    }

    return {
      packId: primary.packId,
      hasPack: true,
      manifest,
      tileIndexByTileId: primary.tileIndexByTileId,
      tileFramesByIndex: primary.tileFramesByIndex,
      collisionMaskByTileIndex: primary.collisionMaskByTileIndex,
      terrainFirstTileId: primary.terrainFirstTileId,
      directTileIndexByTerrainClass: primary.directTileIndexByTerrainClass,
      autotileRules: primary.autotileRules,
      terrainTransitions: primary.terrainTransitions,
      renderableAssetIdByPath,
      placeables,
      assetPathByPackAndId,
      assetPathById,
    } satisfies ViewportAssetBundle;
  });
