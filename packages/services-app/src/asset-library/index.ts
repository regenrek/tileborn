import { randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  AssetLibraryCacheStatus,
  type AssetLibraryCacheState,
  AssetLibraryGroup,
  AssetLibraryGroupKind,
  AssetLibraryIndex,
  AssetLibraryReference,
  ContentHash,
  PackId,
  ProjectId,
  Uuid,
  WorkingPalette,
  WorkingPaletteId,
  WorkingPaletteItem,
  WorkingPaletteItemId,
  WorkingPaletteStore,
  hashBytes,
  makeWorkingPaletteId,
  makeWorkingPaletteItemId,
  type TileId,
} from '@tileborne/core';
import { parseTilesetManifest, writeTilesetManifest } from '@tileborne/sdk-tileset/manifest';
import type { AutotileRule, TilesetPack } from '@tileborne/sdk-tileset/schemas';
import type { TiledAppliedImportPlan, TiledImportRecommendation } from '@tileborne/sdk-tileset/tiled';
import { ConfigService, HomeService, writeJsonAtomic } from '@tileborne/services-foundation';
import { Context, Effect, Layer, Option, Schema } from 'effect';

import {
  AssetService,
  DirectoryAssetPackSource,
  packManifestContentHash,
  type AssetServiceError,
} from '../asset/index.js';
import { errorMessage, isNotFound } from '../internal/files.js';
import { packDirectory, projectManifestPath } from '../internal/layout.js';
import {
  ProjectMigrationError,
  ProjectNotFoundError,
  ProjectValidationError,
  readVerifiedProjectAtRoot,
  resolveProjectRootForId,
} from '../project/index.js';
import { readProjectRegistry } from '../internal/project-registry.js';

const MANIFEST_FILENAME = 'tileborne-asset-pack.json';
const WORKING_PALETTES_FILE = '.tileborne/working-palettes.json';
const DEFAULT_GROUP_LIMIT = 100;
const MAX_GROUP_LIMIT = 200;
const PREVIEW_REF_LIMIT = 8;
const DEFAULT_PALETTE_ITEM_LIMIT = 24;
export const ASSET_LIBRARY_INDEX_SCHEMA_VERSION = 1;
const ASSET_LIBRARY_MEMORY_CACHE_LIMIT = 6;
const ASSET_LIBRARY_CACHE_DIR = 'asset-library/index-metadata';

const AssetLibraryIndexCacheFile = Schema.Struct({
  schemaVersion: Schema.Literal(ASSET_LIBRARY_INDEX_SCHEMA_VERSION),
  packId: PackId,
  integrityHash: ContentHash,
  updatedAt: Schema.String,
  previewRefCount: Schema.Number,
  index: AssetLibraryIndex,
});
type AssetLibraryIndexCacheFile = Schema.Schema.Type<typeof AssetLibraryIndexCacheFile>;

interface CachedLibraryIndex {
  readonly key: string;
  readonly packId: PackId;
  readonly integrityHash: ContentHash;
  readonly updatedAt: string;
  readonly previewRefCount: number;
  readonly index: AssetLibraryIndex;
}

export interface GetPackLibraryInput {
  readonly packId: PackId;
  readonly query?: string | undefined;
  readonly groupKind?: AssetLibraryGroupKind | undefined;
  readonly offset?: number | undefined;
  readonly limit?: number | undefined;
}

export interface GetPackLibraryResult {
  readonly packId: PackId;
  readonly integrityHash: ContentHash;
  readonly indexSchemaVersion: number;
  readonly previewRefLimit: number;
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly groups: readonly AssetLibraryGroup[];
}

export interface PackLibraryCacheInput {
  readonly packId: PackId;
}

export interface InvalidatePackCacheResult {
  readonly packId: PackId;
  readonly removedEntries: number;
}

export interface WorkingPaletteItemDraft {
  readonly ref: AssetLibraryReference;
  readonly label?: string | undefined;
}

export interface PaletteProjectInput {
  readonly projectId?: ProjectId | undefined;
}

export interface WorkingPaletteListResult {
  readonly palettes: readonly WorkingPalette[];
  readonly activePaletteId?: WorkingPaletteId | undefined;
}

export interface PruneWorkingPalettePackReferencesInput {
  readonly packId: PackId;
}

export interface PruneWorkingPalettePackReferencesResult {
  readonly packId: PackId;
  readonly affectedProjectIds: readonly ProjectId[];
  readonly affectedPaletteIds: readonly WorkingPaletteId[];
  readonly removedItemCount: number;
}

export class AssetLibraryError extends Schema.TaggedErrorClass<AssetLibraryError>()(
  'AssetLibraryError',
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

export type AssetLibraryServiceError =
  | AssetLibraryError
  | AssetServiceError
  | ProjectMigrationError
  | ProjectNotFoundError
  | ProjectValidationError;

export interface MaterializeTiledImportInput {
  readonly plan: TiledAppliedImportPlan;
  readonly pack: TilesetPack;
  readonly sourceRoot: string;
}

export interface MaterializeTiledImportResult {
  readonly packId: PackId;
  readonly stagingPath: string;
}

export class AssetLibraryService extends Context.Service<
  AssetLibraryService,
  {
    readonly getPackLibrary: (
      input: GetPackLibraryInput,
    ) => Effect.Effect<GetPackLibraryResult, AssetLibraryServiceError>;
    readonly getPackCacheStatus: (
      input: PackLibraryCacheInput,
    ) => Effect.Effect<AssetLibraryCacheStatus, AssetLibraryServiceError>;
    readonly reloadPackCache: (
      input: PackLibraryCacheInput,
    ) => Effect.Effect<AssetLibraryCacheStatus, AssetLibraryServiceError>;
    readonly invalidatePackCache: (
      input: PackLibraryCacheInput,
    ) => Effect.Effect<InvalidatePackCacheResult, AssetLibraryServiceError>;
  }
>()('@tileborne/services-app/AssetLibraryService') {}

export class WorkingPaletteService extends Context.Service<
  WorkingPaletteService,
  {
    readonly list: (
      input: PaletteProjectInput,
    ) => Effect.Effect<WorkingPaletteListResult, AssetLibraryServiceError>;
    readonly getActive: (
      input: PaletteProjectInput,
    ) => Effect.Effect<WorkingPalette | undefined, AssetLibraryServiceError>;
    readonly create: (
      input: PaletteProjectInput & {
        readonly name: string;
        readonly items?: readonly WorkingPaletteItemDraft[] | undefined;
      },
    ) => Effect.Effect<WorkingPalette, AssetLibraryServiceError>;
    readonly update: (
      input: PaletteProjectInput & {
        readonly paletteId: WorkingPaletteId;
        readonly name?: string | undefined;
        readonly items?: readonly WorkingPaletteItemDraft[] | undefined;
      },
    ) => Effect.Effect<WorkingPalette, AssetLibraryServiceError>;
    readonly delete: (
      input: PaletteProjectInput & { readonly paletteId: WorkingPaletteId },
    ) => Effect.Effect<void, AssetLibraryServiceError>;
    readonly setActive: (
      input: PaletteProjectInput & { readonly paletteId: WorkingPaletteId },
    ) => Effect.Effect<WorkingPalette, AssetLibraryServiceError>;
    readonly addItems: (
      input: PaletteProjectInput & {
        readonly paletteId: WorkingPaletteId;
        readonly items: readonly WorkingPaletteItemDraft[];
        readonly atIndex?: number | undefined;
      },
    ) => Effect.Effect<WorkingPalette, AssetLibraryServiceError>;
    readonly removeItem: (
      input: PaletteProjectInput & {
        readonly paletteId: WorkingPaletteId;
        readonly itemId: WorkingPaletteItemId;
      },
    ) => Effect.Effect<WorkingPalette, AssetLibraryServiceError>;
    readonly reorderItems: (
      input: PaletteProjectInput & {
        readonly paletteId: WorkingPaletteId;
        readonly itemIds: readonly WorkingPaletteItemId[];
      },
    ) => Effect.Effect<WorkingPalette, AssetLibraryServiceError>;
    readonly prunePackReferences: (
      input: PruneWorkingPalettePackReferencesInput,
    ) => Effect.Effect<PruneWorkingPalettePackReferencesResult, AssetLibraryServiceError>;
  }
>()('@tileborne/services-app/WorkingPaletteService') {}

interface PaletteProjectResolution {
  readonly projectId: ProjectId;
  readonly projectRoot: string;
}

const newPaletteId = (): WorkingPaletteId => makeWorkingPaletteId(randomUUID() as Uuid);
const newPaletteItemId = (): WorkingPaletteItemId => makeWorkingPaletteItemId(randomUUID() as Uuid);

const normalizeSearch = (value: string | undefined): string => value?.trim().toLowerCase() ?? '';

const clampLimit = (limit: number | undefined): number => {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_GROUP_LIMIT;
  }
  return Math.max(1, Math.min(MAX_GROUP_LIMIT, Math.trunc(limit)));
};

const normalizeOffset = (offset: number | undefined): number =>
  offset === undefined || !Number.isFinite(offset) ? 0 : Math.max(0, Math.trunc(offset));

const humanizeIdentifier = (value: string): string => {
  const raw = value.includes(':') ? value.slice(value.lastIndexOf(':') + 1) : value;
  const words = raw
    .replace(/[_./-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (words.length === 0) {
    return value;
  }
  return words.map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`).join(' ');
};

const metadataRecord = (
  entries: ReadonlyArray<readonly [string, string | number | boolean | undefined]>,
): Readonly<Record<string, string>> =>
  Object.fromEntries(
    entries.flatMap(([key, value]) => (value === undefined ? [] : [[key, String(value)]])),
  );

const searchText = (
  label: string,
  kind: AssetLibraryGroupKind,
  id: string,
  metadata: Readonly<Record<string, string>>,
): string => [label, kind, id, ...Object.values(metadata)].join(' ').toLowerCase();

const thumbnailCacheKey = (input: {
  readonly packId: PackId;
  readonly integrityHash: ContentHash;
  readonly kind: AssetLibraryReference['kind'];
  readonly refId: string;
  readonly tileId?: TileId | undefined;
}): string =>
  [
    'asset-library-thumbnail',
    ASSET_LIBRARY_INDEX_SCHEMA_VERSION,
    input.integrityHash,
    input.packId,
    input.kind,
    input.refId,
    input.tileId ?? '',
  ].join(':');

const tileRef = (
  packId: PackId,
  tileId: TileId,
  integrityHash: ContentHash,
): AssetLibraryReference =>
  new AssetLibraryReference({
    packId,
    kind: 'tile',
    refId: tileId,
    tileId,
    thumbnailCacheKey: thumbnailCacheKey({
      packId,
      integrityHash,
      kind: 'tile',
      refId: tileId,
      tileId,
    }),
  });

const previewTileRefs = (
  packId: PackId,
  integrityHash: ContentHash,
  tileIds: Iterable<TileId>,
): readonly AssetLibraryReference[] => {
  const refs: AssetLibraryReference[] = [];
  const seen = new Set<string>();
  for (const tileId of tileIds) {
    if (seen.has(tileId)) {
      continue;
    }
    seen.add(tileId);
    refs.push(tileRef(packId, tileId, integrityHash));
    if (refs.length >= PREVIEW_REF_LIMIT) {
      break;
    }
  }
  return refs;
};

const makeGroup = (input: {
  readonly id: string;
  readonly packId: PackId;
  readonly kind: AssetLibraryGroupKind;
  readonly label: string;
  readonly count: number;
  readonly metadata: Readonly<Record<string, string>>;
  readonly primaryRef?: AssetLibraryReference | undefined;
  readonly previewRefs: readonly AssetLibraryReference[];
}): AssetLibraryGroup =>
  new AssetLibraryGroup({
    id: input.id,
    packId: input.packId,
    kind: input.kind,
    label: input.label,
    count: input.count,
    metadata: input.metadata,
    searchText: searchText(input.label, input.kind, input.id, input.metadata),
    ...(input.primaryRef === undefined ? {} : { primaryRef: input.primaryRef }),
    previewRefs: [...input.previewRefs],
  });

const autotileTileIds = (rule: AutotileRule): readonly TileId[] => {
  const ids: TileId[] = [];
  for (const values of Object.values(rule.maskToTileIds)) {
    ids.push(...values);
  }
  Option.match(rule.fallbackTileId, {
    onNone: () => undefined,
    onSome: (tileId) => ids.push(tileId),
  });
  return ids;
};

const buildLibraryGroups = (
  pack: TilesetPack,
  integrityHash: ContentHash,
): readonly AssetLibraryGroup[] => {
  const groups: AssetLibraryGroup[] = [];
  const packId = pack.id;
  const terrainTiles = new Map<string, TileId[]>();
  const tilesById = new Map<string, TileId>();

  for (const tileset of pack.tilesets) {
    for (const tile of tileset.tiles) {
      tilesById.set(tile.id, tile.id);
      Option.match(tile.terrainClass, {
        onNone: () => undefined,
        onSome: (terrainClass) => {
          const bucket = terrainTiles.get(terrainClass) ?? [];
          bucket.push(tile.id);
          terrainTiles.set(terrainClass, bucket);
        },
      });
    }
  }

  for (const tileset of pack.tilesets) {
    if (tileset.tiles.length === 0) {
      continue;
    }
    const metadata = metadataRecord([
      ['tilesetId', tileset.id],
      ['atlasAssetId', tileset.atlasAssetId],
      ['cellSize', `${tileset.cellSize.width}x${tileset.cellSize.height}`],
    ]);
    groups.push(
      makeGroup({
        id: `tileset:${tileset.id}`,
        packId,
        kind: 'tileset',
        label: tileset.name,
        count: tileset.tiles.length,
        metadata,
        previewRefs: previewTileRefs(
          packId,
          integrityHash,
          tileset.tiles.map((tile) => tile.id),
        ),
      }),
    );

    for (const rule of tileset.autotileRules) {
      const tileIds = autotileTileIds(rule)
        .map((tileId) => tilesById.get(tileId))
        .filter((tileId): tileId is TileId => tileId !== undefined);
      const primaryRef = new AssetLibraryReference({
        packId,
        kind: 'autotile',
        refId: rule.id,
        thumbnailCacheKey: thumbnailCacheKey({
          packId,
          integrityHash,
          kind: 'autotile',
          refId: rule.id,
        }),
      });
      const metadata = metadataRecord([
        ['ruleId', rule.id],
        ['pattern', rule._tag],
        ['tileset', tileset.name],
        ['terrainClasses', rule.terrainClasses.join(', ')],
      ]);
      groups.push(
        makeGroup({
          id: `autotile:${rule.id}`,
          packId,
          kind: 'autotile',
          label: rule.name,
          count: new Set(tileIds).size,
          metadata,
          primaryRef,
          previewRefs: previewTileRefs(packId, integrityHash, tileIds),
        }),
      );
    }
  }

  for (const [terrainClass, tileIds] of [...terrainTiles.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const primaryRef = new AssetLibraryReference({
      packId,
      kind: 'terrain',
      refId: terrainClass,
      thumbnailCacheKey: thumbnailCacheKey({
        packId,
        integrityHash,
        kind: 'terrain',
        refId: terrainClass,
      }),
    });
    const metadata = metadataRecord([['terrainClass', terrainClass]]);
    groups.push(
      makeGroup({
        id: `terrain:${terrainClass}`,
        packId,
        kind: 'terrain',
        label: humanizeIdentifier(terrainClass),
        count: tileIds.length,
        metadata,
        primaryRef,
        previewRefs: previewTileRefs(packId, integrityHash, tileIds),
      }),
    );
  }

  const placeables = pack.placeables ?? [];
  for (const placeable of placeables) {
    const frame = placeable.frames[0];
    const objectClass = Option.getOrUndefined(placeable.source.objectClass);
    const objectType = Option.getOrUndefined(placeable.source.objectType);
    const primaryRef = new AssetLibraryReference({
      packId,
      kind: 'placeable',
      refId: placeable.id,
      tileId: frame.tileId,
      thumbnailCacheKey: thumbnailCacheKey({
        packId,
        integrityHash,
        kind: 'placeable',
        refId: placeable.id,
        tileId: frame.tileId,
      }),
    });
    const metadata = metadataRecord([
      ['placeableId', placeable.id],
      ['tilesetName', placeable.source.tilesetName],
      ['objectClass', objectClass],
      ['objectType', objectType],
      ['tags', placeable.tags.join(', ')],
      ['placementMode', placeable.placementMode],
    ]);
    groups.push(
      makeGroup({
        id: `placeable:${placeable.id}`,
        packId,
        kind: 'placeable',
        label: placeable.name,
        count: 1,
        metadata,
        primaryRef,
        previewRefs: [primaryRef],
      }),
    );
  }

  const placeablesBySource = new Map<string, typeof placeables>();
  for (const placeable of placeables) {
    const source = placeable.source.tilesetName;
    placeablesBySource.set(source, [...(placeablesBySource.get(source) ?? []), placeable]);
  }
  for (const [source, entries] of [...placeablesBySource.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const metadata = metadataRecord([['source', source]]);
    groups.push(
      makeGroup({
        id: `source:${source}`,
        packId,
        kind: 'source',
        label: humanizeIdentifier(source),
        count: entries.length,
        metadata,
        previewRefs: entries.slice(0, PREVIEW_REF_LIMIT).map(
          (placeable) =>
            new AssetLibraryReference({
              packId,
              kind: 'placeable',
              refId: placeable.id,
              tileId: placeable.frames[0].tileId,
              thumbnailCacheKey: thumbnailCacheKey({
                packId,
                integrityHash,
                kind: 'placeable',
                refId: placeable.id,
                tileId: placeable.frames[0].tileId,
              }),
            }),
        ),
      }),
    );
  }

  return groups;
};

const readTilesetPack = (manifestPath: string): Effect.Effect<TilesetPack, AssetLibraryError> =>
  Effect.gen(function* () {
    const raw = yield* Effect.tryPromise({
      try: () => readFile(manifestPath, 'utf8'),
      catch: (cause) => new AssetLibraryError({ path: manifestPath, message: errorMessage(cause) }),
    });
    const json = yield* Effect.try({
      try: (): unknown => JSON.parse(raw),
      catch: (cause) => new AssetLibraryError({ path: manifestPath, message: errorMessage(cause) }),
    });
    const parsed = parseTilesetManifest(json);
    if (parsed.value === undefined) {
      const message =
        parsed.diagnostics[0]?.message ?? 'Pack does not expose Tileborne tileset metadata.';
      yield* new AssetLibraryError({ path: manifestPath, message });
    }
    return parsed.value as TilesetPack;
  });

const libraryIndexForPack = (
  packId: PackId,
  packRoot: string,
  integrityHash: ContentHash,
): Effect.Effect<AssetLibraryIndex, AssetLibraryError> =>
  Effect.gen(function* () {
    const pack = yield* readTilesetPack(path.join(packRoot, MANIFEST_FILENAME));
    const groups = buildLibraryGroups(pack, integrityHash);
    return new AssetLibraryIndex({
      packId,
      totalGroups: groups.length,
      groups: [...groups],
    });
  });

const cacheKeyForPack = (packId: PackId, integrityHash: ContentHash): string =>
  `${ASSET_LIBRARY_INDEX_SCHEMA_VERSION}:${packId}:${integrityHash}`;

const safeCacheSegment = (value: string): string => value.replace(/[^a-zA-Z0-9.-]/g, '_');

const cacheDirectory = (cacheRoot: string): string => path.join(cacheRoot, ASSET_LIBRARY_CACHE_DIR);

const cacheFilePath = (cacheRoot: string, packId: PackId, integrityHash: ContentHash): string =>
  path.join(
    cacheDirectory(cacheRoot),
    `v${ASSET_LIBRARY_INDEX_SCHEMA_VERSION}-${safeCacheSegment(packId)}-${safeCacheSegment(
      integrityHash,
    )}.json`,
  );

const cacheFilePrefix = (packId: PackId): string =>
  `v${ASSET_LIBRARY_INDEX_SCHEMA_VERSION}-${safeCacheSegment(packId)}-`;

const previewRefCount = (index: AssetLibraryIndex): number =>
  index.groups.reduce((count, group) => count + group.previewRefs.length, 0);

const statusFromCachedIndex = (
  cached: CachedLibraryIndex,
  state: AssetLibraryCacheState = 'cached',
): AssetLibraryCacheStatus =>
  new AssetLibraryCacheStatus({
    packId: cached.packId,
    integrityHash: cached.integrityHash,
    indexSchemaVersion: ASSET_LIBRARY_INDEX_SCHEMA_VERSION,
    state,
    cacheKind: 'index-metadata',
    groupCount: cached.index.totalGroups,
    previewRefCount: cached.previewRefCount,
    thumbnailSheetCount: 0,
    thumbnailSheetsAvailable: false,
    updatedAt: cached.updatedAt,
  });

const emptyCacheStatus = (
  packId: PackId,
  state: AssetLibraryCacheState,
  input: {
    readonly integrityHash?: ContentHash | undefined;
    readonly errorMessage?: string | undefined;
  } = {},
): AssetLibraryCacheStatus =>
  new AssetLibraryCacheStatus({
    packId,
    ...(input.integrityHash === undefined ? {} : { integrityHash: input.integrityHash }),
    indexSchemaVersion: ASSET_LIBRARY_INDEX_SCHEMA_VERSION,
    state,
    cacheKind: 'index-metadata',
    groupCount: 0,
    previewRefCount: 0,
    thumbnailSheetCount: 0,
    thumbnailSheetsAvailable: false,
    ...(input.errorMessage === undefined ? {} : { errorMessage: input.errorMessage }),
  });

const readDiskCache = (
  filePath: string,
  key: string,
): Effect.Effect<CachedLibraryIndex | undefined, AssetLibraryError> =>
  Effect.gen(function* () {
    const raw = yield* Effect.tryPromise({
      try: async () => {
        try {
          return await readFile(filePath, 'utf8');
        } catch (cause) {
          if (isNotFound(cause)) {
            return undefined;
          }
          throw cause;
        }
      },
      catch: (cause) => new AssetLibraryError({ path: filePath, message: errorMessage(cause) }),
    });
    if (raw === undefined) {
      return undefined;
    }
    const parsed = yield* Effect.sync((): unknown | undefined => {
      try {
        return JSON.parse(raw);
      } catch {
        return undefined;
      }
    });
    if (parsed === undefined) {
      return undefined;
    }
    return yield* Effect.try({
      try: () => {
        try {
          const decoded = Schema.decodeUnknownSync(AssetLibraryIndexCacheFile)(
            parsed,
          ) as AssetLibraryIndexCacheFile;
          return {
            key,
            packId: decoded.packId,
            integrityHash: decoded.integrityHash,
            updatedAt: decoded.updatedAt,
            previewRefCount: decoded.previewRefCount,
            index: decoded.index,
          };
        } catch {
          return undefined;
        }
      },
      catch: (cause) => new AssetLibraryError({ path: filePath, message: errorMessage(cause) }),
    });
  });

const writeDiskCache = (
  filePath: string,
  cached: CachedLibraryIndex,
): Effect.Effect<void, AssetLibraryError> =>
  Effect.gen(function* () {
    const payload: AssetLibraryIndexCacheFile = {
      schemaVersion: ASSET_LIBRARY_INDEX_SCHEMA_VERSION,
      packId: cached.packId,
      integrityHash: cached.integrityHash,
      updatedAt: cached.updatedAt,
      previewRefCount: cached.previewRefCount,
      index: cached.index,
    };
    const encoded = yield* Effect.try({
      try: () => Schema.encodeSync(AssetLibraryIndexCacheFile)(payload),
      catch: (cause) => new AssetLibraryError({ path: filePath, message: errorMessage(cause) }),
    });
    yield* Effect.tryPromise({
      try: () => mkdir(path.dirname(filePath), { recursive: true }),
      catch: (cause) => new AssetLibraryError({ path: filePath, message: errorMessage(cause) }),
    });
    yield* writeJsonAtomic(filePath, encoded).pipe(
      Effect.mapError(
        (error) => new AssetLibraryError({ path: error.path, message: error.message }),
      ),
    );
  });

const hasStaleDiskCache = (
  cacheRoot: string,
  packId: PackId,
  currentIntegrityHash: ContentHash,
): Effect.Effect<boolean, AssetLibraryError> =>
  Effect.gen(function* () {
    const dir = cacheDirectory(cacheRoot);
    const entries = yield* Effect.tryPromise({
      try: async () => {
        try {
          return await readdir(dir);
        } catch (cause) {
          if (isNotFound(cause)) {
            return [];
          }
          throw cause;
        }
      },
      catch: (cause) => new AssetLibraryError({ path: dir, message: errorMessage(cause) }),
    });
    const currentFile = path.basename(cacheFilePath(cacheRoot, packId, currentIntegrityHash));
    const prefix = cacheFilePrefix(packId);
    return entries.some((entry) => entry.startsWith(prefix) && entry !== currentFile);
  });

const filterLibraryGroups = (
  groups: readonly AssetLibraryGroup[],
  input: Pick<GetPackLibraryInput, 'query' | 'groupKind'>,
): readonly AssetLibraryGroup[] => {
  const query = normalizeSearch(input.query);
  return groups.filter((group) => {
    if (input.groupKind !== undefined && group.kind !== input.groupKind) {
      return false;
    }
    return query.length === 0 || group.searchText.includes(query);
  });
};

const paletteStorePath = (projectRoot: string): string =>
  path.join(projectRoot, WORKING_PALETTES_FILE);

const resolveProjectIdFromConfig = (
  projectId: ProjectId | undefined,
  lastOpenedProject: Option.Option<string>,
): Effect.Effect<ProjectId, AssetLibraryError> => {
  if (projectId !== undefined) {
    return Effect.succeed(projectId);
  }
  const lastOpened = Option.getOrUndefined(lastOpenedProject);
  if (lastOpened === undefined) {
    return Effect.fail(
      new AssetLibraryError({
        path: projectManifestPath('<active-project>'),
        message: 'no active project; pass projectId',
      }),
    );
  }
  return Effect.try({
    try: () => Schema.decodeUnknownSync(ProjectId)(lastOpened),
    catch: (cause) =>
      new AssetLibraryError({
        path: projectManifestPath(lastOpened),
        message: errorMessage(cause),
      }),
  });
};

const readPaletteStore = (
  projectId: ProjectId,
  filePath: string,
): Effect.Effect<WorkingPaletteStore, AssetLibraryError> =>
  Effect.gen(function* () {
    const raw = yield* Effect.tryPromise({
      try: async () => {
        try {
          return await readFile(filePath, 'utf8');
        } catch (cause) {
          if (isNotFound(cause)) {
            return undefined;
          }
          throw cause;
        }
      },
      catch: (cause) => new AssetLibraryError({ path: filePath, message: errorMessage(cause) }),
    });
    if (raw === undefined) {
      return new WorkingPaletteStore({
        schemaVersion: 1,
        projectId,
        palettes: [],
      });
    }
    const parsed = yield* Effect.try({
      try: (): unknown => JSON.parse(raw),
      catch: (cause) => new AssetLibraryError({ path: filePath, message: errorMessage(cause) }),
    });
    return yield* Effect.try({
      try: () => Schema.decodeUnknownSync(WorkingPaletteStore)(parsed),
      catch: (cause) => new AssetLibraryError({ path: filePath, message: errorMessage(cause) }),
    });
  });

const readExistingPaletteStore = (
  filePath: string,
): Effect.Effect<WorkingPaletteStore | undefined, AssetLibraryError> =>
  Effect.gen(function* () {
    const raw = yield* Effect.tryPromise({
      try: async () => {
        try {
          return await readFile(filePath, 'utf8');
        } catch (cause) {
          if (isNotFound(cause)) {
            return undefined;
          }
          throw cause;
        }
      },
      catch: (cause) => new AssetLibraryError({ path: filePath, message: errorMessage(cause) }),
    });
    if (raw === undefined) {
      return undefined;
    }
    const parsed = yield* Effect.try({
      try: (): unknown => JSON.parse(raw),
      catch: (cause) => new AssetLibraryError({ path: filePath, message: errorMessage(cause) }),
    });
    return yield* Effect.try({
      try: () => Schema.decodeUnknownSync(WorkingPaletteStore)(parsed),
      catch: (cause) => new AssetLibraryError({ path: filePath, message: errorMessage(cause) }),
    });
  });

const writePaletteStore = (
  filePath: string,
  store: WorkingPaletteStore,
): Effect.Effect<void, AssetLibraryError> =>
  Effect.gen(function* () {
    const encoded = yield* Effect.try({
      try: () => Schema.encodeSync(WorkingPaletteStore)(store),
      catch: (cause) => new AssetLibraryError({ path: filePath, message: errorMessage(cause) }),
    });
    yield* Effect.tryPromise({
      try: () => mkdir(path.dirname(filePath), { recursive: true }),
      catch: (cause) => new AssetLibraryError({ path: filePath, message: errorMessage(cause) }),
    });
    yield* writeJsonAtomic(filePath, encoded).pipe(
      Effect.mapError(
        (error) => new AssetLibraryError({ path: error.path, message: error.message }),
      ),
    );
  });

const projectRoots = (
  projectsRoot: string,
): Effect.Effect<ReadonlySet<string>, AssetLibraryError> =>
  Effect.gen(function* () {
    const entries = yield* Effect.tryPromise({
      try: async () => {
        try {
          return await readdir(projectsRoot, { withFileTypes: true });
        } catch (cause) {
          if (isNotFound(cause)) {
            return [];
          }
          throw cause;
        }
      },
      catch: (cause) => new AssetLibraryError({ path: projectsRoot, message: errorMessage(cause) }),
    });
    const roots = new Set(
      entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => path.join(projectsRoot, entry.name)),
    );
    const registry = yield* readProjectRegistry(projectsRoot);
    for (const entry of registry.projects) {
      roots.add(entry.path);
    }
    return roots;
  });

const itemKey = (item: WorkingPaletteItemDraft | WorkingPaletteItem): string =>
  `${item.ref.packId}:${item.ref.kind}:${item.ref.refId}:${item.ref.tileId ?? ''}`;

const makePaletteItem = (draft: WorkingPaletteItemDraft): WorkingPaletteItem =>
  new WorkingPaletteItem({
    id: newPaletteItemId(),
    ref: draft.ref,
    label: draft.label ?? humanizeIdentifier(draft.ref.refId),
  });

const makePalette = (
  projectId: ProjectId,
  name: string,
  drafts: readonly WorkingPaletteItemDraft[],
  now: string,
): WorkingPalette => {
  const seen = new Set<string>();
  const items = drafts.flatMap((draft) => {
    const key = itemKey(draft);
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [makePaletteItem(draft)];
  });
  return new WorkingPalette({
    id: newPaletteId(),
    projectId,
    name,
    items,
    createdAt: now,
    updatedAt: now,
  });
};

const replacePalette = (store: WorkingPaletteStore, palette: WorkingPalette): WorkingPaletteStore =>
  new WorkingPaletteStore({
    schemaVersion: 1,
    projectId: store.projectId,
    activePaletteId: store.activePaletteId,
    palettes: store.palettes.map((entry) => (entry.id === palette.id ? palette : entry)),
  });

const prunePaletteStorePackReferences = (
  store: WorkingPaletteStore,
  packId: PackId,
  now: string,
): {
  readonly store: WorkingPaletteStore;
  readonly affectedPaletteIds: readonly WorkingPaletteId[];
  readonly removedItemCount: number;
} => {
  let removedItemCount = 0;
  const affectedPaletteIds: WorkingPaletteId[] = [];
  const palettes = store.palettes.map((palette) => {
    const items = palette.items.filter((item) => item.ref.packId !== packId);
    const removedFromPalette = palette.items.length - items.length;
    if (removedFromPalette === 0) {
      return palette;
    }
    removedItemCount += removedFromPalette;
    affectedPaletteIds.push(palette.id);
    return new WorkingPalette({
      id: palette.id,
      projectId: palette.projectId,
      name: palette.name,
      items,
      createdAt: palette.createdAt,
      updatedAt: now,
    });
  });
  return {
    store: new WorkingPaletteStore({
      schemaVersion: 1,
      projectId: store.projectId,
      ...(store.activePaletteId === undefined ? {} : { activePaletteId: store.activePaletteId }),
      palettes,
    }),
    affectedPaletteIds,
    removedItemCount,
  };
};

const paletteNotFound = (filePath: string, paletteId: WorkingPaletteId): AssetLibraryError =>
  new AssetLibraryError({ path: filePath, message: `working palette not found: ${paletteId}` });

const withPalette = (
  store: WorkingPaletteStore,
  filePath: string,
  paletteId: WorkingPaletteId,
): Effect.Effect<WorkingPalette, AssetLibraryError> =>
  Effect.gen(function* () {
    const palette = store.palettes.find((entry) => entry.id === paletteId);
    if (palette === undefined) {
      yield* paletteNotFound(filePath, paletteId);
    }
    return palette as WorkingPalette;
  });

const defaultDraftsFromLibrary = (
  library: AssetLibraryIndex,
): readonly WorkingPaletteItemDraft[] => {
  const byPriority = (kind: AssetLibraryGroupKind): readonly WorkingPaletteItemDraft[] =>
    library.groups
      .filter((group) => group.kind === kind && group.primaryRef !== undefined)
      .map((group) => ({
        ref: group.primaryRef as AssetLibraryReference,
        label: group.label,
      }));
  const terrainAndAutotiles = [
    ...byPriority('autotile'),
    ...byPriority('terrain'),
    ...byPriority('placeable'),
  ];
  if (terrainAndAutotiles.length > 0) {
    return terrainAndAutotiles.slice(0, DEFAULT_PALETTE_ITEM_LIMIT);
  }
  return library.groups
    .flatMap((group) => group.previewRefs.map((ref) => ({ ref, label: group.label })))
    .slice(0, DEFAULT_PALETTE_ITEM_LIMIT);
};

const encoder = new TextEncoder();

const isContainedPath = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const resolveMaterializedAssetPath = (
  root: string,
  assetPath: string,
): string => {
  if (assetPath.includes('\0')) {
    throw new AssetLibraryError({ path: assetPath, message: 'NUL path segment is not allowed' });
  }
  const resolved = path.resolve(root, assetPath);
  if (!isContainedPath(path.resolve(root), resolved)) {
    throw new AssetLibraryError({
      path: assetPath,
      message: `Tiled asset path escapes import root: ${assetPath}`,
    });
  }
  return resolved;
};

export const starterPaletteDraftsFromPack = (
  pack: TilesetPack,
  packId: PackId,
  integrityHash: ContentHash,
  importRecommendation: TiledImportRecommendation,
): readonly WorkingPaletteItemDraft[] => {
  const index = buildLibraryGroups(pack, integrityHash);
  const byKind = (kind: AssetLibraryGroupKind, limit: number) =>
    index
      .filter((group) => group.kind === kind && group.primaryRef !== undefined)
      .slice(0, limit)
      .map((group) => ({
        ref: group.primaryRef as AssetLibraryReference,
        label: group.label,
      }));
  const tileDrafts = index
    .filter((group) => group.kind === 'tileset')
    .flatMap((group) => group.previewRefs.map((ref) => ({ ref, label: group.label })))
    .slice(0, 8);
  const placeableDrafts = byKind('placeable', 8);
  if (importRecommendation.browseTarget === 'objects') {
    return [...placeableDrafts, ...byKind('autotile', 8), ...byKind('terrain', 8), ...tileDrafts]
      .slice(0, DEFAULT_PALETTE_ITEM_LIMIT);
  }
  return [...byKind('autotile', 8), ...byKind('terrain', 8), ...tileDrafts, ...placeableDrafts]
    .slice(0, DEFAULT_PALETTE_ITEM_LIMIT);
};

export const materializeTiledImport = (
  input: MaterializeTiledImportInput,
): Effect.Effect<MaterializeTiledImportResult, AssetLibraryServiceError, HomeService | AssetService> =>
  Effect.gen(function* () {
    const home = yield* HomeService;
    const assets = yield* AssetService;
    const paths = yield* home.init();
    const stagingPath = path.join(paths.cache, 'tiled-import-materialize', `${input.pack.id}-${randomUUID()}`);
    yield* Effect.tryPromise({
      try: () => mkdir(stagingPath, { recursive: true }),
      catch: (cause) => new AssetLibraryError({ path: stagingPath, message: errorMessage(cause) }),
    });
    const sourceRoot = path.resolve(input.sourceRoot);
    const folderHash = hashBytes(encoder.encode(`${sourceRoot}:${input.plan.scan.inventory.mapCount}:${input.pack.id}`));
    const manifest = writeTilesetManifest(input.pack, {
      provenance: {
        sourcePath: sourceRoot,
        originTool: `tiled:${folderHash}`,
        importedAt: new Date().toISOString(),
      },
    }) as {
      readonly assets?: readonly { readonly id: string; readonly path: string; readonly mime: string }[];
    } & Record<string, unknown>;
    const copiedAssets: Array<{
      readonly id: string;
      readonly path: string;
      readonly mime: string;
      readonly size: number;
      readonly hash: ContentHash;
      readonly license: {
        readonly spdxId: string;
        readonly redistributable: boolean;
      };
    }> = [];
    for (const asset of manifest.assets ?? []) {
      const source = resolveMaterializedAssetPath(sourceRoot, asset.path);
      const destination = resolveMaterializedAssetPath(stagingPath, asset.path);
      const bytes = yield* Effect.tryPromise({
        try: () => readFile(source),
        catch: (cause) => new AssetLibraryError({ path: source, message: errorMessage(cause) }),
      });
      yield* Effect.tryPromise({
        try: async () => {
          await mkdir(path.dirname(destination), { recursive: true });
          await cp(source, destination, { force: true });
        },
        catch: (cause) => new AssetLibraryError({ path: destination, message: errorMessage(cause) }),
      });
      copiedAssets.push({
        ...asset,
        size: bytes.byteLength,
        hash: hashBytes(bytes),
        license: {
          spdxId: input.pack.license.spdxId,
          redistributable: input.pack.license.redistributable,
        },
      });
    }
    yield* Effect.tryPromise({
      try: () =>
        writeFile(
          path.join(stagingPath, MANIFEST_FILENAME),
          `${JSON.stringify({ ...manifest, assets: copiedAssets }, null, 2)}\n`,
          'utf8',
        ),
      catch: (cause) =>
        new AssetLibraryError({ path: path.join(stagingPath, MANIFEST_FILENAME), message: errorMessage(cause) }),
    });
    const packId = yield* assets.importPackNow(new DirectoryAssetPackSource({ path: stagingPath }));
    yield* Effect.promise(() => rm(stagingPath, { recursive: true, force: true }).catch(() => undefined));
    return { packId, stagingPath };
  });

export const AssetLibraryServiceLive = Layer.effect(
  AssetLibraryService,
  Effect.gen(function* () {
    const home = yield* HomeService;
    const assets = yield* AssetService;
    const paths = yield* home.init();
    const memoryCache = new Map<string, CachedLibraryIndex>();
    const buildingKeys = new Set<string>();
    const lastErrors = new Map<string, string>();

    const remember = (cached: CachedLibraryIndex): CachedLibraryIndex => {
      if (memoryCache.has(cached.key)) {
        memoryCache.delete(cached.key);
      }
      memoryCache.set(cached.key, cached);
      while (memoryCache.size > ASSET_LIBRARY_MEMORY_CACHE_LIMIT) {
        const oldest = memoryCache.keys().next().value as string | undefined;
        if (oldest === undefined) {
          break;
        }
        memoryCache.delete(oldest);
      }
      return cached;
    };

    const recall = (key: string): CachedLibraryIndex | undefined => {
      const cached = memoryCache.get(key);
      if (cached === undefined) {
        return undefined;
      }
      return remember(cached);
    };

    const resolvePackContext = (packId: PackId) =>
      Effect.gen(function* () {
        const pack = yield* assets.getPack(packId);
        const integrityHash = packManifestContentHash(pack);
        return {
          pack,
          integrityHash,
          key: cacheKeyForPack(pack.id, integrityHash),
          packRoot: packDirectory(paths.assets, pack.id, pack.version),
          filePath: cacheFilePath(paths.cache, pack.id, integrityHash),
        };
      });

    const buildCachedIndex = (input: {
      readonly packId: PackId;
      readonly packRoot: string;
      readonly key: string;
      readonly integrityHash: ContentHash;
      readonly filePath: string;
    }): Effect.Effect<CachedLibraryIndex, AssetLibraryError> =>
      Effect.gen(function* () {
        buildingKeys.add(input.key);
        const index = yield* libraryIndexForPack(
          input.packId,
          input.packRoot,
          input.integrityHash,
        ).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              buildingKeys.delete(input.key);
            }),
          ),
        );
        const cached: CachedLibraryIndex = {
          key: input.key,
          packId: input.packId,
          integrityHash: input.integrityHash,
          updatedAt: new Date().toISOString(),
          previewRefCount: previewRefCount(index),
          index,
        };
        yield* writeDiskCache(input.filePath, cached);
        lastErrors.delete(input.key);
        return remember(cached);
      });

    const loadOrBuildCachedIndex = (input: {
      readonly packId: PackId;
      readonly packRoot: string;
      readonly key: string;
      readonly integrityHash: ContentHash;
      readonly filePath: string;
      readonly force?: boolean | undefined;
    }): Effect.Effect<CachedLibraryIndex, AssetLibraryServiceError> =>
      Effect.gen(function* () {
        if (input.force !== true) {
          const cached = recall(input.key);
          if (cached !== undefined) {
            return cached;
          }
          const diskCached = yield* readDiskCache(input.filePath, input.key);
          if (diskCached !== undefined) {
            return remember(diskCached);
          }
        }
        return yield* buildCachedIndex(input).pipe(
          Effect.tapError((error) =>
            Effect.sync(() => {
              lastErrors.set(input.key, error.message);
            }),
          ),
        );
      });

    const getPackLibrary = Effect.fn('AssetLibraryService.getPackLibrary')(function* (
      input: GetPackLibraryInput,
    ) {
      const context = yield* resolvePackContext(input.packId);
      const cached = yield* loadOrBuildCachedIndex({
        packId: context.pack.id,
        packRoot: context.packRoot,
        key: context.key,
        integrityHash: context.integrityHash,
        filePath: context.filePath,
      });
      const filtered = filterLibraryGroups(cached.index.groups, input);
      const offset = normalizeOffset(input.offset);
      const limit = clampLimit(input.limit);
      return {
        packId: input.packId,
        integrityHash: context.integrityHash,
        indexSchemaVersion: ASSET_LIBRARY_INDEX_SCHEMA_VERSION,
        previewRefLimit: PREVIEW_REF_LIMIT,
        total: filtered.length,
        offset,
        limit,
        groups: filtered.slice(offset, offset + limit),
      };
    });

    const getPackCacheStatus = Effect.fn('AssetLibraryService.getPackCacheStatus')(function* (
      input: PackLibraryCacheInput,
    ) {
      const context = yield* resolvePackContext(input.packId);
      if (buildingKeys.has(context.key)) {
        return emptyCacheStatus(context.pack.id, 'building', {
          integrityHash: context.integrityHash,
        });
      }
      const errorMessage = lastErrors.get(context.key);
      if (errorMessage !== undefined) {
        return emptyCacheStatus(context.pack.id, 'error', {
          integrityHash: context.integrityHash,
          errorMessage,
        });
      }
      const cached = recall(context.key);
      if (cached !== undefined) {
        return statusFromCachedIndex(cached, 'cached');
      }
      const diskCached = yield* readDiskCache(context.filePath, context.key);
      if (diskCached !== undefined) {
        return statusFromCachedIndex(remember(diskCached), 'cached');
      }
      const stale = yield* hasStaleDiskCache(paths.cache, context.pack.id, context.integrityHash);
      return emptyCacheStatus(context.pack.id, stale ? 'stale' : 'cold', {
        integrityHash: context.integrityHash,
      });
    });

    const reloadPackCache = Effect.fn('AssetLibraryService.reloadPackCache')(function* (
      input: PackLibraryCacheInput,
    ) {
      const context = yield* resolvePackContext(input.packId);
      memoryCache.delete(context.key);
      lastErrors.delete(context.key);
      const cached = yield* loadOrBuildCachedIndex({
        packId: context.pack.id,
        packRoot: context.packRoot,
        key: context.key,
        integrityHash: context.integrityHash,
        filePath: context.filePath,
        force: true,
      });
      return statusFromCachedIndex(cached, 'cached');
    });

    const invalidatePackCache = Effect.fn('AssetLibraryService.invalidatePackCache')(function* (
      input: PackLibraryCacheInput,
    ) {
      let removedEntries = 0;
      for (const [key, cached] of memoryCache.entries()) {
        if (cached.packId === input.packId) {
          memoryCache.delete(key);
          lastErrors.delete(key);
          buildingKeys.delete(key);
          removedEntries += 1;
        }
      }
      const dir = cacheDirectory(paths.cache);
      const entries = yield* Effect.tryPromise({
        try: async () => {
          try {
            return await readdir(dir);
          } catch (cause) {
            if (isNotFound(cause)) {
              return [];
            }
            throw cause;
          }
        },
        catch: (cause) => new AssetLibraryError({ path: dir, message: errorMessage(cause) }),
      });
      const prefix = cacheFilePrefix(input.packId);
      for (const entry of entries) {
        if (!entry.startsWith(prefix)) {
          continue;
        }
        const filePath = path.join(dir, entry);
        yield* Effect.tryPromise({
          try: () => rm(filePath, { force: true }),
          catch: (cause) => new AssetLibraryError({ path: filePath, message: errorMessage(cause) }),
        });
        removedEntries += 1;
      }
      return { packId: input.packId, removedEntries };
    });

    return { getPackLibrary, getPackCacheStatus, reloadPackCache, invalidatePackCache };
  }),
);

export const WorkingPaletteServiceLive = Layer.effect(
  WorkingPaletteService,
  Effect.gen(function* () {
    const home = yield* HomeService;
    const config = yield* ConfigService;
    const assets = yield* AssetService;
    const paths = yield* home.init();
    const cwd = process.cwd();

    const resolveProject = (
      input: PaletteProjectInput,
    ): Effect.Effect<PaletteProjectResolution, AssetLibraryServiceError> =>
      Effect.gen(function* () {
        const currentConfig = yield* config.get;
        const projectId = yield* resolveProjectIdFromConfig(
          input.projectId,
          currentConfig.lastOpenedProject,
        );
        const projectRoot = yield* resolveProjectRootForId(paths.projects, cwd, projectId);
        return { projectId, projectRoot };
      });

    const defaultStore = (
      resolved: PaletteProjectResolution,
    ): Effect.Effect<WorkingPaletteStore, AssetLibraryServiceError> =>
      Effect.gen(function* () {
        const project = yield* readVerifiedProjectAtRoot(resolved.projectRoot);
        const now = new Date().toISOString();
        const drafts: WorkingPaletteItemDraft[] = [];
        for (const ref of project.assetPacks) {
          const pack = yield* assets.getPack(Schema.decodeUnknownSync(PackId)(ref.id));
          if (pack.version !== ref.version) {
            continue;
          }
          const library = yield* libraryIndexForPack(
            pack.id,
            packDirectory(paths.assets, pack.id, pack.version),
            packManifestContentHash(pack),
          );
          drafts.push(...defaultDraftsFromLibrary(library));
          if (drafts.length >= DEFAULT_PALETTE_ITEM_LIMIT) {
            break;
          }
        }
        if (drafts.length === 0) {
          return new WorkingPaletteStore({
            schemaVersion: 1,
            projectId: resolved.projectId,
            palettes: [],
          });
        }
        const palette = makePalette(
          resolved.projectId,
          'Default Palette',
          drafts.slice(0, DEFAULT_PALETTE_ITEM_LIMIT),
          now,
        );
        return new WorkingPaletteStore({
          schemaVersion: 1,
          projectId: resolved.projectId,
          activePaletteId: palette.id,
          palettes: [palette],
        });
      });

    const loadStore = (
      input: PaletteProjectInput,
    ): Effect.Effect<
      {
        readonly resolved: PaletteProjectResolution;
        readonly filePath: string;
        readonly store: WorkingPaletteStore;
      },
      AssetLibraryServiceError
    > =>
      Effect.gen(function* () {
        const resolved = yield* resolveProject(input);
        const filePath = paletteStorePath(resolved.projectRoot);
        let store = yield* readPaletteStore(resolved.projectId, filePath);
        if (store.palettes.length === 0) {
          store = yield* defaultStore(resolved);
          if (store.palettes.length > 0) {
            yield* writePaletteStore(filePath, store);
          }
        }
        return { resolved, filePath, store };
      });

    const persist = (
      filePath: string,
      store: WorkingPaletteStore,
    ): Effect.Effect<WorkingPaletteStore, AssetLibraryServiceError> =>
      writePaletteStore(filePath, store).pipe(Effect.as(store));

    const list = Effect.fn('WorkingPaletteService.list')(function* (input: PaletteProjectInput) {
      const { store } = yield* loadStore(input);
      return {
        palettes: store.palettes,
        ...(store.activePaletteId === undefined ? {} : { activePaletteId: store.activePaletteId }),
      };
    });

    const getActive = Effect.fn('WorkingPaletteService.getActive')(function* (
      input: PaletteProjectInput,
    ) {
      const { store } = yield* loadStore(input);
      return store.palettes.find((palette) => palette.id === store.activePaletteId);
    });

    const create = Effect.fn('WorkingPaletteService.create')(function* (
      input: PaletteProjectInput & {
        readonly name: string;
        readonly items?: readonly WorkingPaletteItemDraft[] | undefined;
      },
    ) {
      const { resolved, filePath, store } = yield* loadStore(input);
      const now = new Date().toISOString();
      const palette = makePalette(resolved.projectId, input.name, input.items ?? [], now);
      const next = new WorkingPaletteStore({
        schemaVersion: 1,
        projectId: store.projectId,
        activePaletteId: store.activePaletteId ?? palette.id,
        palettes: [...store.palettes, palette],
      });
      yield* persist(filePath, next);
      return palette;
    });

    const update = Effect.fn('WorkingPaletteService.update')(function* (
      input: PaletteProjectInput & {
        readonly paletteId: WorkingPaletteId;
        readonly name?: string | undefined;
        readonly items?: readonly WorkingPaletteItemDraft[] | undefined;
      },
    ) {
      const { filePath, store } = yield* loadStore(input);
      const existing = yield* withPalette(store, filePath, input.paletteId);
      const now = new Date().toISOString();
      const nextPalette = new WorkingPalette({
        id: existing.id,
        projectId: existing.projectId,
        name: input.name ?? existing.name,
        items: input.items === undefined ? existing.items : input.items.map(makePaletteItem),
        createdAt: existing.createdAt,
        updatedAt: now,
      });
      yield* persist(filePath, replacePalette(store, nextPalette));
      return nextPalette;
    });

    const deletePalette = Effect.fn('WorkingPaletteService.delete')(function* (
      input: PaletteProjectInput & { readonly paletteId: WorkingPaletteId },
    ) {
      const { filePath, store } = yield* loadStore(input);
      yield* withPalette(store, filePath, input.paletteId);
      const palettes = store.palettes.filter((palette) => palette.id !== input.paletteId);
      const activePaletteId =
        store.activePaletteId === input.paletteId ? palettes[0]?.id : store.activePaletteId;
      yield* persist(
        filePath,
        new WorkingPaletteStore({
          schemaVersion: 1,
          projectId: store.projectId,
          ...(activePaletteId === undefined ? {} : { activePaletteId }),
          palettes,
        }),
      );
    });

    const setActive = Effect.fn('WorkingPaletteService.setActive')(function* (
      input: PaletteProjectInput & { readonly paletteId: WorkingPaletteId },
    ) {
      const { filePath, store } = yield* loadStore(input);
      const palette = yield* withPalette(store, filePath, input.paletteId);
      yield* persist(
        filePath,
        new WorkingPaletteStore({
          schemaVersion: 1,
          projectId: store.projectId,
          activePaletteId: palette.id,
          palettes: store.palettes,
        }),
      );
      return palette;
    });

    const addItems = Effect.fn('WorkingPaletteService.addItems')(function* (
      input: PaletteProjectInput & {
        readonly paletteId: WorkingPaletteId;
        readonly items: readonly WorkingPaletteItemDraft[];
        readonly atIndex?: number | undefined;
      },
    ) {
      const { filePath, store } = yield* loadStore(input);
      const existing = yield* withPalette(store, filePath, input.paletteId);
      const existingKeys = new Set(existing.items.map(itemKey));
      const additions = input.items.flatMap((draft) => {
        const key = itemKey(draft);
        if (existingKeys.has(key)) {
          return [];
        }
        existingKeys.add(key);
        return [makePaletteItem(draft)];
      });
      const insertAt =
        input.atIndex === undefined
          ? existing.items.length
          : Math.max(0, Math.min(existing.items.length, Math.trunc(input.atIndex)));
      const items = [
        ...existing.items.slice(0, insertAt),
        ...additions,
        ...existing.items.slice(insertAt),
      ];
      const nextPalette = new WorkingPalette({
        id: existing.id,
        projectId: existing.projectId,
        name: existing.name,
        items,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      });
      yield* persist(filePath, replacePalette(store, nextPalette));
      return nextPalette;
    });

    const removeItem = Effect.fn('WorkingPaletteService.removeItem')(function* (
      input: PaletteProjectInput & {
        readonly paletteId: WorkingPaletteId;
        readonly itemId: WorkingPaletteItemId;
      },
    ) {
      const { filePath, store } = yield* loadStore(input);
      const existing = yield* withPalette(store, filePath, input.paletteId);
      const items = existing.items.filter((item) => item.id !== input.itemId);
      if (items.length === existing.items.length) {
        yield* new AssetLibraryError({
          path: filePath,
          message: `working palette item not found: ${input.itemId}`,
        });
      }
      const nextPalette = new WorkingPalette({
        id: existing.id,
        projectId: existing.projectId,
        name: existing.name,
        items,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      });
      yield* persist(filePath, replacePalette(store, nextPalette));
      return nextPalette;
    });

    const reorderItems = Effect.fn('WorkingPaletteService.reorderItems')(function* (
      input: PaletteProjectInput & {
        readonly paletteId: WorkingPaletteId;
        readonly itemIds: readonly WorkingPaletteItemId[];
      },
    ) {
      const { filePath, store } = yield* loadStore(input);
      const existing = yield* withPalette(store, filePath, input.paletteId);
      const byId = new Map(existing.items.map((item) => [item.id, item] as const));
      if (
        input.itemIds.length !== existing.items.length ||
        input.itemIds.some((itemId) => !byId.has(itemId))
      ) {
        yield* new AssetLibraryError({
          path: filePath,
          message: 'reorderItems must include each palette item exactly once',
        });
      }
      const nextPalette = new WorkingPalette({
        id: existing.id,
        projectId: existing.projectId,
        name: existing.name,
        items: input.itemIds.map((itemId) => byId.get(itemId) as WorkingPaletteItem),
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      });
      yield* persist(filePath, replacePalette(store, nextPalette));
      return nextPalette;
    });

    const prunePackReferences = Effect.fn('WorkingPaletteService.prunePackReferences')(function* (
      input: PruneWorkingPalettePackReferencesInput,
    ) {
      const roots = yield* projectRoots(paths.projects);
      const affectedProjectIds: ProjectId[] = [];
      const affectedPaletteIds: WorkingPaletteId[] = [];
      let removedItemCount = 0;
      const now = new Date().toISOString();

      for (const projectRoot of roots) {
        const filePath = paletteStorePath(projectRoot);
        const store = yield* readExistingPaletteStore(filePath);
        if (store === undefined) {
          continue;
        }
        const pruned = prunePaletteStorePackReferences(store, input.packId, now);
        if (pruned.removedItemCount === 0) {
          continue;
        }
        yield* persist(filePath, pruned.store);
        affectedProjectIds.push(store.projectId);
        affectedPaletteIds.push(...pruned.affectedPaletteIds);
        removedItemCount += pruned.removedItemCount;
      }

      return {
        packId: input.packId,
        affectedProjectIds,
        affectedPaletteIds,
        removedItemCount,
      };
    });

    return {
      list,
      getActive,
      create,
      update,
      delete: deletePalette,
      setActive,
      addItems,
      removeItem,
      reorderItems,
      prunePackReferences,
    };
  }),
);
