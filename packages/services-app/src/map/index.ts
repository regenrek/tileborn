import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  MapId,
  PackId,
  ProjectId,
  ProjectMapRef,
  TileLayer,
  TileborneMap,
  TileborneMapSchema,
  Uuid,
  hashJsonStable,
  makeLayerId,
  makeMapId,
  makeTileborneMap,
} from '@tileborne/core';
import {
  HomeService,
  writeJsonAtomic,
  type HomeServiceError,
} from '@tileborne/services-foundation';
import { Context, Effect, Layer, PubSub, Schema, Stream } from 'effect';

import { verifiedChildPath } from '../internal/path-security.js';
import { exportMapToTiled } from '../internal/tiled.js';
import {
  MapIntegrityEntry,
  mapPath,
  packDirectory,
  packManifestPath,
  projectLockPath,
  relativeMapPath,
} from '../internal/layout.js';
import { errorMessage } from '../internal/files.js';
import {
  readProjectLock,
  readVerifiedProjectAtRoot,
  resolveProjectRootForId,
  updateProjectMaps,
  writeProjectWithLock,
  appendProjectImportRecord,
  type ImportCenterApplyReport,
  type ImportCenterSourceIdentity,
  type ImportCenterSourceKind,
  type ProjectServiceError,
} from '../project/index.js';
import { makeGeneratedLayers, MAP_GENERATE_PRESETS, type MapGeneratePreset } from './procgen.js';
import {
  AssetService,
  packManifestContentHash,
  type AssetPackWithCapability,
  type AssetServiceError,
} from '../asset/index.js';
import { parseTilesetManifest } from '@tileborne/sdk-tileset/manifest';
import {
  applyImportPlan,
  buildImportPlan,
  importTiled,
  scanTiledSource,
  type TiledAppliedImportPlan,
  type TiledAnyCanonicalImport,
  type TiledImportPlan,
  type TiledImportPlanHints,
  type TiledImportProfile,
  type TiledImportScan,
} from '@tileborne/sdk-tileset/tiled';
import type { ParseDiagnostic } from '@tileborne/sdk-tileset/diagnostics';
import type { TilesetPack } from '@tileborne/sdk-tileset/schemas';
import { projectGeneratedTerrainLayers } from './terrain-projection.js';
import {
  WorkingPaletteService,
  materializeTiledImport,
  starterPaletteDraftsFromPack,
  type AssetLibraryServiceError,
} from '../asset-library/index.js';

export type { MapGeneratePreset } from './procgen.js';
export { MAP_GENERATE_PRESETS } from './procgen.js';

export interface MapCreateSpec {
  readonly width: number;
  readonly height: number;
  readonly tileWidth?: number;
  readonly tileHeight?: number;
  readonly properties?: TileborneMap['properties'];
}

export interface MapGenerateSpec {
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  readonly preset: MapGeneratePreset;
  readonly tilesetPackId?: PackId;
}

export interface MapTiledImportOptions {
  readonly profile?: TiledImportProfile;
  readonly hints?: TiledImportPlanHints | undefined;
}

export type TiledImportInventoryPreview = TiledImportScan['inventory'] & {
  readonly imageAssetCount: number;
};

export interface MapTiledImportAnalysis {
  readonly sourceKind: ImportCenterSourceKind;
  readonly scan: TiledImportScan;
  readonly diagnostics: readonly ParseDiagnostic[];
  readonly inventoryPreview: TiledImportInventoryPreview;
}

export interface MapTiledImportPlanResult {
  readonly sourceKind: ImportCenterSourceKind;
  readonly plan: TiledImportPlan;
  readonly diagnostics: readonly ParseDiagnostic[];
  readonly inventoryPreview: TiledImportInventoryPreview;
}

export type MapTiledImportResult =
  | {
      readonly kind: 'map';
      readonly mapId: MapId;
      readonly layerCount: number;
      readonly objectCount: number;
      readonly packId?: PackId;
      readonly report: ImportCenterApplyReport;
    }
  | {
      readonly kind: 'asset-pack';
      readonly packId: PackId;
      readonly report: ImportCenterApplyReport;
    };

export interface MapSummary {
  readonly id: MapId;
  readonly path: string;
  readonly width: number;
  readonly height: number;
  readonly layerCount: number;
  readonly objectCount: number;
}

export class MapNotFoundError extends Schema.TaggedErrorClass<MapNotFoundError>()(
  'MapNotFoundError',
  {
    projectId: ProjectId,
    mapId: MapId,
    message: Schema.String,
  },
) {}

export class MapValidationError extends Schema.TaggedErrorClass<MapValidationError>()(
  'MapValidationError',
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

export class MapSaveError extends Schema.TaggedErrorClass<MapSaveError>()('MapSaveError', {
  path: Schema.String,
  message: Schema.String,
}) {}

export class MapTilesetPackNotPaintableError extends Schema.TaggedErrorClass<MapTilesetPackNotPaintableError>()(
  'MapTilesetPackNotPaintableError',
  {
    projectId: ProjectId,
    mapId: MapId,
    packId: PackId,
    message: Schema.String,
  },
) {}

export type MapServiceError =
  | MapNotFoundError
  | MapValidationError
  | MapSaveError
  | MapTilesetPackNotPaintableError
  | AssetServiceError
  | AssetLibraryServiceError
  | ProjectServiceError
  | HomeServiceError;

export class MapService extends Context.Service<
  MapService,
  {
    readonly create: (
      projectId: ProjectId,
      spec: MapCreateSpec,
    ) => Effect.Effect<MapId, MapServiceError>;
    readonly generate: (
      projectId: ProjectId,
      spec: MapGenerateSpec,
    ) => Effect.Effect<TileborneMap, MapServiceError>;
    readonly load: (
      projectId: ProjectId,
      mapId: MapId,
    ) => Effect.Effect<TileborneMap, MapServiceError>;
    readonly save: (
      projectId: ProjectId,
      map: TileborneMap,
    ) => Effect.Effect<void, MapServiceError>;
    readonly setMapTilesetPack: (
      projectId: ProjectId,
      mapId: MapId,
      packId: PackId,
    ) => Effect.Effect<MapSummary, MapServiceError>;
    readonly list: (projectId: ProjectId) => Effect.Effect<readonly MapSummary[], MapServiceError>;
    readonly delete: (projectId: ProjectId, mapId: MapId) => Effect.Effect<void, MapServiceError>;
    readonly subscribe: (
      projectId: ProjectId,
    ) => Stream.Stream<readonly MapSummary[], MapServiceError>;
    readonly exportToFile: (
      projectId: ProjectId,
      mapId: MapId,
      format: 'json' | 'tiled',
      destPath: string,
    ) => Effect.Effect<
      { readonly mapId: MapId; readonly format: string; readonly out: string },
      MapServiceError
    >;
    readonly importFromTiledFile: (
      projectId: ProjectId,
      srcPath: string,
      options?: MapTiledImportOptions,
    ) => Effect.Effect<MapTiledImportResult, MapServiceError>;
    readonly importFromTiledFolder: (
      projectId: ProjectId,
      srcPath: string,
      options?: MapTiledImportOptions,
    ) => Effect.Effect<MapTiledImportResult, MapServiceError>;
    readonly scanTiledFile: (
      projectId: ProjectId,
      srcPath: string,
    ) => Effect.Effect<TiledImportScan, MapServiceError>;
    readonly analyzeTiledImport: (
      projectId: ProjectId,
      srcPath: string,
    ) => Effect.Effect<MapTiledImportAnalysis, MapServiceError>;
    readonly planTiledImport: (
      projectId: ProjectId,
      srcPath: string,
      options?: MapTiledImportOptions,
    ) => Effect.Effect<MapTiledImportPlanResult, MapServiceError>;
  }
>()('@tileborne/services-app/MapService') {}

const newMapId = (): MapId => makeMapId(randomUUID() as Uuid);

const makeEditorTileLayer = (name: string): TileLayer =>
  new TileLayer({
    id: makeLayerId(randomUUID() as Uuid),
    name,
    visible: true,
    opacity: 1,
    chunks: [],
  });

const isMapGeneratePreset = (value: string): value is MapGeneratePreset =>
  (MAP_GENERATE_PRESETS as readonly string[]).includes(value);

const validateGenerateSpec = (spec: MapGenerateSpec): Effect.Effect<void, MapValidationError> =>
  Effect.gen(function* () {
    if (!Number.isInteger(spec.width) || spec.width < 1) {
      yield* new MapValidationError({
        path: '<generate>',
        message: 'width must be a positive integer',
      });
    }
    if (!Number.isInteger(spec.height) || spec.height < 1) {
      yield* new MapValidationError({
        path: '<generate>',
        message: 'height must be a positive integer',
      });
    }
    if (!Number.isInteger(spec.seed)) {
      yield* new MapValidationError({ path: '<generate>', message: 'seed must be an integer' });
    }
    if (!isMapGeneratePreset(spec.preset)) {
      yield* new MapValidationError({
        path: '<generate>',
        message: `preset must be one of: ${MAP_GENERATE_PRESETS.join(', ')}`,
      });
    }
  });

const optionValue = <A>(
  value: A | { readonly _tag: string; readonly value?: A } | undefined,
): A | undefined => {
  if (typeof value === 'object' && value !== null && '_tag' in value) {
    return value._tag === 'Some' ? value.value : undefined;
  }
  return value;
};

const optionalJsonProperty = <K extends string, A>(
  key: K,
  value: A | undefined,
): Partial<Record<K, A>> => (value === undefined ? {} : ({ [key]: value } as Record<K, A>));

const placementToJson = (
  placement: TileborneMap['objects'][number]['placement'] | undefined,
): unknown => {
  if (placement === undefined) {
    return undefined;
  }
  return {
    placeableId: placement.placeableId,
    source: placement.source,
    ...optionalJsonProperty('assetId', optionValue(placement.assetId)),
    ...optionalJsonProperty('tileId', optionValue(placement.tileId)),
    ...optionalJsonProperty('gid', optionValue(placement.gid)),
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizePlacementJsonForDecode = (value: unknown): unknown => {
  if (!isRecord(value)) {
    return value;
  }
  return {
    ...value,
    assetId: 'assetId' in value ? value.assetId : undefined,
    tileId: 'tileId' in value ? value.tileId : undefined,
    gid: 'gid' in value ? value.gid : undefined,
  };
};

const normalizeMapJsonForDecode = (value: unknown): unknown => {
  if (!isRecord(value) || !Array.isArray(value.objects)) {
    return value;
  }
  return {
    ...value,
    objects: value.objects.map((object) => {
      if (!isRecord(object)) {
        return object;
      }
      return {
        ...object,
        width: 'width' in object ? object.width : undefined,
        height: 'height' in object ? object.height : undefined,
        placement:
          'placement' in object
            ? normalizePlacementJsonForDecode(object.placement)
            : undefined,
      };
    }),
  };
};

const mapToJson = (map: TileborneMap): unknown => ({
  id: map.id,
  schemaVersion: map.schemaVersion,
  size: { width: map.size.width, height: map.size.height },
  tileSize: { width: map.tileSize.width, height: map.tileSize.height },
  layers: map.layers.map((layer) => {
    switch (layer._tag) {
      case 'tile':
        return {
          kind: 'tile',
          id: layer.id,
          name: layer.name,
          visible: layer.visible,
          opacity: layer.opacity,
          chunks: layer.chunks.map((chunk) => ({
            x: chunk.x,
            y: chunk.y,
            width: chunk.width,
            height: chunk.height,
            tiles: [...chunk.tiles],
          })),
        };
      case 'object':
        return {
          kind: 'object',
          id: layer.id,
          name: layer.name,
          visible: layer.visible,
          opacity: layer.opacity,
          objectIds: [...layer.objectIds],
        };
      case 'image':
        return {
          kind: 'image',
          id: layer.id,
          name: layer.name,
          visible: layer.visible,
          opacity: layer.opacity,
          assetId: layer.assetId,
          x: layer.x,
          y: layer.y,
        };
      case 'collision':
        return {
          kind: 'collision',
          id: layer.id,
          name: layer.name,
          visible: layer.visible,
          opacity: layer.opacity,
          chunks: layer.chunks.map((chunk) => ({
            x: chunk.x,
            y: chunk.y,
            width: chunk.width,
            height: chunk.height,
            tiles: [...chunk.tiles],
          })),
        };
    }
  }),
  objects: map.objects.map((object) => ({
    id: object.id,
    kind: object.kind,
    x: object.x,
    y: object.y,
    ...optionalJsonProperty('width', optionValue(object.width)),
    ...optionalJsonProperty('height', optionValue(object.height)),
    layerId: object.layerId,
    properties: object.properties,
    ...optionalJsonProperty('placement', placementToJson(object.placement)),
  })),
  properties: map.properties,
});

const encodeMapJson = (filePath: string, map: TileborneMap): Effect.Effect<unknown, MapSaveError> =>
  Effect.try({
    try: () => {
      const encoded = mapToJson(map);
      Schema.decodeUnknownSync(TileborneMapSchema)(normalizeMapJsonForDecode(encoded));
      return encoded;
    },
    catch: (cause) => new MapSaveError({ path: filePath, message: errorMessage(cause) }),
  });

const mapToIpcView = (map: TileborneMap): TileborneMap =>
  Schema.decodeUnknownSync(TileborneMap)(normalizeMapJsonForDecode(mapToJson(map)));

const hashMap = (map: TileborneMap) => hashJsonStable(mapToJson(map));

const readMapFile = (
  filePath: string,
  projectId: ProjectId,
  mapId: MapId,
): Effect.Effect<TileborneMap, MapNotFoundError | MapValidationError> =>
  Effect.gen(function* () {
    const raw = yield* Effect.tryPromise({
      try: () => readFile(filePath, 'utf8'),
      catch: (cause) =>
        errorMessage(cause).includes('ENOENT')
          ? new MapNotFoundError({ projectId, mapId, message: `map not found: ${mapId}` })
          : new MapValidationError({ path: filePath, message: errorMessage(cause) }),
    });
    const parsed = yield* Effect.try({
      try: (): unknown => JSON.parse(raw),
      catch: (cause) => new MapValidationError({ path: filePath, message: errorMessage(cause) }),
    });
    return yield* Effect.try({
      try: () => Schema.decodeUnknownSync(TileborneMapSchema)(normalizeMapJsonForDecode(parsed)),
      catch: (cause) => new MapValidationError({ path: filePath, message: errorMessage(cause) }),
    });
  });

const writeMapFile = (filePath: string, map: TileborneMap): Effect.Effect<void, MapSaveError> =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => mkdir(path.dirname(filePath), { recursive: true }),
      catch: (cause) => new MapSaveError({ path: filePath, message: errorMessage(cause) }),
    });
    const encoded = yield* encodeMapJson(filePath, map);
    yield* writeJsonAtomic(filePath, encoded).pipe(
      Effect.mapError((error) => new MapSaveError({ path: error.path, message: error.message })),
    );
  });

const TILED_DIRECT_FILE_EXTENSIONS = new Set(['.tmx', '.tmj', '.json']);
const TILED_TILESET_EXTENSIONS = new Set(['.tsx', '.tsj']);
const TILED_IMPORT_FILE_EXTENSIONS = new Set([...TILED_DIRECT_FILE_EXTENSIONS, ...TILED_TILESET_EXTENSIONS]);

const isContainedPath = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const isDirectTiledImportFile = (filePath: string): boolean =>
  TILED_IMPORT_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase());

const isDirectTiledTilesetFile = (filePath: string): boolean =>
  TILED_TILESET_EXTENSIONS.has(path.extname(filePath).toLowerCase());

const parentTraversalDepth = (assetPath: string): number => {
  if (assetPath.includes('\0') || path.isAbsolute(assetPath) || /^[A-Za-z]:[\\/]/.test(assetPath)) {
    return 0;
  }
  let depth = 0;
  for (const segment of assetPath.replaceAll('\\', '/').split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment !== '..') break;
    depth += 1;
  }
  return depth;
};

const collectJsonImageSources = (value: unknown): readonly string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectJsonImageSources(entry));
  }
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  const record = value as Record<string, unknown>;
  return [
    ...(typeof record.image === 'string' ? [record.image] : []),
    ...Object.values(record).flatMap((entry) => collectJsonImageSources(entry)),
  ];
};

const commonAncestor = (paths: readonly string[]): string => {
  const [first, ...rest] = paths.map((entry) => path.resolve(entry));
  if (first === undefined) return path.resolve('.');
  const separator = path.sep;
  const firstSegments = first.split(separator);
  let end = firstSegments.length;
  for (const current of rest) {
    const segments = current.split(separator);
    end = Math.min(end, segments.length);
    for (let index = 0; index < end; index += 1) {
      if (firstSegments[index] !== segments[index]) {
        end = index;
        break;
      }
    }
  }
  const root = first.startsWith(separator) ? separator : '';
  return path.resolve(root, ...firstSegments.slice(first.startsWith(separator) ? 1 : 0, end));
};

const directTiledTextSources = (raw: string, sourcePath: string): readonly string[] => {
  const lower = sourcePath.toLowerCase();
  if (lower.endsWith('.tmj') || lower.endsWith('.tsj') || lower.endsWith('.json')) {
    try {
      return collectJsonImageSources(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  return [...raw.matchAll(/\bsource\s*=\s*["']([^"']+)["']/gu)].map((match) => match[1] ?? '');
};

const inferImportRootFromTiledFiles = async (
  selectedRoot: string,
  files: readonly string[],
): Promise<string> => {
  const candidates: string[] = [selectedRoot];
  for (const filePath of files) {
    const raw = await readFile(filePath, 'utf8');
    for (const source of directTiledTextSources(raw, filePath)) {
      const boundedTraversal = Math.min(parentTraversalDepth(source), 2);
      candidates.push(path.resolve(path.dirname(filePath), ...Array.from({ length: boundedTraversal }, () => '..')));
    }
  }
  return commonAncestor(candidates);
};

const inferDirectTilesetImportRoot = async (sourcePath: string): Promise<string> => {
  const sourceDir = path.dirname(sourcePath);
  return inferImportRootFromTiledFiles(sourceDir, [sourcePath]);
};

const findTiledImportFiles = async (root: string): Promise<readonly string[]> => {
  const visited = new Set<string>();
  const walk = async (directory: string): Promise<readonly string[]> => {
    const realDirectory = await realpath(directory);
    if (visited.has(realDirectory)) return [];
    visited.add(realDirectory);
    const entries = await readdir(realDirectory, { withFileTypes: true, encoding: 'utf8' });
    const nested = await Promise.all(
      entries.map(async (entry): Promise<readonly string[]> => {
        const entryPath = path.join(realDirectory, entry.name);
        if (entry.isDirectory()) {
          return walk(entryPath);
        }
        if (!entry.isFile() || !isDirectTiledImportFile(entryPath)) {
          return [];
        }
        return [entryPath];
      }),
    );
    return nested.flat();
  };
  return walk(root);
};

const inferTiledDirectoryImportRoot = async (sourcePath: string): Promise<string> => {
  const files = await findTiledImportFiles(sourcePath);
  return inferImportRootFromTiledFiles(sourcePath, files);
};

const resolveTiledImportSource = (
  projectDir: string,
  srcPath: string,
): Effect.Effect<{ readonly sourcePath: string; readonly importRoot: string }, MapValidationError> =>
  Effect.gen(function* () {
    if (srcPath.includes('\0')) {
      yield* new MapValidationError({ path: srcPath, message: 'NUL path segment is not allowed' });
    }
    const inputWasAbsolute = path.isAbsolute(srcPath);
    const resolvedInput = inputWasAbsolute
      ? path.resolve(srcPath)
      : yield* verifiedChildPath(projectDir, srcPath).pipe(
          Effect.mapError((error) => new MapValidationError({ path: srcPath, message: error.message })),
        );
    return yield* Effect.tryPromise({
      try: async () => {
      const inputStat = await stat(resolvedInput);
      if (inputStat.isDirectory()) {
        const sourcePath = await realpath(resolvedInput);
        const importRoot = await inferTiledDirectoryImportRoot(sourcePath);
        return { sourcePath, importRoot };
      }
      if (!inputStat.isFile() || !isDirectTiledImportFile(resolvedInput)) {
        throw new MapValidationError({
          path: resolvedInput,
          message: 'Choose a Tiled map file (.tmx, .tmj, or .json), Tiled tileset file (.tsx or .tsj), or source folder.',
        });
      }
      const sourcePath = await realpath(resolvedInput);
      return {
        sourcePath,
        importRoot: isDirectTiledTilesetFile(sourcePath)
          ? await inferDirectTilesetImportRoot(sourcePath)
          : inputWasAbsolute
            ? path.dirname(path.dirname(sourcePath))
            : projectDir,
      };
    },
    catch: (cause) =>
      cause instanceof MapValidationError
        ? cause
        : new MapValidationError({ path: srcPath, message: errorMessage(cause) }),
    });
  });

const resolveContainedTiledAssetSource = (
  sourceDir: string,
  assetPath: string,
): string => {
  const root = path.resolve(sourceDir);
  const resolved = path.resolve(root, assetPath);
  if (!isContainedPath(root, resolved)) {
    throw new MapValidationError({
      path: assetPath,
      message: `Tiled asset source path escapes the import source directory: ${assetPath}`,
    });
  }
  return resolved;
};

const hasReadablePackAssets = async (pack: TilesetPack, sourceRoot: string): Promise<boolean> => {
  for (const asset of pack.assets) {
    const source = resolveContainedTiledAssetSource(sourceRoot, asset.path);
    try {
      await access(source);
    } catch {
      return false;
    }
  }
  return true;
};

const makeTiledReader = () => ({
  readFile,
  realpath,
  readDirectory: async (directory: string) =>
    (await readdir(directory, { withFileTypes: true, encoding: 'utf8' })).map((entry) => ({
      name: entry.name,
      kind: entry.isDirectory() ? ('directory' as const) : ('file' as const),
    })),
});

const sourceRootForImport = (value: TiledAnyCanonicalImport, resolvedSrc: string, importRoot: string): string => {
  if (value.kind === 'source-pack') {
    return importRoot;
  }
  if (value.kind === 'tileset-pack') {
    return importRoot;
  }
  return importRoot;
};

const importCenterSourceKind = (scan: TiledImportScan): ImportCenterSourceKind => {
  if (scan.sourceKind === 'map') return 'tiled-map';
  if (scan.sourceKind === 'tileset') return 'tiled-tileset';
  return 'tiled-source-folder';
};

const inventoryPreview = (scan: TiledImportScan): TiledImportInventoryPreview => ({
  ...scan.inventory,
  imageAssetCount: scan.imageAssets.length,
});

const profileForTiledImport = (
  scan: TiledImportScan,
  requestedProfile: TiledImportProfile | undefined,
): Effect.Effect<TiledImportProfile, MapValidationError> =>
  Effect.gen(function* () {
    if (requestedProfile !== undefined) {
      return requestedProfile;
    }
    const recommendedProfile = scan.importRecommendation.recommendedProfile;
    if (recommendedProfile === 'plugin-required') {
      return yield* Effect.fail(new MapValidationError({
        path: scan.sourcePath,
        message: scan.importRecommendation.rationale,
      }));
    } else {
      return recommendedProfile;
    }
  });

const importRecordId = (): string => `import:${randomUUID()}`;

const sourceIdentityFor = (
  kind: ImportCenterSourceKind,
  sourcePath: string,
): Effect.Effect<ImportCenterSourceIdentity, MapValidationError> =>
  Effect.gen(function* () {
    const fingerprint = yield* Effect.tryPromise({
      try: async () => {
        const sourceStat = await stat(sourcePath);
        return {
          realPath: await realpath(sourcePath),
          size: sourceStat.size,
          mtimeMs: sourceStat.mtimeMs,
          isDirectory: sourceStat.isDirectory(),
        };
      },
      catch: (cause) => new MapValidationError({ path: sourcePath, message: errorMessage(cause) }),
    });
    return {
      kind,
      path: sourcePath,
      detectedAt: new Date().toISOString(),
      fingerprint,
    };
  });

const buildApplyReport = (input: {
  readonly sourceIdentity: ImportCenterSourceIdentity;
  readonly appliedPlan: TiledAppliedImportPlan;
  readonly outputs: ImportCenterApplyReport['outputs'];
}): ImportCenterApplyReport => ({
  importRecordId: importRecordId(),
  sourceIdentity: input.sourceIdentity,
  diagnostics: input.appliedPlan.diagnostics,
  appliedPlan: input.appliedPlan,
  outputs: input.outputs,
});

const materializeImportedPack = (
  input: {
    readonly plan: TiledAppliedImportPlan;
    readonly value: TiledAnyCanonicalImport;
    readonly sourceRoot: string;
    readonly resolvedSrc: string;
    readonly projectId: ProjectId;
  },
  services: {
    readonly home: HomeService["Service"];
    readonly assets: AssetService["Service"];
    readonly workingPalettes: WorkingPaletteService["Service"];
  },
): Effect.Effect<PackId, MapServiceError> =>
  Effect.gen(function* () {
    const canRegisterPack = yield* Effect.tryPromise({
      try: () => hasReadablePackAssets(input.value.pack, input.sourceRoot),
      catch: (cause) =>
        cause instanceof MapValidationError
          ? cause
          : new MapValidationError({ path: input.resolvedSrc, message: errorMessage(cause) }),
    });
    if (input.value.pack.assets.length === 0 || !canRegisterPack) {
      yield* new MapValidationError({
        path: input.resolvedSrc,
        message: 'Tiled import produced no readable asset pack files.',
      });
    }
    const materialized = yield* materializeTiledImport({
      plan: input.plan,
      pack: input.value.pack,
      sourceRoot: input.sourceRoot,
    }).pipe(
      Effect.provideService(HomeService, services.home),
      Effect.provideService(AssetService, services.assets),
    );
    const registeredPack = yield* services.assets.getPack(materialized.packId);
    const paletteDrafts = starterPaletteDraftsFromPack(
      input.value.pack,
      materialized.packId,
      packManifestContentHash(registeredPack),
      input.plan.importRecommendation,
    );
    if (paletteDrafts.length > 0) {
      const palette = yield* services.workingPalettes.create({
        projectId: input.projectId,
        name: `${input.value.pack.name} Starter Palette`,
        items: paletteDrafts,
      });
      yield* services.workingPalettes.setActive({ projectId: input.projectId, paletteId: palette.id });
    }
    return materialized.packId;
  });

const readTilesetPackManifest = (
  assetsRoot: string,
  pack: AssetPackWithCapability,
): Effect.Effect<TilesetPack, MapValidationError> =>
  Effect.gen(function* () {
    const filePath = packManifestPath(packDirectory(assetsRoot, pack.id, pack.version));
    const raw = yield* Effect.tryPromise({
      try: () => readFile(filePath, 'utf8'),
      catch: (cause) => new MapValidationError({ path: filePath, message: errorMessage(cause) }),
    });
    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw) as unknown,
      catch: (cause) => new MapValidationError({ path: filePath, message: errorMessage(cause) }),
    });
    const result = parseTilesetManifest(parsed);
    if (result.value === undefined) {
      return yield* new MapValidationError({
        path: filePath,
        message: `selected tileset pack cannot be projected: ${result.diagnostics
          .map((diagnostic) => diagnostic.message)
          .join('; ')}`,
      });
    }
    return result.value;
  });

export const toMapIpcView = (map: TileborneMap): TileborneMap => mapToIpcView(map);

export const toMapIpcPayload = (map: TileborneMap): unknown =>
  normalizeMapJsonForDecode(mapToJson(map));

export const readVerifiedMap = (
  projectDir: string,
  projectId: ProjectId,
  mapId: MapId,
): Effect.Effect<TileborneMap, MapServiceError> =>
  Effect.gen(function* () {
    const project = yield* readVerifiedProjectAtRoot(projectDir);
    if (project.id !== projectId) {
      yield* new MapValidationError({
        path: projectDir,
        message: `project id mismatch: expected ${projectId} got ${project.id}`,
      });
    }
    const ref = project.maps.find((entry) => entry.id === mapId);
    if (!ref) {
      yield* new MapNotFoundError({ projectId, mapId, message: `map not found: ${mapId}` });
    }
    const filePath = mapPath(projectDir, mapId);
    const map = yield* readMapFile(filePath, projectId, mapId);
    if (map.id !== mapId) {
      yield* new MapValidationError({
        path: filePath,
        message: `map id mismatch: expected ${mapId} got ${map.id}`,
      });
    }
    const lock = yield* readProjectLock(projectLockPath(projectDir)).pipe(
      Effect.mapError(
        (error) => new MapValidationError({ path: error.path, message: error.message }),
      ),
    );
    const entry = lock.maps.find((candidate) => candidate.id === mapId);
    if (!entry) {
      yield* new MapValidationError({
        path: filePath,
        message: `missing integrity entry for ${mapId}`,
      });
    }
    const lockedEntry = entry as MapIntegrityEntry;
    const actual = hashMap(map);
    if (lockedEntry.hash !== actual) {
      yield* new MapValidationError({
        path: filePath,
        message: `map integrity mismatch: expected ${lockedEntry.hash} got ${actual}`,
      });
    }
    return map;
  });

const summaryFromMap = (ref: ProjectMapRef, map: TileborneMap): MapSummary => ({
  id: map.id,
  path: ref.path,
  width: map.size.width,
  height: map.size.height,
  layerCount: map.layers.length,
  objectCount: map.objects.length,
});

const listVerifiedMapsAt = (
  projectDir: string,
  projectId: ProjectId,
): Effect.Effect<readonly MapSummary[], MapServiceError> =>
  Effect.gen(function* () {
    const project = yield* readVerifiedProjectAtRoot(projectDir);
    if (project.id !== projectId) {
      yield* new MapValidationError({
        path: projectDir,
        message: `project id mismatch: expected ${projectId} got ${project.id}`,
      });
    }
    const summaries: MapSummary[] = [];
    for (const ref of project.maps) {
      const mapId = Schema.decodeUnknownSync(MapId)(ref.id);
      summaries.push(summaryFromMap(ref, yield* readVerifiedMap(projectDir, projectId, mapId)));
    }
    return summaries.sort((left, right) => left.path.localeCompare(right.path));
  });

const upsertMapLock = (
  entries: readonly MapIntegrityEntry[],
  next: MapIntegrityEntry,
): readonly MapIntegrityEntry[] => [...entries.filter((entry) => entry.id !== next.id), next];

const getProjectTrigger = (
  triggers: Map<ProjectId, PubSub.PubSub<void>>,
  projectId: ProjectId,
): Effect.Effect<PubSub.PubSub<void>> =>
  Effect.gen(function* () {
    const existing = triggers.get(projectId);
    if (existing) {
      return existing;
    }
    const created = yield* PubSub.unbounded<void>();
    triggers.set(projectId, created);
    return created;
  });

export const MapServiceLive = Layer.effect(
  MapService,
  Effect.gen(function* () {
    const home = yield* HomeService;
    const assets = yield* AssetService;
    const workingPalettes = yield* WorkingPaletteService;
    const paths = yield* home.init();
    const triggers = new Map<ProjectId, PubSub.PubSub<void>>();

    const cwd = process.cwd();

    const projectDirFor = (projectId: ProjectId) =>
      resolveProjectRootForId(paths.projects, cwd, projectId);

    const create = Effect.fn('MapService.create')(function* (
      projectId: ProjectId,
      spec: MapCreateSpec,
    ) {
      const projectDir = yield* projectDirFor(projectId);
      const project = yield* readVerifiedProjectAtRoot(projectDir);
      const mapId = newMapId();
      const map = makeTileborneMap({
        id: mapId,
        width: spec.width,
        height: spec.height,
        tileWidth: spec.tileWidth ?? 32,
        tileHeight: spec.tileHeight ?? 32,
        layers: [
          makeEditorTileLayer('terrain'),
          makeEditorTileLayer('props'),
          makeEditorTileLayer('entities'),
        ],
        properties: spec.properties ?? {},
      });
      yield* writeMapFile(mapPath(projectDir, mapId), map);
      const lock = yield* readProjectLock(projectLockPath(projectDir));
      const hash = hashMap(map);
      const mapRef = new ProjectMapRef({ id: mapId, path: relativeMapPath(mapId) });
      yield* writeProjectWithLock(
        projectDir,
        updateProjectMaps(project, [...project.maps, mapRef]),
        upsertMapLock(lock.maps, new MapIntegrityEntry({ id: mapId, path: mapRef.path, hash })),
      );
      yield* PubSub.publish(yield* getProjectTrigger(triggers, projectId), void 0);
      return mapId;
    });

    const load = Effect.fn('MapService.load')(function* (projectId: ProjectId, mapId: MapId) {
      const projectDir = yield* projectDirFor(projectId);
      return yield* readVerifiedMap(projectDir, projectId, mapId);
    });

    const save = Effect.fn('MapService.save')(function* (projectId: ProjectId, map: TileborneMap) {
      const projectDir = yield* projectDirFor(projectId);
      const project = yield* readVerifiedProjectAtRoot(projectDir);
      if (!project.maps.some((entry) => entry.id === map.id)) {
        yield* new MapNotFoundError({
          projectId,
          mapId: map.id,
          message: `map not found: ${map.id}`,
        });
      }
      yield* writeMapFile(mapPath(projectDir, map.id), map);
      const lock = yield* readProjectLock(projectLockPath(projectDir));
      const hash = hashMap(map);
      yield* writeProjectWithLock(
        projectDir,
        project,
        upsertMapLock(
          lock.maps,
          new MapIntegrityEntry({ id: map.id, path: relativeMapPath(map.id), hash }),
        ),
      );
      yield* PubSub.publish(yield* getProjectTrigger(triggers, projectId), void 0);
    });

    const setMapTilesetPack = Effect.fn('MapService.setMapTilesetPack')(function* (
      projectId: ProjectId,
      mapId: MapId,
      packId: PackId,
    ) {
      const pack = yield* assets.getPack(packId);
      if (!pack.capability.paintable) {
        yield* new MapTilesetPackNotPaintableError({
          projectId,
          mapId,
          packId,
          message: `asset pack is not paintable: ${packId}`,
        });
      }

      const projectDir = yield* projectDirFor(projectId);
      const project = yield* readVerifiedProjectAtRoot(projectDir);
      const ref = project.maps.find((entry) => entry.id === mapId);
      if (!ref) {
        yield* new MapNotFoundError({ projectId, mapId, message: `map not found: ${mapId}` });
      }
      const map = yield* readVerifiedMap(projectDir, projectId, mapId);
      const updated = new TileborneMap({
        id: map.id,
        schemaVersion: map.schemaVersion,
        size: map.size,
        tileSize: map.tileSize,
        layers: map.layers,
        objects: map.objects,
        properties: { ...map.properties, tilesetPackId: packId },
      });
      yield* save(projectId, updated);
      return summaryFromMap(ref as ProjectMapRef, updated);
    });

    const generate = Effect.fn('MapService.generate')(function* (
      projectId: ProjectId,
      spec: MapGenerateSpec,
    ) {
      yield* validateGenerateSpec(spec);
      let properties: TileborneMap['properties'] = {
        generated: true,
        preset: spec.preset,
        seed: spec.seed,
        ...(spec.tilesetPackId !== undefined ? { tilesetPackId: spec.tilesetPackId } : {}),
      };
      let layers: TileborneMap['layers'] = makeGeneratedLayers(
        spec.preset,
        spec.width,
        spec.height,
        spec.seed,
      );
      if (spec.tilesetPackId !== undefined) {
        const pack = yield* assets.getPack(spec.tilesetPackId);
        if (!pack.capability.paintable) {
          yield* new MapTilesetPackNotPaintableError({
            projectId,
            mapId: makeMapId('00000000-0000-4000-8000-000000000000' as Uuid),
            packId: spec.tilesetPackId,
            message: `asset pack is not paintable: ${spec.tilesetPackId}`,
          });
        }
        const tilesetPack = yield* readTilesetPackManifest(paths.assets, pack);
        const projection = projectGeneratedTerrainLayers({
          layers,
          pack: tilesetPack,
          preset: spec.preset,
          seed: spec.seed,
        });
        const blockingDiagnostic = projection.diagnostics.find(
          (diagnostic) => diagnostic.severity === 'error',
        );
        if (blockingDiagnostic !== undefined) {
          yield* new MapValidationError({
            path: '<generate>',
            message: blockingDiagnostic.message,
          });
        }
        layers = [...projection.layers];
        properties = {
          ...properties,
          tilesetProjection: projection.properties,
        };
      }
      const mapId = yield* create(projectId, {
        width: spec.width,
        height: spec.height,
        properties,
      });
      const generated = makeTileborneMap({
        id: mapId,
        width: spec.width,
        height: spec.height,
        tileWidth: 32,
        tileHeight: 32,
        layers,
        properties,
      });
      yield* save(projectId, generated);
      return yield* load(projectId, mapId);
    });

    const list = Effect.fn('MapService.list')(function* (projectId: ProjectId) {
      const projectDir = yield* projectDirFor(projectId);
      return yield* listVerifiedMapsAt(projectDir, projectId);
    });

    const deleteMap = Effect.fn('MapService.delete')(function* (
      projectId: ProjectId,
      mapId: MapId,
    ) {
      const projectDir = yield* projectDirFor(projectId);
      const project = yield* readVerifiedProjectAtRoot(projectDir);
      if (!project.maps.some((entry) => entry.id === mapId)) {
        yield* new MapNotFoundError({ projectId, mapId, message: `map not found: ${mapId}` });
      }
      yield* Effect.tryPromise({
        try: () => rm(mapPath(projectDir, mapId), { force: true }),
        catch: (cause) =>
          new MapSaveError({ path: mapPath(projectDir, mapId), message: errorMessage(cause) }),
      });
      const lock = yield* readProjectLock(projectLockPath(projectDir));
      yield* writeProjectWithLock(
        projectDir,
        updateProjectMaps(
          project,
          project.maps.filter((entry) => entry.id !== mapId),
        ),
        lock.maps.filter((entry) => entry.id !== mapId),
      );
      yield* PubSub.publish(yield* getProjectTrigger(triggers, projectId), void 0);
    });

    const exportToFile = Effect.fn('MapService.exportToFile')(function* (
      projectId: ProjectId,
      mapId: MapId,
      format: 'json' | 'tiled',
      destPath: string,
    ) {
      const projectDir = yield* projectDirFor(projectId);
      const map = yield* readVerifiedMap(projectDir, projectId, mapId);
      const payload = format === 'tiled' ? exportMapToTiled(map) : mapToJson(map);
      const resolvedDest = yield* verifiedChildPath(projectDir, destPath).pipe(
        Effect.mapError((error) => new MapSaveError({ path: destPath, message: error.message })),
      );
      yield* Effect.tryPromise({
        try: () => mkdir(path.dirname(resolvedDest), { recursive: true }),
        catch: (cause) => new MapSaveError({ path: resolvedDest, message: errorMessage(cause) }),
      });
      yield* writeJsonAtomic(resolvedDest, payload).pipe(
        Effect.mapError((error) => new MapSaveError({ path: error.path, message: error.message })),
      );
      return { mapId, format, out: resolvedDest };
    });

    const analyzeTiledImport = Effect.fn('MapService.analyzeTiledImport')(function* (
      projectId: ProjectId,
      srcPath: string,
    ) {
      const projectDir = yield* projectDirFor(projectId);
      const { sourcePath: resolvedSrc, importRoot } = yield* resolveTiledImportSource(projectDir, srcPath);
      const reader = makeTiledReader();
      const scanned = yield* Effect.tryPromise({
        try: () =>
          scanTiledSource({
            sourcePath: resolvedSrc,
            projectRoot: importRoot,
            reader,
          }),
        catch: (cause) =>
          new MapValidationError({ path: resolvedSrc, message: errorMessage(cause) }),
      });
      const blocking = scanned.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
      if (blocking !== undefined || scanned.scan === undefined) {
        yield* new MapValidationError({
          path: resolvedSrc,
          message: blocking?.message ?? 'Tiled scan failed',
        });
      }
      const scan = scanned.scan as TiledImportScan;
      return {
        sourceKind: importCenterSourceKind(scan),
        scan,
        diagnostics: scanned.diagnostics,
        inventoryPreview: inventoryPreview(scan),
      };
    });

    const scanTiledFile = Effect.fn('MapService.scanTiledFile')(function* (
      projectId: ProjectId,
      srcPath: string,
    ) {
      const analysis = yield* analyzeTiledImport(projectId, srcPath);
      return analysis.scan;
    });

    const planTiledImport = Effect.fn('MapService.planTiledImport')(function* (
      projectId: ProjectId,
      srcPath: string,
      options?: MapTiledImportOptions,
    ) {
      const analysis = yield* analyzeTiledImport(projectId, srcPath);
      const profile = yield* profileForTiledImport(analysis.scan, options?.profile);
      const plan = buildImportPlan(analysis.scan, profile, options?.hints ?? {});
      return {
        sourceKind: analysis.sourceKind,
        plan,
        diagnostics: [...analysis.diagnostics, ...plan.diagnostics],
        inventoryPreview: analysis.inventoryPreview,
      };
    });

    const importFromTiledFile = Effect.fn('MapService.importFromTiledFile')(function* (
      projectId: ProjectId,
      srcPath: string,
      options?: MapTiledImportOptions,
    ) {
      const projectDir = yield* projectDirFor(projectId);
      const { sourcePath: resolvedSrc, importRoot } = yield* resolveTiledImportSource(projectDir, srcPath);
      const reader = makeTiledReader();
      const scan = yield* scanTiledFile(projectId, srcPath);
      const profile = yield* profileForTiledImport(scan, options?.profile);
      const plan = buildImportPlan(scan, profile, options?.hints ?? {});
      const appliedPlan = applyImportPlan(plan);
      const planBlocking = appliedPlan.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
      if (planBlocking !== undefined) {
        yield* new MapValidationError({ path: resolvedSrc, message: planBlocking.message });
      }
      const imported = yield* Effect.tryPromise({
        try: async () => {
          const raw = isDirectTiledImportFile(resolvedSrc) ? await readFile(resolvedSrc, 'utf8') : undefined;
          return importTiled(
            {
              sourcePath: resolvedSrc,
              projectRoot: importRoot,
              reader,
              ...(raw === undefined ? {} : { raw }),
            },
            {
              packIdSeed: resolvedSrc,
              packName: path.basename(resolvedSrc, path.extname(resolvedSrc)),
              profile,
            },
          );
        },
        catch: (cause) =>
          new MapValidationError({ path: resolvedSrc, message: errorMessage(cause) }),
      });
      const blocking = imported.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
      if (blocking !== undefined || imported.value === undefined) {
        yield* new MapValidationError({
          path: resolvedSrc,
          message: blocking?.message ?? 'Tiled import failed',
        });
      }
      const value = imported.value!;
      const sourceIdentity = yield* sourceIdentityFor(importCenterSourceKind(appliedPlan.scan), resolvedSrc);
      const sourceRoot = sourceRootForImport(value, resolvedSrc, importRoot);
      const importedPackId =
        value.kind === 'map' && value.pack.assets.length === 0
          ? undefined
          : yield* materializeImportedPack(
              {
                plan: appliedPlan,
                value,
                sourceRoot,
                resolvedSrc,
                projectId,
              },
              { home, assets, workingPalettes },
      );
      if (value.kind !== 'map') {
        if (importedPackId === undefined) {
          return yield* new MapValidationError({
            path: resolvedSrc,
            message: 'Tiled asset-pack import produced no pack.',
          });
        }
        const report = buildApplyReport({
          sourceIdentity,
          appliedPlan,
          outputs: { kind: 'asset-pack', packId: importedPackId },
        });
        yield* appendProjectImportRecord(projectDir, {
          id: report.importRecordId,
          projectId,
          createdAt: report.sourceIdentity.detectedAt,
          sourceIdentity,
          appliedPlan,
          report,
        });
        return {
          kind: 'asset-pack' as const,
          packId: importedPackId,
          report,
        };
      }
      const mapId = newMapId();
      const map = new TileborneMap({
        id: mapId,
        schemaVersion: value.map.schemaVersion,
        size: value.map.size,
        tileSize: value.map.tileSize,
        layers: value.map.layers,
        objects: value.map.objects,
        properties: {
          ...value.map.properties,
          tiledSourcePath: srcPath,
          tiledImportProfile: typeof profile === 'string' ? profile : profile.id,
          ...(importedPackId === undefined ? {} : { tilesetPackId: importedPackId }),
        },
      });
      const project = yield* readVerifiedProjectAtRoot(projectDir);
      yield* writeMapFile(mapPath(projectDir, mapId), map);
      const lock = yield* readProjectLock(projectLockPath(projectDir));
      const hash = hashMap(map);
      const mapRef = new ProjectMapRef({ id: mapId, path: relativeMapPath(mapId) });
      yield* writeProjectWithLock(
        projectDir,
        updateProjectMaps(project, [...project.maps, mapRef]),
        upsertMapLock(lock.maps, new MapIntegrityEntry({ id: mapId, path: mapRef.path, hash })),
      );
      const report = buildApplyReport({
        sourceIdentity,
        appliedPlan,
        outputs: {
          kind: 'map',
          mapId,
          layerCount: map.layers.length,
          objectCount: map.objects.length,
          ...(importedPackId === undefined ? {} : { packId: importedPackId }),
        },
      });
      yield* appendProjectImportRecord(projectDir, {
        id: report.importRecordId,
        projectId,
        createdAt: report.sourceIdentity.detectedAt,
        sourceIdentity,
        appliedPlan,
        report,
      });
      yield* PubSub.publish(yield* getProjectTrigger(triggers, projectId), void 0);
      return {
        kind: 'map' as const,
        mapId,
        layerCount: map.layers.length,
        objectCount: map.objects.length,
        ...(importedPackId === undefined ? {} : { packId: importedPackId }),
        report,
      };
    });

    const importFromTiledFolder = Effect.fn('MapService.importFromTiledFolder')(function* (
      projectId: ProjectId,
      srcPath: string,
      options?: MapTiledImportOptions,
    ) {
      return yield* importFromTiledFile(projectId, srcPath, options);
    });

    const subscribe = (
      projectId: ProjectId,
    ): Stream.Stream<readonly MapSummary[], MapServiceError> =>
      Stream.unwrap(
        getProjectTrigger(triggers, projectId).pipe(
          Effect.map((trigger) =>
            Stream.concat(
              Stream.fromEffect(
                projectDirFor(projectId).pipe(
                  Effect.flatMap((projectDir) => listVerifiedMapsAt(projectDir, projectId)),
                ),
              ),
              Stream.fromPubSub(trigger).pipe(
                Stream.mapEffect(() =>
                  projectDirFor(projectId).pipe(
                    Effect.flatMap((projectDir) => listVerifiedMapsAt(projectDir, projectId)),
                  ),
                ),
              ),
            ),
          ),
        ),
      );

    return {
      create,
      generate,
      load,
      save,
      setMapTilesetPack,
      list,
      delete: deleteMap,
      subscribe,
      exportToFile,
      importFromTiledFile,
      importFromTiledFolder,
      scanTiledFile,
      analyzeTiledImport,
      planTiledImport,
    };
  }),
);
