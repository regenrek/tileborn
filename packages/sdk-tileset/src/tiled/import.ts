import { Option } from 'effect';

import type { ParseDiagnostic } from '../diagnostics.js';
import { TilesetPack, TilesetPackLicense } from '../schemas/tileset-pack.js';
import { inferAssetSemanticRoles } from '../manifest/semantic-roles.js';

import {
  isSupportedTilesetSource,
  readExternalText,
  resolvePath,
  tilesetIdFromSource,
} from './external-resolve.js';
import { parseTmj } from './tmj-parse.js';
import { parseTmx } from './tmx-parse.js';
import { inferTiledImportSuggestions } from './infer.js';
import { deterministicPackId } from './deterministic-ids.js';
import { parseTsj } from './tsj-parse.js';
import { parseTsx } from './tsx-parse.js';
import type {
  TiledAppliedImportPlan,
  TiledAnyCanonicalImport,
  TiledCanonicalImport,
  TiledImportOptions,
  TiledImportPlan,
  TiledImportPlanHints,
  TiledImportProfile,
  TiledImportScan,
  TiledSourcePackImport,
  TiledSourcePackRuleRef,
  TiledTilesetPackImport,
} from './types.js';
import { scanTiledSource } from './scan.js';
import { unsupportedFeatureDiagnostic } from './support-policy.js';

type DirectoryEntry = {
  readonly path: string;
  readonly kind: 'file' | 'directory';
};

const planDiagnostics = (
  scan: TiledImportScan,
  profile: TiledImportProfile,
): readonly ParseDiagnostic[] => {
  if (scan.unsupportedFeatures.length === 0) return [];
  return scan.unsupportedFeatures.map((feature) => ({
    ...unsupportedFeatureDiagnostic(feature),
    message:
      typeof profile === 'object'
        ? feature.message
        : `${feature.message} Choose a plugin profile only when that plugin explicitly supports this feature.`,
  }));
};

export const buildImportPlan = (
  scan: TiledImportScan,
  profile: TiledImportProfile = 'standard',
  hints: TiledImportPlanHints = {},
): TiledImportPlan => {
  const suggestions = profile === 'assistive-infer' ? inferTiledImportSuggestions(scan) : [];
  const accepted = new Set(hints.acceptedSuggestionIds ?? []);
  const acceptedSuggestionIds = suggestions
    .filter((suggestion) => accepted.has(suggestion.id))
    .map((suggestion) => suggestion.id)
    .sort();
  const diagnostics = planDiagnostics(scan, profile);

  return {
    schemaVersion: 1,
    sourcePath: scan.sourcePath,
    profile,
    scan,
    importRecommendation: scan.importRecommendation,
    mappings: {
      maps: scan.maps,
      categories: scan.categories,
      placeables: scan.placeableCandidates,
      tilesets: scan.tilesets.map((tileset) => ({
        name: tileset.name,
        kind: tileset.kind,
        categoryIds: tileset.categories,
        paintable: tileset.kind === 'grid',
        placeable: tileset.kind === 'image-collection',
        confidence: tileset.confidence,
      })),
    },
    suggestions,
    acceptedSuggestionIds,
    diagnostics,
  };
};

export const applyImportPlan = (plan: TiledImportPlan): TiledAppliedImportPlan => {
  const accepted = new Set(plan.acceptedSuggestionIds);
  const acceptedSuggestions = plan.suggestions
    .filter((suggestion) => accepted.has(suggestion.id))
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    schemaVersion: 1,
    sourcePath: plan.sourcePath,
    profile: plan.profile,
    selectedMapPath: plan.mappings.maps[0]?.path ?? plan.sourcePath,
    scan: plan.scan,
    importRecommendation: plan.importRecommendation,
    mappings: plan.mappings,
    acceptedSuggestions,
    diagnostics: plan.diagnostics,
  };
};

const lowerSourcePath = (sourcePath: string): string => sourcePath.toLowerCase();

const isTilesetSourcePath = (sourcePath: string): boolean => isSupportedTilesetSource(sourcePath);

const isMapSourcePath = (sourcePath: string): boolean => {
  const lower = lowerSourcePath(sourcePath);
  return lower.endsWith('.tmx') || lower.endsWith('.tmj') || lower.endsWith('.json');
};

const hasBlockingDiagnostics = (diagnostics: readonly ParseDiagnostic[]): boolean =>
  diagnostics.some((diagnostic) => diagnostic.severity === 'error');

const buildPack = (
  options: Pick<TiledImportOptions, 'packIdSeed' | 'packName' | 'packVersion'>,
  sourcePath: string,
  compiled: readonly NonNullable<ReturnType<typeof parseTsj>['value']>[],
): TilesetPack => {
  const pack = new TilesetPack({
    schemaVersion: 1,
    id: deterministicPackId(options.packIdSeed),
    name: options.packName ?? compiled[0]?.tileset.name ?? 'Tiled Import',
    version: options.packVersion ?? '1.0.0',
    license: new TilesetPackLicense({
      spdxId: 'UNKNOWN',
      attribution: Option.some('Imported from Tiled'),
      sourceUrl: Option.none(),
      notes: Option.some(sourcePath),
      redistributable: false,
    }),
    tilesets: compiled.map((entry) => entry.tileset),
    assets: compiled.flatMap((entry) => entry.assets),
    placeables: compiled.flatMap((entry) => entry.placeables),
  });
  return new TilesetPack({ ...pack, semanticRoles: inferAssetSemanticRoles(pack) });
};

const importStandaloneTileset = async (
  source: Pick<TiledImportOptions, 'sourcePath' | 'projectRoot' | 'reader'> & {
    readonly raw?: string;
  },
  options: Pick<TiledImportOptions, 'packIdSeed' | 'packName' | 'packVersion' | 'profile'>,
  scan: TiledImportScan,
  raw: string,
): Promise<{
  readonly value?: TiledTilesetPackImport;
  readonly diagnostics: readonly ParseDiagnostic[];
}> => {
  const tilesetSeed = tilesetIdFromSource(source.sourcePath);
  const lower = lowerSourcePath(source.sourcePath);
  const parsed = lower.endsWith('.tsx')
    ? parseTsx(raw, {
        packIdSeed: options.packIdSeed,
        tilesetSeed,
        projectRoot: source.projectRoot,
        basePath: source.sourcePath,
        profile: options.profile === 'assistive-infer' ? 'standard' : options.profile,
        validateImagePaths: true,
      })
    : parseTsj(raw, {
        packIdSeed: options.packIdSeed,
        tilesetSeed,
        projectRoot: source.projectRoot,
        basePath: source.sourcePath,
        profile: options.profile === 'assistive-infer' ? 'standard' : options.profile,
        validateImagePaths: true,
      });
  if (!parsed.value || hasBlockingDiagnostics(parsed.diagnostics)) {
    return { diagnostics: parsed.diagnostics };
  }
  const diagnostics = parsed.diagnostics;
  return {
    value: {
      kind: 'tileset-pack',
      scan,
      pack: buildPack(options, source.sourcePath, [parsed.value]),
      diagnostics,
    },
    diagnostics,
  };
};

const normalizeDirectoryEntries = (
  basePath: string,
  entries: readonly unknown[],
): readonly DirectoryEntry[] =>
  entries.flatMap((entry): readonly DirectoryEntry[] => {
    if (typeof entry === 'string') {
      return [
        { path: resolvePath(basePath, entry), kind: entry.endsWith('/') ? 'directory' : 'file' },
      ];
    }
    if (!entry || typeof entry !== 'object') return [];
    const value = entry as {
      readonly name?: unknown;
      readonly path?: unknown;
      readonly kind?: unknown;
    };
    if (value.kind !== 'file' && value.kind !== 'directory') return [];
    const name =
      typeof value.path === 'string'
        ? value.path
        : typeof value.name === 'string'
          ? value.name
          : undefined;
    return name === undefined ? [] : [{ path: resolvePath(basePath, name), kind: value.kind }];
  });

const walkDirectory = async (
  rootPath: string,
  reader: NonNullable<TiledImportOptions['reader']>,
): Promise<readonly DirectoryEntry[]> => {
  if (!reader.readDirectory) return [];
  const visited = new Set<string>();
  const walk = async (dir: string): Promise<readonly DirectoryEntry[]> => {
    if (visited.has(dir)) return [];
    visited.add(dir);
    const entries = normalizeDirectoryEntries(dir, await reader.readDirectory!(dir));
    const nested = await Promise.all(
      entries.filter((entry) => entry.kind === 'directory').map((entry) => walk(entry.path)),
    );
    return [...entries, ...nested.flat()];
  };
  return walk(rootPath);
};

const importSourceFolder = async (
  source: Pick<TiledImportOptions, 'sourcePath' | 'projectRoot' | 'reader'>,
  options: Pick<TiledImportOptions, 'packIdSeed' | 'packName' | 'packVersion' | 'profile'>,
  scan: TiledImportScan,
): Promise<{
  readonly value?: TiledSourcePackImport;
  readonly diagnostics: readonly ParseDiagnostic[];
}> => {
  if (!source.reader?.readDirectory) {
    return {
      diagnostics: [
        {
          _tag: 'TiledParseError',
          path: source.sourcePath,
          message: 'Tiled source-folder import requires a reader with readDirectory',
          severity: 'error',
          format: 'tmj',
        },
      ],
    };
  }

  const entries = await walkDirectory(source.sourcePath, source.reader);
  const tileSources = entries
    .filter((entry) => entry.kind === 'file' && isTilesetSourcePath(entry.path))
    .sort((left, right) => left.path.localeCompare(right.path));
  const ruleSources = entries
    .filter((entry) => {
      const lower = lowerSourcePath(entry.path);
      return (
        entry.kind === 'file' &&
        (lower.endsWith('/rules.txt') || /\/rules\/[^/]+\.(tmx|tmj)$/.test(lower))
      );
    })
    .sort((left, right) => left.path.localeCompare(right.path));

  const compiled: NonNullable<ReturnType<typeof parseTsj>['value']>[] = [];
  const diagnostics: ParseDiagnostic[] = [];
  for (const tileSource of tileSources) {
    const raw = await readExternalText(source.reader.readFile, tileSource.path);
    const tilesetSeed = tilesetIdFromSource(tileSource.path);
    const parsed = lowerSourcePath(tileSource.path).endsWith('.tsx')
      ? parseTsx(raw, {
          packIdSeed: options.packIdSeed,
          tilesetSeed,
          projectRoot: source.projectRoot,
          basePath: tileSource.path,
          profile: options.profile === 'assistive-infer' ? 'standard' : options.profile,
          validateImagePaths: true,
        })
      : parseTsj(raw, {
          packIdSeed: options.packIdSeed,
          tilesetSeed,
          projectRoot: source.projectRoot,
          basePath: tileSource.path,
          profile: options.profile === 'assistive-infer' ? 'standard' : options.profile,
          validateImagePaths: true,
        });
    diagnostics.push(...parsed.diagnostics);
    if (parsed.value) compiled.push(parsed.value);
  }

  const rules: TiledSourcePackRuleRef[] = [];
  for (const ruleSource of ruleSources) {
    rules.push({
      path: ruleSource.path,
      kind: lowerSourcePath(ruleSource.path).endsWith('/rules.txt') ? 'rules-index' : 'rule-map',
      raw: await readExternalText(source.reader.readFile, ruleSource.path),
    });
  }

  if (compiled.length === 0 || hasBlockingDiagnostics(diagnostics)) {
    return { diagnostics };
  }

  return {
    value: {
      kind: 'source-pack',
      scan,
      pack: buildPack(options, source.sourcePath, compiled),
      sourceRoot: source.sourcePath,
      rules,
      diagnostics,
    },
    diagnostics,
  };
};

export function importTiled(
  source: Pick<TiledImportOptions, 'sourcePath' | 'projectRoot' | 'reader'> & {
    readonly sourcePath: `${string}.tsx` | `${string}.tsj`;
    readonly raw?: string;
  },
  options: Pick<TiledImportOptions, 'packIdSeed' | 'packName' | 'packVersion' | 'profile'>,
): Promise<{
  readonly value?: TiledTilesetPackImport;
  readonly diagnostics: readonly ParseDiagnostic[];
}>;
export function importTiled(
  source: Pick<TiledImportOptions, 'sourcePath' | 'projectRoot' | 'reader'> & {
    readonly raw?: string;
  },
  options: Pick<TiledImportOptions, 'packIdSeed' | 'packName' | 'packVersion' | 'profile'>,
): Promise<{
  readonly value?: TiledCanonicalImport;
  readonly diagnostics: readonly ParseDiagnostic[];
}>;
export async function importTiled(
  source: Pick<TiledImportOptions, 'sourcePath' | 'projectRoot' | 'reader'> & {
    readonly raw?: string;
  },
  options: Pick<TiledImportOptions, 'packIdSeed' | 'packName' | 'packVersion' | 'profile'>,
): Promise<{
  readonly value?: TiledAnyCanonicalImport;
  readonly diagnostics: readonly ParseDiagnostic[];
}> {
  if (
    source.raw === undefined &&
    !isMapSourcePath(source.sourcePath) &&
    !isTilesetSourcePath(source.sourcePath) &&
    source.reader?.readDirectory
  ) {
    const scan = await scanTiledSource(source);
    if (!scan.scan || scan.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
      return { diagnostics: scan.diagnostics };
    }
    return importSourceFolder(source, options, scan.scan);
  }
  const raw =
    source.raw ??
    (source.reader ? await readExternalText(source.reader.readFile, source.sourcePath) : undefined);
  if (raw === undefined) {
    return {
      diagnostics: [
        {
          _tag: 'TiledParseError',
          path: source.sourcePath,
          message: 'importTiled requires raw input or a reader',
          severity: 'error',
          format: source.sourcePath.toLowerCase().endsWith('.tmx') ? 'tmx' : 'tmj',
        },
      ],
    };
  }

  const scan = await scanTiledSource({ ...source, raw });
  if (!scan.scan || scan.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return { diagnostics: scan.diagnostics };
  }

  if (scan.scan.sourceKind === 'tileset') {
    return importStandaloneTileset(source, options, scan.scan, raw);
  }

  const parseOptions: TiledImportOptions = {
    sourcePath: source.sourcePath,
    projectRoot: source.projectRoot,
    ...(source.reader === undefined ? {} : { reader: source.reader }),
    ...options,
    profile: options.profile === 'assistive-infer' ? 'standard' : options.profile,
    validateImagePaths: true,
  };
  const parsed =
    source.sourcePath.toLowerCase().endsWith('.tmx') || raw.trimStart().startsWith('<')
      ? await parseTmx(raw, parseOptions)
      : await parseTmj(raw, parseOptions);
  if (!parsed.value || parsed.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return { diagnostics: [...scan.diagnostics, ...parsed.diagnostics] };
  }
  return {
    value: {
      kind: 'map',
      scan: scan.scan,
      pack: parsed.value.pack,
      map: parsed.value.map,
      tiledMap: parsed.value.tiledMap,
      diagnostics: [...scan.diagnostics, ...parsed.diagnostics],
    },
    diagnostics: [...scan.diagnostics, ...parsed.diagnostics],
  };
}
