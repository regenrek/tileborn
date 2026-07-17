import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  AssetPackCapabilityLock,
  AssetFileIntegrityEntry,
  AssetPackIntegrityLock,
  MapIntegrityEntry,
  mapPath,
  packDirectory,
  packsRoot,
  projectLockPath,
  projectManifestPath,
} from '../internal/layout.js';
import {
  encodeJson,
  errorMessage,
  isNotFound,
  readJson,
  removePath,
  replaceDirectory,
} from '../internal/files.js';
import {
  AssetPackManifest,
  AssetPackManifestAsset,
  assetPackManifestToJson,
  hashAssetPackManifest,
  indexPack,
  validatePackManifest,
  type AssetPackFile,
} from '@tileborne/asset-pipeline';
import {
  assertWithinRoot,
  rejectPathTraversal,
  rejectSymlinkEscape,
} from '@tileborne/asset-pipeline';
import {
  ContentHash,
  MapId,
  PackCapability,
  PackDuplicateIdDiagnostic,
  PackId,
  PERSISTED_SCHEMA_VERSIONS,
  type PackCapabilityDiagnostic,
  ProjectId,
  ProjectManifest,
  ProjectManifestSchema,
  decodePersistedTileborneMapJson,
  hashBytes,
  hashJsonStable,
} from '@tileborne/core';
import {
  ConfigService,
  HomeService,
  JobId,
  JobService,
  writeJsonAtomic,
  type ConfigServiceError,
  type HomeServiceError,
} from '@tileborne/services-foundation';
import { Context, Effect, Layer, Option, PubSub, Result, Schema, Stream } from 'effect';
import { importTiledSource } from '@tileborne/sdk-tileset/importers/tiled-source';
import {
  importSpriteSheet,
  type ImportSpriteSheetInput,
  type SpriteAnchorName,
  type SpriteSheetClipInput,
  type SpriteSheetPlayerModelMetadata,
  type SpriteSheetSliceConfig,
} from '@tileborne/sdk-tileset/importers/sprite-sheet';
import { writeTilesetManifest, type ManifestProvenance } from '@tileborne/sdk-tileset/manifest';
import type { TiledSourceInventory } from '@tileborne/sdk-tileset/tiled';
import type { TilesetPack } from '@tileborne/sdk-tileset/schemas';

import {
  ProjectMigrationError,
  ProjectNotFoundError,
  ProjectSaveError,
  ProjectValidationError,
  readProjectLock,
  readVerifiedProjectAtRoot,
  writeProjectWithLock,
} from '../project/index.js';
import {
  PackCapabilityProbeError,
  probePackCapabilityWithIntegrity,
  readPackCapabilityIntegrityHash,
} from './capability.js';
import { readProjectRegistry } from '../internal/project-registry.js';

export class DirectoryAssetPackSource extends Schema.TaggedClass<DirectoryAssetPackSource>()(
  'directory',
  {
    path: Schema.String,
  },
) {}

export class TarballAssetPackSource extends Schema.TaggedClass<TarballAssetPackSource>()(
  'tarball',
  {
    path: Schema.String,
  },
) {}

export const AssetPackSource = Schema.Union([DirectoryAssetPackSource, TarballAssetPackSource]);
export type AssetPackSource = Schema.Schema.Type<typeof AssetPackSource>;

export class AssetIndexEntry extends Schema.Class<AssetIndexEntry>('AssetIndexEntry')({
  packId: PackId,
  version: Schema.String,
  assetCount: Schema.Number,
  manifestHash: ContentHash,
}) {}

export class ProjectAssetIndex extends Schema.Class<ProjectAssetIndex>('ProjectAssetIndex')({
  schemaVersion: Schema.Literal(PERSISTED_SCHEMA_VERSIONS.projectAssetIndex),
  projectId: ProjectId,
  packs: Schema.Array(AssetIndexEntry),
}) {}

export class AssetReindexResult extends Schema.Class<AssetReindexResult>('AssetReindexResult')({
  projectPath: Schema.String,
  indexPath: Schema.String,
  packs: Schema.Array(AssetIndexEntry),
}) {}

export class AssetImportError extends Schema.TaggedErrorClass<AssetImportError>()(
  'AssetImportError',
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

export class AssetIntegrityError extends Schema.TaggedErrorClass<AssetIntegrityError>()(
  'AssetIntegrityError',
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

export class AssetPackNotFoundError extends Schema.TaggedErrorClass<AssetPackNotFoundError>()(
  'AssetPackNotFoundError',
  {
    packId: PackId,
    message: Schema.String,
  },
) {}

export type AssetServiceError =
  | AssetImportError
  | AssetIntegrityError
  | AssetPackNotFoundError
  | PackCapabilityProbeError
  | ProjectMigrationError
  | ProjectNotFoundError
  | ProjectSaveError
  | ProjectValidationError
  | HomeServiceError
  | ConfigServiceError;

export type AssetPackWithCapability = AssetPackManifest & {
  readonly capability: PackCapability;
};

/** Input for materializing a single sprite-sheet image into an installed pack. */
export interface SpriteSheetImportInput {
  /** Raw image bytes to persist as the atlas asset. */
  readonly imageBytes: Uint8Array;
  /** Image file name (relative path inside the pack, e.g. `hero.png`). */
  readonly imageFileName: string;
  readonly mime: string;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly slice: SpriteSheetSliceConfig;
  readonly spriteName?: string;
  readonly anchor?: SpriteAnchorName;
  readonly packName?: string;
  readonly clips?: readonly SpriteSheetClipInput[];
  readonly playerModel?: SpriteSheetPlayerModelMetadata | undefined;
  /** Pre-decoded Aseprite JSON sidecar (drives slicing + clips when present). */
  readonly aseprite?: unknown;
}

export interface PackCapabilityRefreshed {
  readonly packId: PackId;
  readonly capability: PackCapability;
}

export class AssetService extends Context.Service<
  AssetService,
  {
    readonly importPack: (source: AssetPackSource) => Effect.Effect<JobId, AssetServiceError>;
    readonly importPackNow: (source: AssetPackSource) => Effect.Effect<PackId, AssetServiceError>;
    readonly importTiledSourcePack: (sourceRoot: string) => Effect.Effect<JobId, AssetServiceError>;
    readonly importTiledSourcePackNow: (
      sourceRoot: string,
    ) => Effect.Effect<PackId, AssetServiceError>;
    readonly importSpriteSheetPackNow: (
      input: SpriteSheetImportInput,
    ) => Effect.Effect<PackId, AssetServiceError>;
    readonly listPacks: () => Effect.Effect<readonly AssetPackWithCapability[], AssetServiceError>;
    readonly getPack: (packId: PackId) => Effect.Effect<AssetPackWithCapability, AssetServiceError>;
    readonly describePack: (packId: PackId) => Effect.Effect<
      {
        readonly pack: AssetPackWithCapability;
        readonly capability: PackCapability;
        readonly diagnostics: readonly PackCapabilityDiagnostic[];
      },
      AssetServiceError
    >;
    readonly removePack: (packId: PackId) => Effect.Effect<void, AssetServiceError>;
    readonly listProjectPacks: (
      projectSlug?: string | undefined,
    ) => Effect.Effect<readonly AssetPackWithCapability[], AssetServiceError>;
    readonly reindex: (
      projectSlug?: string | undefined,
    ) => Effect.Effect<AssetReindexResult, AssetServiceError>;
    readonly subscribe: Stream.Stream<readonly AssetPackWithCapability[], AssetServiceError>;
    readonly subscribeCapability: Stream.Stream<PackCapabilityRefreshed, AssetServiceError>;
  }
>()('@tileborne/services-app/AssetService') {}

const PROJECT_DERIVED_DIR = '.tileborne/derived';
const ASSET_INDEX_FILE = 'asset-index.json';

const manifestJsonSchema = AssetPackManifest as Schema.Codec<
  AssetPackManifest,
  unknown,
  never,
  never
>;
const MANIFEST_FILENAME = 'tileborne-asset-pack.json';
const LOCK_FILENAME = 'lock.json';
const MISSING_PACK_MANIFEST_MESSAGE =
  'This folder is not a Tileborne asset pack. Choose a folder containing tileborne-asset-pack.json.';
const MISSING_TILED_SOURCE_MANIFEST_MESSAGE =
  'This folder contains raw Tiled source files, not a Tileborne asset pack. Use the Tiled import panel with a .tmx/.tmj map file, or choose a folder containing tileborne-asset-pack.json.';

const noNulPath = (rootPath: string, candidatePath: string): string => {
  if (candidatePath.includes('\0')) {
    throw new Error(`NUL path segment is not allowed: ${candidatePath}`);
  }
  return rejectPathTraversal(rootPath, candidatePath);
};

function verifiedInPackPath(
  packRoot: string,
  relativeName: string,
  errorKind: 'import',
): Effect.Effect<string, AssetImportError>;
function verifiedInPackPath(
  packRoot: string,
  relativeName: string,
  errorKind?: 'integrity',
): Effect.Effect<string, AssetIntegrityError>;
function verifiedInPackPath(
  packRoot: string,
  relativeName: string,
  errorKind: 'integrity' | 'import' = 'integrity',
): Effect.Effect<string, AssetIntegrityError | AssetImportError> {
  const makeError = (
    targetPath: string,
    message: string,
  ): AssetIntegrityError | AssetImportError =>
    errorKind === 'import'
      ? new AssetImportError({ path: targetPath, message })
      : new AssetIntegrityError({ path: targetPath, message });

  return Effect.gen(function* () {
    const resolved = yield* Effect.try({
      try: () => {
        noNulPath(packRoot, relativeName);
        return assertWithinRoot(packRoot, relativeName);
      },
      catch: (cause) => makeError(relativeName, errorMessage(cause)),
    });
    return yield* Effect.tryPromise({
      try: async () => {
        try {
          return await rejectSymlinkEscape(packRoot, relativeName);
        } catch (cause) {
          if (isNotFound(cause)) {
            return resolved;
          }
          throw cause;
        }
      },
      catch: (cause) => makeError(relativeName, errorMessage(cause)),
    });
  });
}

const TILED_SOURCE_EXTENSIONS = new Set(['.tmx', '.tmj', '.tsx', '.tsj']);
const TILED_MAP_EXTENSIONS = new Set(['.tmx', '.tmj']);
const TILED_TILESET_EXTENSIONS = new Set(['.tsx', '.tsj']);

type TiledSourceInputFiles = {
  readonly mapFiles: readonly string[];
  readonly tsxFiles: readonly string[];
  readonly ruleFiles: readonly string[];
};

const containsTiledSourceFile = async (rootPath: string, maxDepth = 3): Promise<boolean> => {
  const scan = async (directory: string, depth: number): Promise<boolean> => {
    try {
      const entries = await readdir(directory, { withFileTypes: true, encoding: 'utf8' });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) {
          continue;
        }
        const entryPath = path.join(directory, entry.name);
        if (entry.isFile() && TILED_SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          return true;
        }
        if (entry.isDirectory() && depth > 0 && (await scan(entryPath, depth - 1))) {
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  };
  return scan(rootPath, maxDepth);
};

const discoverTiledSourceInputFiles = async (
  rootPath: string,
  maxDepth = 6,
): Promise<TiledSourceInputFiles> => {
  const mapFiles: string[] = [];
  const tsxFiles: string[] = [];
  const ruleFiles: string[] = [];
  const root = path.resolve(rootPath);

  const scan = async (directory: string, depth: number): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true, encoding: 'utf8' });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue;
      }
      const entryPath = path.join(directory, entry.name);
      const relative = path.relative(root, entryPath).split(path.sep).join('/');
      if (entry.isDirectory()) {
        if (depth > 0) {
          await scan(entryPath, depth - 1);
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const extension = path.extname(entry.name).toLowerCase();
      if (relative.toLowerCase().endsWith('/rules.txt') || relative.toLowerCase() === 'rules.txt') {
        ruleFiles.push(relative);
      } else if (TILED_MAP_EXTENSIONS.has(extension)) {
        if (relative.split('/').some((segment) => segment.toLowerCase() === 'rules')) {
          ruleFiles.push(relative);
        } else {
          mapFiles.push(relative);
        }
      } else if (TILED_TILESET_EXTENSIONS.has(extension)) {
        tsxFiles.push(relative);
      }
    }
  };

  await scan(root, maxDepth);
  return {
    mapFiles: mapFiles.sort(),
    tsxFiles: tsxFiles.sort(),
    ruleFiles: ruleFiles.sort(),
  };
};

const missingSourceManifestError = (
  sourceRoot: string,
  manifestPath: string,
): Effect.Effect<AssetImportError> =>
  Effect.tryPromise({
    try: async () => ({
      containsTiledSource: await containsTiledSourceFile(sourceRoot),
    }),
    catch: () => ({ containsTiledSource: false }),
  }).pipe(
    Effect.catch(() => Effect.succeed({ containsTiledSource: false })),
    Effect.map(({ containsTiledSource }) => {
      const message = containsTiledSource
        ? MISSING_TILED_SOURCE_MANIFEST_MESSAGE
        : MISSING_PACK_MANIFEST_MESSAGE;
      return new AssetImportError({ path: manifestPath, message });
    }),
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const rawLicenseIntegrityJson = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) {
    return {};
  }
  const json: Record<string, unknown> = {};
  for (const key of ['spdxId', 'attribution', 'sourceUrl', 'notes', 'redistributable']) {
    if (key in value) {
      json[key] = value[key];
    }
  }
  return json;
};

const rawAssetIntegrityJson = (value: unknown): Record<string, unknown> => {
  const asset: Record<string, unknown> = isRecord(value) ? value : {};
  return {
    id: asset.id,
    path: asset.path,
    mime: asset.mime,
    size: asset.size,
    hash: asset.hash,
    ...('license' in asset ? { license: rawLicenseIntegrityJson(asset.license) } : {}),
  };
};

const rawAssetPackManifestIntegrityJson = (value: unknown): Record<string, unknown> => {
  const manifest: Record<string, unknown> = isRecord(value) ? value : {};
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    license: rawLicenseIntegrityJson(manifest.license),
    assets: Array.isArray(manifest.assets) ? manifest.assets.map(rawAssetIntegrityJson) : [],
  };
};

const hashRawAssetPackManifestIntegrityJson = (value: unknown): ContentHash =>
  hashJsonStable(rawAssetPackManifestIntegrityJson(value));

interface ManifestReadResult {
  readonly filePath: string;
  readonly manifest: AssetPackManifest;
  readonly rawJson: unknown;
}

const readManifestSnapshot = (
  packRoot: string,
): Effect.Effect<ManifestReadResult, AssetIntegrityError> =>
  Effect.gen(function* () {
    const filePath = yield* verifiedInPackPath(packRoot, MANIFEST_FILENAME);
    const raw = yield* Effect.tryPromise({
      try: () => readFile(filePath, 'utf8'),
      catch: (cause) => new AssetIntegrityError({ path: filePath, message: errorMessage(cause) }),
    });
    const parsed = yield* Effect.try({
      try: (): unknown => JSON.parse(raw),
      catch: (cause) => new AssetIntegrityError({ path: filePath, message: errorMessage(cause) }),
    });
    const manifest = yield* Effect.try({
      try: () => Schema.decodeUnknownSync(manifestJsonSchema)(parsed) as AssetPackManifest,
      catch: (cause) => new AssetIntegrityError({ path: filePath, message: errorMessage(cause) }),
    });
    return { filePath, manifest, rawJson: parsed };
  });

const hasLegacyCapabilityWithoutPlaceableCount = (value: unknown): boolean => {
  if (!isRecord(value)) {
    return false;
  }
  const capabilityLock = value.capability;
  if (!isRecord(capabilityLock)) {
    return false;
  }
  const capability = capabilityLock.capability;
  return isRecord(capability) && !('placeableCount' in capability);
};

const dropLegacyCapabilityCache = (value: unknown): unknown => {
  if (!isRecord(value)) {
    return value;
  }
  const next = { ...value };
  delete next.capability;
  return next;
};

const legacyCapabilityDiagnosticSeverity = (tag: unknown): 'error' | 'warning' | undefined => {
  switch (tag) {
    case 'PACK.no-tilesets':
    case 'PACK.flip-flag-dropped':
      return 'warning';
    case 'PACK.duplicate-id':
    case 'PACK.unsupported-schema':
    case 'PACK.missing-asset':
      return 'error';
    default:
      return undefined;
  }
};

/**
 * v6 capability locks predate diagnostic severity. Normalize only this durable
 * persistence shape before strict schema decoding; IPC/wire contracts continue
 * to require severity and the v7 integrity hash then forces a fresh SDK probe.
 */
const migrateLegacyCapabilityDiagnosticSeverities = (value: unknown): unknown => {
  if (!isRecord(value) || !isRecord(value.capability) || !isRecord(value.capability.capability)) {
    return value;
  }
  const capability = value.capability.capability;
  if (!Array.isArray(capability.diagnostics)) {
    return value;
  }
  let changed = false;
  const diagnostics = capability.diagnostics.map((diagnostic) => {
    if (!isRecord(diagnostic) || 'severity' in diagnostic) {
      return diagnostic;
    }
    const severity = legacyCapabilityDiagnosticSeverity(diagnostic._tag);
    if (severity === undefined) {
      return diagnostic;
    }
    changed = true;
    return { ...diagnostic, severity };
  });
  return changed
    ? {
        ...value,
        capability: {
          ...value.capability,
          capability: { ...capability, diagnostics },
        },
      }
    : value;
};

const decodePackLock = (
  filePath: string,
  value: unknown,
): Effect.Effect<AssetPackIntegrityLock, AssetIntegrityError> =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(AssetPackIntegrityLock)(value),
    catch: (cause) => new AssetIntegrityError({ path: filePath, message: errorMessage(cause) }),
  });

const readPackLock = (
  packRoot: string,
): Effect.Effect<AssetPackIntegrityLock, AssetIntegrityError> =>
  Effect.gen(function* () {
    const filePath = yield* verifiedInPackPath(packRoot, LOCK_FILENAME);
    const raw = yield* Effect.tryPromise({
      try: () => readFile(filePath, 'utf8'),
      catch: (cause) => new AssetIntegrityError({ path: filePath, message: errorMessage(cause) }),
    });
    const parsed = yield* Effect.try({
      try: (): unknown => JSON.parse(raw),
      catch: (cause) => new AssetIntegrityError({ path: filePath, message: errorMessage(cause) }),
    });
    return yield* decodePackLock(
      filePath,
      migrateLegacyCapabilityDiagnosticSeverities(parsed),
    ).pipe(
      Effect.catch((error) =>
        hasLegacyCapabilityWithoutPlaceableCount(parsed)
          ? decodePackLock(filePath, dropLegacyCapabilityCache(parsed))
          : Effect.fail(error),
      ),
    );
  });

const assetFilePath = (
  packRoot: string,
  asset: AssetPackManifestAsset,
): Effect.Effect<string, AssetIntegrityError> =>
  Effect.gen(function* () {
    yield* Effect.try({
      try: () => {
        noNulPath(packRoot, asset.path);
        return assertWithinRoot(packRoot, asset.path);
      },
      catch: (cause) => new AssetIntegrityError({ path: asset.path, message: errorMessage(cause) }),
    });
    return yield* Effect.tryPromise({
      try: () => rejectSymlinkEscape(packRoot, asset.path),
      catch: (cause) => new AssetIntegrityError({ path: asset.path, message: errorMessage(cause) }),
    });
  });

const readAssetFiles = (
  packRoot: string,
  manifest: AssetPackManifest,
): Effect.Effect<readonly AssetPackFile[], AssetIntegrityError> =>
  Effect.gen(function* () {
    const files: AssetPackFile[] = [];
    for (const asset of manifest.assets) {
      const resolved = yield* assetFilePath(packRoot, asset);
      const bytes = yield* Effect.tryPromise({
        try: () => readFile(resolved),
        catch: (cause) => new AssetIntegrityError({ path: resolved, message: errorMessage(cause) }),
      });
      files.push({
        path: asset.path,
        filename: asset.path,
        mime: asset.mime,
        bytes,
      });
    }
    return files;
  });

const resultToEffect = <A, E>(result: Result.Result<A, E>): Effect.Effect<A, E> =>
  Result.match(result, {
    onFailure: (error) => Effect.fail(error),
    onSuccess: (value) => Effect.succeed(value),
  });

const validateManifestAndFiles = (
  manifest: AssetPackManifest,
  files: readonly AssetPackFile[],
): Effect.Effect<AssetPackManifest, AssetIntegrityError> =>
  resultToEffect(validatePackManifest(manifest, files)).pipe(
    Effect.mapError(
      (error) =>
        new AssetIntegrityError({
          path: 'tileborne-asset-pack.json',
          message: errorMessage(error),
        }),
    ),
  );

const makePackLock = (
  manifest: AssetPackManifest,
  files: readonly AssetPackFile[],
  capability?: PackCapability | undefined,
  capabilityIntegrityHash?: ContentHash | undefined,
): AssetPackIntegrityLock =>
  new AssetPackIntegrityLock({
    schemaVersion: 1,
    packId: manifest.id,
    version: manifest.version,
    manifestHash: hashAssetPackManifest(manifest),
    files: files.map(
      (file) => new AssetFileIntegrityEntry({ path: file.path, hash: hashBytes(file.bytes) }),
    ),
    capability:
      capability === undefined
        ? Option.none()
        : Option.some(
            new AssetPackCapabilityLock({
              integrityHash: capabilityIntegrityHash ?? hashAssetPackManifest(manifest),
              capability,
            }),
          ),
  });

const withCapability = (
  manifest: AssetPackManifest,
  capability: PackCapability,
): AssetPackWithCapability =>
  Object.assign(Object.create(Object.getPrototypeOf(manifest)) as AssetPackManifest, manifest, {
    capability,
  });

const appendCapabilityDiagnostics = (
  capability: PackCapability,
  diagnostics: readonly PackCapabilityDiagnostic[],
): PackCapability =>
  diagnostics.length === 0
    ? capability
    : new PackCapability({
        packId: capability.packId,
        paintable: capability.paintable,
        tilesetCount: capability.tilesetCount,
        tileCount: capability.tileCount,
        placeableCount: capability.placeableCount,
        autotileRuleCount: capability.autotileRuleCount,
        terrainClassCount: capability.terrainClassCount,
        hasAnimations: capability.hasAnimations,
        hasCollisionMasks: capability.hasCollisionMasks,
        schemaVersion: capability.schemaVersion,
        source: capability.source,
        diagnostics: [...capability.diagnostics, ...diagnostics],
      });

const duplicatePackDiagnostics = (
  installedPacks: readonly AssetPackWithCapability[],
  manifest: AssetPackManifest,
): readonly PackCapabilityDiagnostic[] => {
  const newIntegrityHash = hashAssetPackManifest(manifest);
  return installedPacks
    .filter((pack) => pack.id === manifest.id)
    .map((pack) => {
      const integrityHashesMatch = hashAssetPackManifest(pack) === newIntegrityHash;
      return new PackDuplicateIdDiagnostic({
        severity: 'error',
        packId: manifest.id,
        existingPackId: pack.id,
        newPackId: manifest.id,
        integrityHashesMatch,
        message: integrityHashesMatch
          ? `Asset pack id already installed with matching integrity: ${manifest.id}`
          : `Asset pack id already installed with different integrity: ${manifest.id}`,
      });
    });
};

const writePackLock = (
  packRoot: string,
  lock: AssetPackIntegrityLock,
): Effect.Effect<void, AssetIntegrityError> =>
  Effect.gen(function* () {
    const encodedLock = yield* encodeJson(
      AssetPackIntegrityLock,
      lock,
      (message) => new AssetIntegrityError({ path: path.join(packRoot, LOCK_FILENAME), message }),
    );
    const lockPath = yield* verifiedInPackPath(packRoot, LOCK_FILENAME);
    yield* writeJsonAtomic(lockPath, encodedLock).pipe(
      Effect.mapError(
        (error) => new AssetIntegrityError({ path: error.path, message: error.message }),
      ),
    );
  });

const refreshPackLockManifestHash = (
  packRoot: string,
  lock: AssetPackIntegrityLock,
  manifestHash: ContentHash,
): Effect.Effect<AssetPackIntegrityLock, AssetIntegrityError> =>
  Effect.gen(function* () {
    const nextLock = new AssetPackIntegrityLock({
      schemaVersion: lock.schemaVersion,
      packId: lock.packId,
      version: lock.version,
      manifestHash,
      files: lock.files,
      capability: lock.capability,
    });
    yield* writePackLock(packRoot, nextLock);
    yield* Effect.logInfo(
      `Refreshed asset pack lock manifest hash for ${lock.packId}@${lock.version}: ${lock.manifestHash} -> ${manifestHash}`,
    );
    return nextLock;
  });

const cachedCapability = (
  lock: AssetPackIntegrityLock,
  integrityHash: ContentHash,
): PackCapability | undefined => {
  const entry = Option.getOrUndefined(lock.capability);
  if (entry?.integrityHash !== integrityHash) {
    return undefined;
  }
  return entry.capability;
};

const ensurePackCapabilityCached = (
  packRoot: string,
  manifest: AssetPackManifest,
): Effect.Effect<
  {
    readonly capability: PackCapability;
    readonly refreshed: boolean;
  },
  AssetServiceError
> =>
  Effect.gen(function* () {
    const lock = yield* readPackLock(packRoot);
    const manifestPath = yield* verifiedInPackPath(packRoot, MANIFEST_FILENAME);
    const integrityHash = yield* readPackCapabilityIntegrityHash({ manifestPath });
    const cached = cachedCapability(lock, integrityHash);
    if (cached !== undefined) {
      return { capability: cached, refreshed: false };
    }

    const probe = yield* probePackCapabilityWithIntegrity({ packId: manifest.id, manifestPath });
    const capability = probe.capability;
    const nextLock = new AssetPackIntegrityLock({
      schemaVersion: lock.schemaVersion,
      packId: lock.packId,
      version: lock.version,
      manifestHash: lock.manifestHash,
      files: lock.files,
      capability: Option.some(
        new AssetPackCapabilityLock({ integrityHash: probe.integrityHash, capability }),
      ),
    });
    yield* writePackLock(packRoot, nextLock);
    return { capability, refreshed: true };
  });

export const readVerifiedPackAt = (
  packRoot: string,
): Effect.Effect<AssetPackManifest, AssetIntegrityError> =>
  Effect.gen(function* () {
    const { filePath: manifestPath, manifest, rawJson } = yield* readManifestSnapshot(packRoot);
    const lock = yield* readPackLock(packRoot);
    if (lock.packId !== manifest.id || lock.version !== manifest.version) {
      yield* new AssetIntegrityError({
        path: path.join(packRoot, LOCK_FILENAME),
        message: 'pack lock identity mismatch',
      });
    }
    const actualManifestHash = hashAssetPackManifest(manifest);
    const files = yield* readAssetFiles(packRoot, manifest);
    const lockedFiles = new Map(lock.files.map((file) => [file.path, file.hash] as const));
    for (const file of files) {
      const expected = lockedFiles.get(file.path);
      const actual = hashBytes(file.bytes);
      if (expected !== actual) {
        yield* new AssetIntegrityError({
          path: file.path,
          message: `asset integrity mismatch: expected ${expected ?? '<missing>'} got ${actual}`,
        });
      }
    }
    const verified = yield* validateManifestAndFiles(manifest, files);
    if (lock.manifestHash !== actualManifestHash) {
      const rawManifestHash = hashRawAssetPackManifestIntegrityJson(rawJson);
      if (lock.manifestHash !== rawManifestHash) {
        yield* new AssetIntegrityError({
          path: manifestPath,
          message: `manifest integrity mismatch: expected ${lock.manifestHash} got ${actualManifestHash}`,
        });
      }
      yield* refreshPackLockManifestHash(packRoot, lock, actualManifestHash);
    }
    return verified;
  });

const readVerifiedPackWithCapabilityAt = (
  packRoot: string,
): Effect.Effect<
  {
    readonly pack: AssetPackWithCapability;
    readonly refreshed: boolean;
  },
  AssetServiceError
> =>
  Effect.gen(function* () {
    const manifest = yield* readVerifiedPackAt(packRoot);
    const { capability, refreshed } = yield* ensurePackCapabilityCached(packRoot, manifest);
    return { pack: withCapability(manifest, capability), refreshed };
  });

const readSourcePack = (
  sourceRoot: string,
): Effect.Effect<
  {
    readonly manifest: AssetPackManifest;
    readonly files: readonly AssetPackFile[];
  },
  AssetImportError
> =>
  Effect.gen(function* () {
    const manifest = yield* readSourceManifest(sourceRoot);
    const files = yield* readAssetFiles(sourceRoot, manifest).pipe(
      Effect.mapError(
        (error) => new AssetImportError({ path: error.path, message: error.message }),
      ),
    );
    yield* validateManifestAndFiles(manifest, files).pipe(
      Effect.mapError(
        (error) => new AssetImportError({ path: error.path, message: error.message }),
      ),
    );
    return { manifest, files };
  });

const readSourceManifest = (
  sourceRoot: string,
): Effect.Effect<AssetPackManifest, AssetImportError> =>
  Effect.gen(function* () {
    const filePath = yield* verifiedInPackPath(sourceRoot, MANIFEST_FILENAME, 'import');
    const raw = yield* Effect.tryPromise({
      try: () => readFile(filePath, 'utf8'),
      catch: (cause) => cause,
    }).pipe(
      Effect.catch((cause) =>
        isNotFound(cause)
          ? missingSourceManifestError(sourceRoot, filePath).pipe(
              Effect.flatMap((error) => Effect.fail(error)),
            )
          : Effect.fail(new AssetImportError({ path: filePath, message: errorMessage(cause) })),
      ),
    );
    const parsed = yield* Effect.try({
      try: (): unknown => JSON.parse(raw),
      catch: (cause) => new AssetImportError({ path: filePath, message: errorMessage(cause) }),
    });
    return yield* Effect.try({
      try: () => Schema.decodeUnknownSync(manifestJsonSchema)(parsed) as AssetPackManifest,
      catch: (cause) => new AssetImportError({ path: filePath, message: errorMessage(cause) }),
    });
  });

const preflightImportSource = (source: AssetPackSource): Effect.Effect<void, AssetImportError> =>
  source._tag === 'directory'
    ? Effect.gen(function* () {
        const sourceRoot = path.resolve(source.path);
        yield* Effect.tryPromise({
          try: () => stat(sourceRoot),
          catch: (cause) =>
            new AssetImportError({ path: sourceRoot, message: errorMessage(cause) }),
        });
        yield* readSourceManifest(sourceRoot).pipe(Effect.asVoid);
      })
    : Effect.void;

const runTarCommand = (args: readonly string[], cwd: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn('tar', [...args], { cwd, stdio: 'ignore' });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`tar exited with ${code ?? 'unknown'}`));
      }
    });
  });

const extractAssetArchive = (
  archivePath: string,
  targetPath: string,
): Effect.Effect<void, AssetImportError> =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => mkdir(targetPath, { recursive: true }),
      catch: (cause) => new AssetImportError({ path: targetPath, message: errorMessage(cause) }),
    });
    yield* Effect.tryPromise({
      try: () => runTarCommand(['-xzf', archivePath, '-C', targetPath], path.dirname(targetPath)),
      catch: (cause) => new AssetImportError({ path: archivePath, message: errorMessage(cause) }),
    });
  });

const tileborneTiledSourceLicenseJson = (sourceRoot: string) =>
  ({
    spdxId: 'UNKNOWN',
    attribution: 'Imported from Tiled source',
    notes: sourceRoot,
    redistributable: false,
  }) as const;

const resolveContainedAssetPath = (
  rootPath: string,
  assetPath: string,
  error: (message: string) => AssetImportError,
): string => {
  try {
    noNulPath(rootPath, assetPath);
    return assertWithinRoot(rootPath, assetPath);
  } catch (cause) {
    throw error(errorMessage(cause));
  }
};

const manifestWithTilesetAssetIntegrity = async (
  pack: TilesetPack,
  sourceRoot: string,
  stagingDir: string,
  provenance: ManifestProvenance,
  sourceInventory: TiledSourceInventory,
): Promise<unknown> => {
  const manifest = writeTilesetManifest(pack, { provenance }) as {
    readonly assets?: readonly {
      readonly id: string;
      readonly path: string;
      readonly mime: string;
    }[];
  } & Record<string, unknown>;
  const assets = [];
  for (const asset of manifest.assets ?? []) {
    const source = resolveContainedAssetPath(
      sourceRoot,
      asset.path,
      (message) => new AssetImportError({ path: asset.path, message }),
    );
    const destination = resolveContainedAssetPath(
      stagingDir,
      asset.path,
      (message) => new AssetImportError({ path: asset.path, message }),
    );
    const bytes = await readFile(source);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, { force: true });
    assets.push({
      ...asset,
      size: bytes.byteLength,
      hash: hashBytes(bytes),
      license: tileborneTiledSourceLicenseJson(sourceRoot),
    });
  }
  return { ...manifest, assets, tiledSourceInventory: sourceInventory };
};

const readTiledSourceFile = (sourceRoot: string) => async (filePath: string) => {
  const resolvedRoot = path.resolve(sourceRoot);
  const relative = path.relative(resolvedRoot, path.resolve(filePath));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Tiled source read escaped source root: ${filePath}`);
  }
  return readFile(filePath);
};

const stageTiledSourcePack = (
  sourceRoot: string,
  stagingDir: string,
): Effect.Effect<void, AssetImportError> =>
  Effect.gen(function* () {
    const resolvedSource = path.resolve(sourceRoot);
    const sourceFiles = yield* Effect.tryPromise({
      try: () => discoverTiledSourceInputFiles(resolvedSource),
      catch: (cause) =>
        new AssetImportError({ path: resolvedSource, message: errorMessage(cause) }),
    });
    if (sourceFiles.mapFiles.length === 0 && sourceFiles.tsxFiles.length === 0) {
      yield* new AssetImportError({
        path: resolvedSource,
        message: 'Selected folder does not contain Tiled map or tileset source files.',
      });
    }

    const imported = yield* Effect.tryPromise({
      try: () =>
        importTiledSource({
          sourceRoot: resolvedSource,
          readFile: readTiledSourceFile(resolvedSource),
          mapFiles: sourceFiles.mapFiles,
          tsxFiles: sourceFiles.tsxFiles,
          ruleFiles: sourceFiles.ruleFiles,
          importedAt: new Date().toISOString(),
        }),
      catch: (cause) =>
        new AssetImportError({ path: resolvedSource, message: errorMessage(cause) }),
    });
    const blocking = imported.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
    if (blocking !== undefined || imported.value === undefined) {
      yield* new AssetImportError({
        path: blocking?.path ?? resolvedSource,
        message: blocking?.message ?? 'Tiled source import failed.',
      });
    }

    yield* Effect.tryPromise({
      try: () => mkdir(stagingDir, { recursive: true }),
      catch: (cause) => new AssetImportError({ path: stagingDir, message: errorMessage(cause) }),
    });
    const manifest = yield* Effect.tryPromise({
      try: () =>
        manifestWithTilesetAssetIntegrity(
          imported.value!,
          resolvedSource,
          stagingDir,
          imported.provenance,
          imported.sourceInventory,
        ),
      catch: (cause) =>
        cause instanceof AssetImportError
          ? cause
          : new AssetImportError({ path: resolvedSource, message: errorMessage(cause) }),
    });
    yield* Effect.tryPromise({
      try: () =>
        writeFile(
          path.join(stagingDir, MANIFEST_FILENAME),
          `${JSON.stringify(manifest, null, 2)}\n`,
          'utf8',
        ),
      catch: (cause) =>
        new AssetImportError({
          path: path.join(stagingDir, MANIFEST_FILENAME),
          message: errorMessage(cause),
        }),
    });
  });

const sanitizeImageFileName = (fileName: string): string => {
  const base = fileName.replaceAll('\\', '/').split('/').pop() ?? fileName;
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+/, '');
  return cleaned.length === 0 ? 'sprite.png' : cleaned;
};

const stageSpriteSheetPack = (
  input: SpriteSheetImportInput,
  stagingDir: string,
): Effect.Effect<void, AssetImportError> =>
  Effect.gen(function* () {
    const fileName = sanitizeImageFileName(input.imageFileName);
    const imagePath = `atlases/${fileName}`;
    const imported = importSpriteSheet({
      imagePath,
      imageWidth: input.imageWidth,
      imageHeight: input.imageHeight,
      mime: input.mime,
      slice: input.slice,
      ...(input.spriteName === undefined ? {} : { spriteName: input.spriteName }),
      ...(input.anchor === undefined ? {} : { anchor: input.anchor }),
      ...(input.packName === undefined ? {} : { packName: input.packName }),
      ...(input.clips === undefined ? {} : { clips: input.clips }),
      ...(input.playerModel === undefined ? {} : { playerModel: input.playerModel }),
      ...(input.aseprite === undefined ? {} : { aseprite: input.aseprite }),
      importedAt: new Date().toISOString(),
    } satisfies ImportSpriteSheetInput);

    const blocking = imported.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
    if (blocking !== undefined || imported.value === undefined) {
      yield* new AssetImportError({
        path: imagePath,
        message: blocking?.message ?? 'Sprite sheet import failed.',
      });
      return;
    }

    yield* Effect.tryPromise({
      try: () => mkdir(stagingDir, { recursive: true }),
      catch: (cause) => new AssetImportError({ path: stagingDir, message: errorMessage(cause) }),
    });

    const manifest = writeTilesetManifest(imported.value.pack, {
      provenance: imported.value.provenance,
    }) as {
      readonly assets?: readonly {
        readonly id: string;
        readonly path: string;
        readonly mime: string;
      }[];
    } & Record<string, unknown>;

    const assets: Array<Record<string, unknown>> = [];
    for (const asset of manifest.assets ?? []) {
      const destination = resolveContainedAssetPath(
        stagingDir,
        asset.path,
        (message) => new AssetImportError({ path: asset.path, message }),
      );
      yield* Effect.tryPromise({
        try: async () => {
          await mkdir(path.dirname(destination), { recursive: true });
          await writeFile(destination, input.imageBytes);
        },
        catch: (cause) => new AssetImportError({ path: destination, message: errorMessage(cause) }),
      });
      assets.push({
        ...asset,
        size: input.imageBytes.byteLength,
        hash: hashBytes(input.imageBytes),
        license: {
          spdxId: imported.value.pack.license.spdxId,
          redistributable: imported.value.pack.license.redistributable,
        },
      });
    }

    yield* Effect.tryPromise({
      try: () =>
        writeFile(
          path.join(stagingDir, MANIFEST_FILENAME),
          `${JSON.stringify({ ...manifest, assets }, null, 2)}\n`,
          'utf8',
        ),
      catch: (cause) =>
        new AssetImportError({
          path: path.join(stagingDir, MANIFEST_FILENAME),
          message: errorMessage(cause),
        }),
    });
  });

const importDirectoryPack = (
  assetsRoot: string,
  sourceRoot: string,
): Effect.Effect<AssetPackWithCapability, AssetServiceError> =>
  Effect.gen(function* () {
    const resolvedSource = path.resolve(sourceRoot);
    const manifest = yield* readSourceManifest(resolvedSource);
    const root = packsRoot(assetsRoot);
    const staging = path.join(root, `.staging-${manifest.id}-${manifest.version}-${randomUUID()}`);
    const target = packDirectory(assetsRoot, manifest.id, manifest.version);
    yield* Effect.tryPromise({
      try: () => mkdir(root, { recursive: true }),
      catch: (cause) => new AssetImportError({ path: root, message: errorMessage(cause) }),
    });
    yield* Effect.tryPromise({
      try: () =>
        cp(resolvedSource, staging, {
          recursive: true,
          errorOnExist: true,
          force: false,
          verbatimSymlinks: true,
        }),
      catch: (cause) => new AssetImportError({ path: staging, message: errorMessage(cause) }),
    });
    const stagedPack = yield* readSourcePack(staging);
    const manifestPath = yield* verifiedInPackPath(staging, MANIFEST_FILENAME, 'import');
    const probed = yield* probePackCapabilityWithIntegrity({
      packId: stagedPack.manifest.id,
      manifestPath,
    });
    const installedPacks = yield* listVerifiedPacks(assetsRoot);
    const capability = appendCapabilityDiagnostics(
      probed.capability,
      duplicatePackDiagnostics(installedPacks, stagedPack.manifest),
    );
    const lock = makePackLock(
      stagedPack.manifest,
      stagedPack.files,
      capability,
      probed.integrityHash,
    );
    const encodedLock = yield* encodeJson(
      AssetPackIntegrityLock,
      lock,
      (message) => new AssetImportError({ path: path.join(staging, LOCK_FILENAME), message }),
    );
    const lockPath = yield* verifiedInPackPath(staging, LOCK_FILENAME, 'import');
    yield* writeJsonAtomic(lockPath, encodedLock).pipe(
      Effect.mapError(
        (error) => new AssetImportError({ path: error.path, message: error.message }),
      ),
    );
    yield* Effect.tryPromise({
      try: () => replaceDirectory(staging, target),
      catch: (cause) => new AssetImportError({ path: target, message: errorMessage(cause) }),
    });
    yield* readVerifiedPackAt(target).pipe(
      Effect.mapError(
        (error) => new AssetImportError({ path: error.path, message: error.message }),
      ),
    );
    return withCapability(stagedPack.manifest, capability);
  });

const listVerifiedPackEntries = (
  assetsRoot: string,
): Effect.Effect<
  readonly {
    readonly pack: AssetPackWithCapability;
    readonly refreshed: boolean;
  }[],
  AssetServiceError
> =>
  Effect.gen(function* () {
    const root = packsRoot(assetsRoot);
    const entries = yield* Effect.tryPromise({
      try: async () => {
        try {
          return await readdir(root, { withFileTypes: true });
        } catch (cause) {
          if (isNotFound(cause)) {
            return [];
          }
          throw cause;
        }
      },
      catch: (cause) => new AssetIntegrityError({ path: root, message: errorMessage(cause) }),
    });
    const packs: {
      readonly pack: AssetPackWithCapability;
      readonly refreshed: boolean;
    }[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) {
        continue;
      }
      packs.push(yield* readVerifiedPackWithCapabilityAt(path.join(root, entry.name)));
    }
    return packs.sort((left, right) => left.pack.name.localeCompare(right.pack.name));
  });

const listVerifiedPacks = (
  assetsRoot: string,
): Effect.Effect<readonly AssetPackWithCapability[], AssetServiceError> =>
  listVerifiedPackEntries(assetsRoot).pipe(
    Effect.map((entries) => entries.map((entry) => entry.pack)),
  );

const removeVerifiedPack = (
  assetsRoot: string,
  pack: AssetPackWithCapability,
): Effect.Effect<void, AssetServiceError> =>
  removePath(
    packDirectory(assetsRoot, pack.id, pack.version),
    (target, message) => new AssetImportError({ path: target, message }),
  );

const projectWithoutPackRef = (
  project: ProjectManifest,
  pack: AssetPackWithCapability,
): ProjectManifest => {
  const assetPacks = project.assetPacks.filter(
    (ref) => !(ref.id === pack.id && ref.version === pack.version),
  );
  if (assetPacks.length === project.assetPacks.length) {
    return project;
  }
  return new ProjectManifest({
    id: project.id,
    name: project.name,
    schemaVersion: project.schemaVersion,
    engineVersion: project.engineVersion,
    plugins: [...project.plugins],
    assetPacks,
    maps: [...project.maps],
  });
};

const clearMapPackSelection = (
  mapFile: string,
  packId: PackId,
): Effect.Effect<
  { readonly nextMap: unknown; readonly changed: boolean },
  ProjectValidationError
> =>
  Effect.gen(function* () {
    const raw = yield* Effect.tryPromise({
      try: () => readFile(mapFile, 'utf8'),
      catch: (cause) => new ProjectValidationError({ path: mapFile, message: errorMessage(cause) }),
    });
    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw) as unknown,
      catch: (cause) => new ProjectValidationError({ path: mapFile, message: errorMessage(cause) }),
    });
    yield* Effect.try({
      try: () => decodePersistedTileborneMapJson(parsed),
      catch: (cause) => new ProjectValidationError({ path: mapFile, message: errorMessage(cause) }),
    });
    if (
      !isRecord(parsed) ||
      !isRecord(parsed.properties) ||
      parsed.properties.tilesetPackId !== packId
    ) {
      return { nextMap: parsed, changed: false };
    }
    const properties = { ...parsed.properties };
    delete properties.tilesetPackId;
    delete properties.tilesetProjection;
    const nextMap = { ...parsed, properties };
    yield* Effect.try({
      try: () => decodePersistedTileborneMapJson(nextMap),
      catch: (cause) => new ProjectValidationError({ path: mapFile, message: errorMessage(cause) }),
    });
    return { nextMap, changed: true };
  });

const upsertMapLock = (
  entries: readonly MapIntegrityEntry[],
  next: MapIntegrityEntry,
): readonly MapIntegrityEntry[] => [...entries.filter((entry) => entry.id !== next.id), next];

const cleanupProjectPackReferences = (
  projectsRoot: string,
  pack: AssetPackWithCapability,
): Effect.Effect<void, AssetServiceError> =>
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
      catch: (cause) =>
        new ProjectValidationError({ path: projectsRoot, message: errorMessage(cause) }),
    });
    const projectRoots = new Set(
      entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => path.join(projectsRoot, entry.name)),
    );
    const registry = yield* readProjectRegistry(projectsRoot);
    for (const entry of registry.projects) {
      projectRoots.add(entry.path);
    }

    for (const projectDir of projectRoots) {
      const project = yield* readVerifiedProjectAtRoot(projectDir);
      const lock = yield* readProjectLock(projectLockPath(projectDir));
      const nextProject = projectWithoutPackRef(project, pack);
      let nextMapLocks: readonly MapIntegrityEntry[] = lock.maps;
      let changed = nextProject !== project;

      for (const ref of project.maps) {
        const mapId = yield* Effect.try({
          try: () => Schema.decodeUnknownSync(MapId)(ref.id),
          catch: (cause) =>
            new ProjectValidationError({ path: projectDir, message: errorMessage(cause) }),
        });
        const mapFile = mapPath(projectDir, mapId);
        const cleaned = yield* clearMapPackSelection(mapFile, pack.id);
        if (!cleaned.changed) {
          continue;
        }
        yield* writeJsonAtomic(mapFile, cleaned.nextMap).pipe(
          Effect.mapError(
            (error) => new ProjectSaveError({ path: error.path, message: error.message }),
          ),
        );
        nextMapLocks = upsertMapLock(
          nextMapLocks,
          new MapIntegrityEntry({
            id: mapId,
            path: ref.path,
            hash: hashJsonStable(cleaned.nextMap),
          }),
        );
        changed = true;
      }

      if (changed) {
        yield* writeProjectWithLock(projectDir, nextProject, nextMapLocks);
      }
    }
  });

const resolveProjectForReindex = (
  projectsRoot: string,
  projectSlug: string | undefined,
  lastOpened: Option.Option<string>,
): Effect.Effect<
  { readonly projectPath: string; readonly projectId: ProjectId },
  ProjectNotFoundError | ProjectValidationError
> =>
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
      catch: (cause) =>
        new ProjectValidationError({ path: projectsRoot, message: errorMessage(cause) }),
    });
    const directories = entries.filter(
      (entry) => entry.isDirectory() && !entry.name.startsWith('.'),
    );
    const entryLabel = (projectPath: string): string => path.basename(projectPath);

    const resolveFromManifest = (projectPath: string) =>
      Effect.gen(function* () {
        const manifestFile = projectManifestPath(projectPath);
        const raw = yield* Effect.tryPromise({
          try: () => readFile(manifestFile, 'utf8'),
          catch: (cause) =>
            new ProjectValidationError({ path: manifestFile, message: errorMessage(cause) }),
        });
        const parsed = yield* Effect.try({
          try: () => JSON.parse(raw) as { readonly id?: string; readonly name?: string },
          catch: (cause) =>
            new ProjectValidationError({ path: manifestFile, message: errorMessage(cause) }),
        });
        const projectId = Schema.decodeUnknownSync(ProjectId)(parsed.id);
        return { projectPath, projectId, name: parsed.name ?? entryLabel(projectPath) };
      });

    if (projectSlug) {
      for (const entry of directories) {
        const projectPath = path.join(projectsRoot, entry.name);
        const resolved = yield* resolveFromManifest(projectPath);
        if (resolved.name === projectSlug || resolved.projectId === projectSlug) {
          return { projectPath: resolved.projectPath, projectId: resolved.projectId };
        }
      }
      yield* new ProjectNotFoundError({
        projectId: Schema.decodeUnknownSync(ProjectId)(
          'project:00000000-0000-0000-0000-000000000000',
        ),
        message: `project not found: ${projectSlug}`,
      });
    }
    return yield* Option.match(lastOpened, {
      onNone: () =>
        Effect.fail(
          new ProjectNotFoundError({
            projectId: Schema.decodeUnknownSync(ProjectId)(
              'project:00000000-0000-0000-0000-000000000000',
            ),
            message: 'no active project; pass --project <slug> or open a project first',
          }),
        ),
      onSome: (opened) =>
        Effect.gen(function* () {
          const directPath = path.join(projectsRoot, opened);
          try {
            const resolved = yield* resolveFromManifest(directPath);
            return { projectPath: resolved.projectPath, projectId: resolved.projectId };
          } catch {
            for (const entry of directories) {
              const projectPath = path.join(projectsRoot, entry.name);
              const resolved = yield* resolveFromManifest(projectPath);
              if (resolved.projectId === opened || resolved.name === opened) {
                return { projectPath: resolved.projectPath, projectId: resolved.projectId };
              }
            }
            return yield* Effect.fail(
              new ProjectNotFoundError({
                projectId: Schema.decodeUnknownSync(ProjectId)(opened),
                message: `project not found: ${opened}`,
              }),
            );
          }
        }),
    });
  });

export const AssetServiceLive = Layer.effect(
  AssetService,
  Effect.gen(function* () {
    const home = yield* HomeService;
    const config = yield* ConfigService;
    const jobs = yield* JobService;
    const paths = yield* home.init();
    const trigger = yield* PubSub.unbounded<void>();
    const capabilityTrigger = yield* PubSub.unbounded<PackCapabilityRefreshed>();

    // Verified-pack cache, keyed by packId. Full byte-integrity verification
    // (read+SHA every asset file) is expensive and MUST NOT run per request:
    // the asset protocol calls getPack ~90-100x on first open, which otherwise
    // serializes that many full-pack rehashes on the single main thread. We
    // verify once at boot / after a pack changes, then serve the cached
    // verified manifest. `cachePopulated` distinguishes "no packs installed"
    // from "not yet scanned". The cache is dropped on any pack-set change
    // (import/remove) so changed packs are re-verified.
    const verifiedPackCache = new Map<
      PackId,
      { readonly pack: AssetPackWithCapability; readonly integrityHash: ContentHash }
    >();
    let cachePopulated = false;

    const cacheVerifiedEntries = (
      entries: readonly { readonly pack: AssetPackWithCapability; readonly refreshed: boolean }[],
    ): void => {
      verifiedPackCache.clear();
      for (const entry of entries) {
        verifiedPackCache.set(entry.pack.id, {
          pack: entry.pack,
          // Warms the packManifestContentHash memo for this pack object so the
          // protocol/asset-library hash lookups stay O(1) per request.
          integrityHash: packManifestContentHash(entry.pack),
        });
      }
      cachePopulated = true;
    };

    const invalidateVerifiedPackCache = (): void => {
      verifiedPackCache.clear();
      cachePopulated = false;
    };

    const ensureVerifiedPackCache = Effect.fn('AssetService.ensureVerifiedPackCache')(function* () {
      if (cachePopulated) {
        return;
      }
      cacheVerifiedEntries(yield* listVerifiedPackEntries(paths.assets));
    });

    const cachedVerifiedPacks = Effect.fn('AssetService.cachedVerifiedPacks')(function* () {
      yield* ensureVerifiedPackCache();
      return [...verifiedPackCache.values()]
        .map((entry) => entry.pack)
        .sort((left, right) => left.name.localeCompare(right.name));
    });

    const cachedGetPack = Effect.fn('AssetService.cachedGetPack')(function* (packId: PackId) {
      yield* ensureVerifiedPackCache();
      const entry = verifiedPackCache.get(packId);
      if (entry === undefined) {
        return yield* new AssetPackNotFoundError({
          packId,
          message: `asset pack not found: ${packId}`,
        });
      }
      return entry.pack;
    });

    const bootEntries = yield* listVerifiedPackEntries(paths.assets);
    cacheVerifiedEntries(bootEntries);
    for (const entry of bootEntries) {
      if (entry.refreshed) {
        yield* PubSub.publish(capabilityTrigger, {
          packId: entry.pack.id,
          capability: entry.pack.capability,
        });
      }
    }

    const importPackNow = Effect.fn('AssetService.importPackNow')(function* (
      source: AssetPackSource,
    ) {
      yield* preflightImportSource(source);
      const pack = yield* source._tag === 'directory'
        ? importDirectoryPack(paths.assets, source.path)
        : Effect.gen(function* () {
            const staging = path.join(paths.cache, 'assets', 'staging', randomUUID());
            yield* extractAssetArchive(path.resolve(source.path), staging);
            const imported = yield* importDirectoryPack(paths.assets, staging);
            yield* Effect.promise(() =>
              rm(staging, { recursive: true, force: true }).catch(() => undefined),
            );
            return imported;
          });
      invalidateVerifiedPackCache();
      yield* PubSub.publish(trigger, void 0);
      yield* PubSub.publish(capabilityTrigger, {
        packId: pack.id,
        capability: pack.capability,
      });
      return pack.id;
    });

    const importPack = Effect.fn('AssetService.importPack')(function* (source: AssetPackSource) {
      yield* preflightImportSource(source);
      return yield* jobs.create({
        name: 'asset-pack-import',
        run: importPackNow(source).pipe(Effect.map((packId) => ({ packId }))),
      });
    });

    const importTiledSourcePackNow = Effect.fn('AssetService.importTiledSourcePackNow')(function* (
      sourceRoot: string,
    ) {
      const staging = path.join(paths.cache, 'assets', 'tiled-source', randomUUID());
      yield* stageTiledSourcePack(sourceRoot, staging);
      const pack = yield* importDirectoryPack(paths.assets, staging).pipe(
        Effect.ensuring(
          Effect.promise(() =>
            rm(staging, { recursive: true, force: true }).catch(() => undefined),
          ),
        ),
      );
      invalidateVerifiedPackCache();
      yield* PubSub.publish(trigger, void 0);
      yield* PubSub.publish(capabilityTrigger, {
        packId: pack.id,
        capability: pack.capability,
      });
      return pack.id;
    });

    const importSpriteSheetPackNow = Effect.fn('AssetService.importSpriteSheetPackNow')(function* (
      input: SpriteSheetImportInput,
    ) {
      const staging = path.join(paths.cache, 'assets', 'sprite-sheet', randomUUID());
      yield* stageSpriteSheetPack(input, staging);
      const pack = yield* importDirectoryPack(paths.assets, staging).pipe(
        Effect.ensuring(
          Effect.promise(() =>
            rm(staging, { recursive: true, force: true }).catch(() => undefined),
          ),
        ),
      );
      invalidateVerifiedPackCache();
      yield* PubSub.publish(trigger, void 0);
      yield* PubSub.publish(capabilityTrigger, {
        packId: pack.id,
        capability: pack.capability,
      });
      return pack.id;
    });

    const importTiledSourcePack = Effect.fn('AssetService.importTiledSourcePack')(function* (
      sourceRoot: string,
    ) {
      const resolvedSource = path.resolve(sourceRoot);
      const sourceFiles = yield* Effect.tryPromise({
        try: () => discoverTiledSourceInputFiles(resolvedSource),
        catch: (cause) =>
          new AssetImportError({ path: resolvedSource, message: errorMessage(cause) }),
      });
      if (sourceFiles.mapFiles.length === 0 && sourceFiles.tsxFiles.length === 0) {
        yield* new AssetImportError({
          path: resolvedSource,
          message: 'Selected folder does not contain Tiled map or tileset source files.',
        });
      }
      return yield* jobs.create({
        name: 'tiled-source-import',
        run: importTiledSourcePackNow(resolvedSource).pipe(Effect.map((packId) => ({ packId }))),
      });
    });

    const listPacks = Effect.fn('AssetService.listPacks')(function* () {
      return yield* cachedVerifiedPacks();
    });

    const getPack = Effect.fn('AssetService.getPack')(function* (packId: PackId) {
      return yield* cachedGetPack(packId);
    });

    const describePack = Effect.fn('AssetService.describePack')(function* (packId: PackId) {
      const pack = yield* cachedGetPack(packId);
      return {
        pack,
        capability: pack.capability,
        diagnostics: pack.capability.diagnostics,
      };
    });

    const removePack = Effect.fn('AssetService.removePack')(function* (packId: PackId) {
      const pack = yield* cachedGetPack(packId);
      yield* cleanupProjectPackReferences(paths.projects, pack);
      yield* removeVerifiedPack(paths.assets, pack);
      invalidateVerifiedPackCache();
      yield* PubSub.publish(trigger, void 0);
    });

    const listProjectPacks = Effect.fn('AssetService.listProjectPacks')(function* (
      projectSlug?: string | undefined,
    ) {
      const currentConfig = yield* config.get;
      const resolved = yield* resolveProjectForReindex(
        paths.projects,
        projectSlug,
        currentConfig.lastOpenedProject,
      );
      const project = yield* readJson(
        projectManifestPath(resolved.projectPath),
        ProjectManifestSchema,
        (message) => new AssetImportError({ path: resolved.projectPath, message }),
      );
      const installed = yield* cachedVerifiedPacks();
      return installed.filter((pack) =>
        project.assetPacks.some((ref) => ref.id === pack.id && ref.version === pack.version),
      );
    });

    const reindex = Effect.fn('AssetService.reindex')(function* (projectSlug?: string | undefined) {
      const currentConfig = yield* config.get;
      const resolved = yield* resolveProjectForReindex(
        paths.projects,
        projectSlug,
        currentConfig.lastOpenedProject,
      );
      const project = yield* readJson(
        projectManifestPath(resolved.projectPath),
        ProjectManifestSchema,
        (message) => new AssetImportError({ path: resolved.projectPath, message }),
      );
      const installed = yield* listVerifiedPacks(paths.assets);
      const entries: AssetIndexEntry[] = [];
      for (const ref of project.assetPacks) {
        const pack = installed.find(
          (candidate) => candidate.id === ref.id && candidate.version === ref.version,
        );
        if (!pack) {
          yield* new AssetPackNotFoundError({
            packId: Schema.decodeUnknownSync(PackId)(ref.id),
            message: `asset pack not installed: ${ref.id}@${ref.version}`,
          });
        }
        const packRoot = packDirectory(paths.assets, pack!.id, pack!.version);
        const verified = yield* readVerifiedPackAt(packRoot);
        const indexed = indexPack(verified, verified.assets);
        entries.push(
          new AssetIndexEntry({
            packId: verified.id,
            version: verified.version,
            assetCount: indexed.assets.length,
            manifestHash: hashAssetPackManifest(verified),
          }),
        );
      }
      const derivedDir = path.join(resolved.projectPath, PROJECT_DERIVED_DIR);
      const indexPath = path.join(derivedDir, ASSET_INDEX_FILE);
      yield* Effect.tryPromise({
        try: () => mkdir(derivedDir, { recursive: true }),
        catch: (cause) => new AssetImportError({ path: derivedDir, message: errorMessage(cause) }),
      });
      const payload = new ProjectAssetIndex({
        schemaVersion: 1,
        projectId: project.id,
        packs: entries,
      });
      const encoded = yield* encodeJson(
        ProjectAssetIndex,
        payload,
        (message) => new AssetImportError({ path: indexPath, message }),
      );
      yield* writeJsonAtomic(indexPath, encoded).pipe(
        Effect.mapError(
          (error) => new AssetImportError({ path: error.path, message: error.message }),
        ),
      );
      return new AssetReindexResult({
        projectPath: resolved.projectPath,
        indexPath,
        packs: entries,
      });
    });

    return {
      importPack,
      importPackNow,
      importTiledSourcePack,
      importTiledSourcePackNow,
      importSpriteSheetPackNow,
      listPacks,
      listProjectPacks,
      getPack,
      describePack,
      removePack,
      reindex,
      subscribe: Stream.concat(
        Stream.fromEffect(listVerifiedPacks(paths.assets)),
        Stream.fromPubSub(trigger).pipe(Stream.mapEffect(() => listVerifiedPacks(paths.assets))),
      ),
      subscribeCapability: Stream.fromPubSub(capabilityTrigger),
    };
  }),
);

// Hashing a manifest serializes the whole canonical pack JSON, which is too
// expensive to redo per protocol/asset-library request. Cached verified packs
// are stable object references, so memoizing by manifest identity makes repeat
// hash lookups O(1) without changing the result for a given manifest object.
const contentHashByManifest = new WeakMap<AssetPackManifest, ContentHash>();

export const packManifestContentHash = (manifest: AssetPackManifest): ContentHash => {
  const memoized = contentHashByManifest.get(manifest);
  if (memoized !== undefined) {
    return memoized;
  }
  const hash = hashJsonStable(assetPackManifestToJson(manifest));
  contentHashByManifest.set(manifest, hash);
  return hash;
};
