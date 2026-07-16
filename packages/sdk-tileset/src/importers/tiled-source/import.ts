import { Option, Schema } from 'effect';

import type { ParseDiagnostic, ParseResult } from '../../diagnostics.js';
import {
  Blob47AutotileRule,
  CustomAutotileRule,
  RpgmA2AutotileRule,
  RpgmA3AutotileRule,
  RpgmA4AutotileRule,
  Wang2CornerAutotileRule,
  Wang2EdgeAutotileRule,
  Wang4CornerAutotileRule,
  type AutotileRule,
} from '../../schemas/autotile-rule.js';
import { createManifestProvenance, type ManifestProvenance } from '../../manifest/index.js';
import { inferAssetSemanticRoles } from '../../manifest/semantic-roles.js';
import { compileTileMetadata, type CompiledTileMetadata } from '../../metadata/index.js';
import { TerrainClass } from '../../schemas/terrain-class.js';
import { TerrainTransition } from '../../schemas/terrain-transition.js';
import { Tileset } from '../../schemas/tileset.js';
import type { Placeable } from '../../schemas/placeable.js';
import { TilesetPack, TilesetPackAsset, TilesetPackLicense } from '../../schemas/tileset-pack.js';
import type { TiledJsonTileset, TiledMapImport, TiledSourceInventory } from '../../tiled/types.js';
import { buildTiledSourceInventory } from '../../tiled/source-inventory.js';
import {
  convertTiledXmlTileset,
  parseTiledXmlDocument,
  xmlTilesetRoot,
} from '../../tiled/xml-common.js';
import { parseTmx, parseTsx } from '../../tiled/index.js';
import { deterministicPackId } from '../../tiled/deterministic-ids.js';
import type { TileId } from '../../schemas/ids.js';

import { applyUnityMetaAnimationFallback, parseUnityMetaSprites } from './unity-meta-fallback.js';
import {
  attachTileProvenanceTags,
  captureTileProvenance,
  type TiledSourceTileProvenance,
} from './provenance-meta.js';
import { compileTiledSourceWallRulePhase } from './wall-rules.js';

export type TiledSourceReadFile = (
  path: string,
) => Promise<string | Uint8Array> | string | Uint8Array;

export type ImportTiledSourceInput = {
  readonly sourceRoot: string;
  readonly readFile: TiledSourceReadFile;
  readonly tsxFiles?: readonly string[];
  readonly mapFiles?: readonly string[];
  readonly ruleFiles?: readonly string[];
  readonly packName?: string;
  readonly packVersion?: string;
  readonly importedAt?: string;
};

export type TiledSourceImportResult = ParseResult<TilesetPack> & {
  readonly provenance: ManifestProvenance;
  readonly maps: readonly TiledMapImport[];
  readonly tileMetadata: readonly CompiledTileMetadata[];
  readonly tileProvenance: readonly TiledSourceTileProvenance[];
  readonly sourceInventory: TiledSourceInventory;
};

const PACK_SEED = 'tiled-source';

type ImportedTileset = {
  readonly sourcePath: string;
  readonly source: TiledJsonTileset;
  readonly tileset: Tileset;
  readonly assets: readonly TilesetPackAsset[];
  readonly placeables: readonly Placeable[];
};

const normalizeRelativePath = (path: string): string => {
  const segments: string[] = [];
  for (const segment of path.replaceAll('\\', '/').split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join('/');
};

const trimTrailingSlash = (path: string): string =>
  path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;

const absolutePath = (sourceRoot: string, relativePath: string): string =>
  `${trimTrailingSlash(sourceRoot)}/${normalizeRelativePath(relativePath)}`;

const dirname = (path: string): string => {
  const normalized = path.replaceAll('\\', '/');
  const index = normalized.lastIndexOf('/');
  return index <= 0 ? '.' : normalized.slice(0, index);
};

const basename = (path: string): string => path.replaceAll('\\', '/').split('/').pop() ?? path;

const resolveRelative = (basePath: string, source: string): string => {
  if (source.startsWith('/')) {
    return normalizeRelativePath(source);
  }
  return normalizeRelativePath(`${dirname(basePath)}/${source}`);
};

const tilesetSeed = (sourcePath: string): string => basename(sourcePath).replace(/\.tsx$/i, '');

const readText = async (readFile: TiledSourceReadFile, path: string): Promise<string> => {
  const raw = await readFile(path);
  return typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
};

const readOptionalText = async (
  readFile: TiledSourceReadFile,
  path: string,
): Promise<string | undefined> => {
  try {
    return await readText(readFile, path);
  } catch {
    return undefined;
  }
};

const tsxParseError = (sourcePath: string, message: string): ParseDiagnostic => ({
  _tag: 'TiledSourceTsxParseError',
  path: sourcePath,
  message,
  severity: 'error',
  sourcePath,
});

const missingImage = (sourcePath: string, imagePath: string): ParseDiagnostic => ({
  _tag: 'TiledSourceMissingImageRef',
  path: imagePath,
  message: `Referenced Tiled source image is missing: ${imagePath}`,
  severity: 'error',
  sourcePath,
  imagePath,
});

const metadataCompileError = (
  sourcePath: string,
  localTileId: number,
  message: string,
): ParseDiagnostic => ({
  _tag: 'TiledSourceMetadataCompileError',
  path: `${sourcePath}/tile/${localTileId}`,
  message,
  severity: 'warning',
  sourcePath,
  localTileId,
});

const parseTilesetSource = (
  raw: string,
  sourcePath: string,
): { readonly value?: TiledJsonTileset; readonly diagnostics: readonly ParseDiagnostic[] } => {
  const parsed = parseTiledXmlDocument(raw);
  if (!parsed.ok) {
    return { diagnostics: [tsxParseError(sourcePath, parsed.error)] };
  }
  const root = xmlTilesetRoot(parsed.value);
  if (!root) {
    return { diagnostics: [tsxParseError(sourcePath, 'TSX file is missing a <tileset> root')] };
  }
  try {
    return { value: convertTiledXmlTileset(root), diagnostics: [] };
  } catch (error) {
    return { diagnostics: [tsxParseError(sourcePath, (error as Error).message)] };
  }
};

const discoverTsxRefs = (mapPath: string, raw: string): readonly string[] => {
  const refs: string[] = [];
  for (const match of raw.matchAll(/source="([^"]+\.tsx)"/g)) {
    if (match[1] !== undefined && !match[1].startsWith(':')) {
      refs.push(resolveRelative(mapPath, match[1]));
    }
  }
  return refs;
};

const resolveImagePaths = (sourcePath: string, source: TiledJsonTileset): readonly string[] => {
  const images = [
    ...(source.image === undefined ? [] : [source.image]),
    ...(source.tiles ?? []).flatMap((tile) => (tile.image === undefined ? [] : [tile.image])),
  ];
  return [...new Set(images.map((image) => resolveRelative(sourcePath, image)))];
};

const verifyImages = async (input: {
  readonly sourceRoot: string;
  readonly sourcePath: string;
  readonly source: TiledJsonTileset;
  readonly readFile: TiledSourceReadFile;
}): Promise<readonly ParseDiagnostic[]> => {
  const diagnostics: ParseDiagnostic[] = [];
  for (const imagePath of resolveImagePaths(input.sourcePath, input.source)) {
    try {
      await input.readFile(absolutePath(input.sourceRoot, imagePath));
    } catch {
      diagnostics.push(missingImage(input.sourcePath, imagePath));
    }
  }
  return diagnostics;
};

const rewriteAssets = (
  sourcePath: string,
  assets: readonly TilesetPackAsset[],
): readonly TilesetPackAsset[] =>
  assets.map(
    (asset) =>
      new TilesetPackAsset({
        id: asset.id,
        path: resolveRelative(sourcePath, asset.path),
        mime: asset.mime,
      }),
  );

const tilesetHasAnimations = (tileset: Tileset): boolean =>
  tileset.tiles.some((tile) =>
    Option.match(tile.animation, {
      onNone: () => false,
      onSome: () => true,
    }),
  );

const terrainClassFromName = (name: string): typeof TerrainClass.Type =>
  Schema.decodeUnknownSync(TerrainClass)(`tiled-source:${name.replace(/[^A-Za-z0-9:_-]+/g, '-')}`);

const addInferredTerrainTransitions = (tileset: Tileset): Tileset => {
  if (tileset.terrainTransitions.length > 0 || tileset.autotileRules.length === 0) {
    return tileset;
  }
  const transitionMatch = /\b(.+?)\s+to\s+(.+?)\b/i.exec(tileset.name);
  if (transitionMatch?.[1] === undefined || transitionMatch[2] === undefined) {
    return tileset;
  }
  const transition = new TerrainTransition({
    from: terrainClassFromName(transitionMatch[1]),
    to: terrainClassFromName(transitionMatch[2]),
    ruleId: tileset.autotileRules[0]!.id,
  });
  return new Tileset({
    id: tileset.id,
    name: tileset.name,
    atlasAssetId: tileset.atlasAssetId,
    cellSize: tileset.cellSize,
    margin: tileset.margin,
    spacing: tileset.spacing,
    tiles: tileset.tiles,
    autotileRules: tileset.autotileRules,
    variantFilters: tileset.variantFilters,
    terrainTransitions: [transition],
  });
};

const compileImportedTilesetMetadata = (
  imported: ImportedTileset,
): {
  readonly metadata: readonly CompiledTileMetadata[];
  readonly diagnostics: readonly ParseDiagnostic[];
} => {
  const explicitTiles = new Map(
    (imported.source.tiles ?? []).map((tile) => [tile.id, tile] as const),
  );
  const metadata: CompiledTileMetadata[] = [];
  const diagnostics: ParseDiagnostic[] = [];
  for (const [localTileId, tile] of imported.tileset.tiles.entries()) {
    const explicit = explicitTiles.get(localTileId);
    try {
      const compiled = compileTileMetadata({
        tileId: tile.id,
        path: `${imported.sourcePath}/tile/${localTileId}`,
        cellSize: imported.tileset.cellSize,
        tags: tile.tags,
        tiled: {
          ...(explicit?.properties === undefined ? {} : { properties: explicit.properties }),
          ...(explicit?.type === undefined ? {} : { type: explicit.type }),
          ...(explicit?.class === undefined ? {} : { class: explicit.class }),
          ...(explicit?.objectgroup?.objects === undefined
            ? {}
            : { objectgroupObjects: explicit.objectgroup.objects }),
        },
      });
      metadata.push(compiled.value);
      diagnostics.push(...compiled.diagnostics);
    } catch (error) {
      diagnostics.push(
        metadataCompileError(imported.sourcePath, localTileId, (error as Error).message),
      );
    }
  }
  return { metadata, diagnostics };
};

const compileTsx = async (input: {
  readonly sourceRoot: string;
  readonly sourcePath: string;
  readonly readFile: TiledSourceReadFile;
}): Promise<{
  readonly value?: ImportedTileset;
  readonly diagnostics: readonly ParseDiagnostic[];
}> => {
  const absPath = absolutePath(input.sourceRoot, input.sourcePath);
  let raw: string;
  try {
    raw = await readText(input.readFile, absPath);
  } catch (error) {
    return {
      diagnostics: [
        tsxParseError(input.sourcePath, `Failed to read TSX: ${(error as Error).message}`),
      ],
    };
  }

  const source = parseTilesetSource(raw, input.sourcePath);
  const compiled = parseTsx(raw, {
    packIdSeed: PACK_SEED,
    tilesetSeed: tilesetSeed(input.sourcePath),
  });
  const diagnostics = [...source.diagnostics, ...compiled.diagnostics];
  if (source.value === undefined || compiled.value === undefined) {
    return {
      diagnostics: [
        ...diagnostics,
        ...(compiled.value === undefined
          ? [tsxParseError(input.sourcePath, 'TSX did not compile into a tileset')]
          : []),
      ],
    };
  }

  diagnostics.push(
    ...(await verifyImages({
      sourceRoot: input.sourceRoot,
      sourcePath: input.sourcePath,
      source: source.value,
      readFile: input.readFile,
    })),
  );

  let tileset = compiled.value.tileset;
  const imagePath =
    source.value.image === undefined
      ? undefined
      : resolveRelative(input.sourcePath, source.value.image);
  if (imagePath !== undefined) {
    const rawMeta = await readOptionalText(
      input.readFile,
      absolutePath(input.sourceRoot, `${imagePath}.meta`),
    );
    if (rawMeta !== undefined && !tilesetHasAnimations(tileset)) {
      const fallback = applyUnityMetaAnimationFallback({
        tileset,
        source: source.value,
        sourcePath: input.sourcePath,
        sprites: parseUnityMetaSprites(rawMeta),
      });
      tileset = fallback.tileset;
    }
  }

  tileset = addInferredTerrainTransitions(attachTileProvenanceTags(tileset, input.sourcePath));

  return {
    value: {
      sourcePath: input.sourcePath,
      source: source.value,
      tileset,
      assets: rewriteAssets(input.sourcePath, compiled.value.assets),
      placeables: compiled.value.placeables,
    },
    diagnostics,
  };
};

const addWallRules = (
  imported: readonly ImportedTileset[],
  rulesBySource: ReadonlyMap<string, readonly AutotileRule[]>,
): readonly ImportedTileset[] =>
  imported.map((entry) => {
    const tileIds = new Set(entry.tileset.tiles.map((tile) => String(tile.id)));
    const rules = (rulesBySource.get(entry.sourcePath) ?? []).map((rule) =>
      sanitizeAutotileRule(rule, tileIds),
    );
    if (rules.length === 0) {
      return entry;
    }
    return {
      ...entry,
      tileset: new Tileset({
        id: entry.tileset.id,
        name: entry.tileset.name,
        atlasAssetId: entry.tileset.atlasAssetId,
        cellSize: entry.tileset.cellSize,
        margin: entry.tileset.margin,
        spacing: entry.tileset.spacing,
        tiles: entry.tileset.tiles,
        autotileRules: [...entry.tileset.autotileRules, ...rules],
        variantFilters: entry.tileset.variantFilters,
        terrainTransitions: entry.tileset.terrainTransitions,
      }),
    };
  });

const sanitizeAutotileRule = (rule: AutotileRule, tileIds: ReadonlySet<string>): AutotileRule => {
  const maskToTileIds: Record<string, [TileId, ...TileId[]]> = {};
  for (const [mask, ids] of Object.entries(rule.maskToTileIds)) {
    const filtered = ids.filter((tileId) => tileIds.has(String(tileId)));
    const first = filtered[0];
    if (first !== undefined) {
      maskToTileIds[mask] = [first, ...filtered.slice(1)];
    }
  }
  const fallbackTileId = Option.filter(rule.fallbackTileId, (tileId) =>
    tileIds.has(String(tileId)),
  );
  const base = {
    id: rule.id,
    name: rule.name,
    terrainClasses: rule.terrainClasses,
    maskToTileIds,
    fallbackTileId,
  };
  switch (rule._tag) {
    case 'wang2corner':
      return new Wang2CornerAutotileRule(base);
    case 'wang2edge':
      return new Wang2EdgeAutotileRule(base);
    case 'wang4corner':
      return new Wang4CornerAutotileRule(base);
    case 'blob47':
      return new Blob47AutotileRule(base);
    case 'rpgmA2':
      return new RpgmA2AutotileRule(base);
    case 'rpgmA3':
      return new RpgmA3AutotileRule(base);
    case 'rpgmA4':
      return new RpgmA4AutotileRule(base);
    case 'custom':
      return new CustomAutotileRule({ ...base, source: rule.source });
  }
};

const dedupeAssets = (assets: readonly TilesetPackAsset[]): readonly TilesetPackAsset[] => {
  const byId = new Map<string, TilesetPackAsset>();
  for (const asset of assets) {
    byId.set(String(asset.id), asset);
  }
  return [...byId.values()];
};

export const importTiledSource = async (
  input: ImportTiledSourceInput,
): Promise<TiledSourceImportResult> => {
  const diagnostics: ParseDiagnostic[] = [];
  const mapFiles = input.mapFiles ?? [];
  const rawMaps = new Map<string, string>();
  const discoveredTsx = new Set(input.tsxFiles ?? []);

  for (const mapPath of mapFiles) {
    const raw = await readOptionalText(input.readFile, absolutePath(input.sourceRoot, mapPath));
    if (raw === undefined) {
      continue;
    }
    rawMaps.set(mapPath, raw);
    for (const tsxRef of discoverTsxRefs(mapPath, raw)) {
      discoveredTsx.add(tsxRef);
    }
  }

  const imported: ImportedTileset[] = [];
  for (const sourcePath of discoveredTsx) {
    const result = await compileTsx({
      sourceRoot: input.sourceRoot,
      sourcePath,
      readFile: input.readFile,
    });
    diagnostics.push(...result.diagnostics);
    if (result.value !== undefined) {
      imported.push(result.value);
    }
  }

  const bySource = new Map(imported.map((entry) => [entry.sourcePath, entry] as const));
  const byBasename = new Map(imported.map((entry) => [basename(entry.sourcePath), entry] as const));
  const tileIdForSource = (sourcePath: string, localTileId: number) => {
    const entry =
      bySource.get(normalizeRelativePath(sourcePath)) ?? byBasename.get(basename(sourcePath));
    return entry?.tileset.tiles[localTileId]?.id;
  };

  const rulesBySource = new Map<string, import('../../schemas/autotile-rule.js').AutotileRule[]>();
  for (const rulePath of input.ruleFiles ?? []) {
    const raw = await readOptionalText(input.readFile, absolutePath(input.sourceRoot, rulePath));
    if (raw === undefined) {
      continue;
    }
    const compiled = compileTiledSourceWallRulePhase({ rulePath, raw, tileIdForSource });
    diagnostics.push(...compiled.diagnostics);
    if (compiled.value !== undefined) {
      const bucket = rulesBySource.get(compiled.value.tilesetSourcePath) ?? [];
      bucket.push(compiled.value.rule);
      rulesBySource.set(compiled.value.tilesetSourcePath, bucket);
    }
  }

  const withWallRules = addWallRules(imported, rulesBySource);
  const maps: TiledMapImport[] = [];
  const exampleMaps: Array<{
    readonly path: string;
    readonly width: number;
    readonly height: number;
    readonly tileWidth: number;
    readonly tileHeight: number;
  }> = [];
  for (const [mapPath, raw] of rawMaps) {
    const parsed = await parseTmx(raw, {
      packIdSeed: PACK_SEED,
      packName: input.packName ?? 'Tiled source',
      projectRoot: trimTrailingSlash(input.sourceRoot),
      sourcePath: absolutePath(input.sourceRoot, mapPath),
      reader: { readFile: input.readFile },
    });
    diagnostics.push(...parsed.diagnostics);
    if (parsed.value !== undefined) {
      maps.push(parsed.value.tiledMap);
      exampleMaps.push({
        path: mapPath,
        width: parsed.value.tiledMap.width,
        height: parsed.value.tiledMap.height,
        tileWidth: parsed.value.tiledMap.tileWidth,
        tileHeight: parsed.value.tiledMap.tileHeight,
      });
    }
  }

  const metadataResults = withWallRules.map(compileImportedTilesetMetadata);
  diagnostics.push(...metadataResults.flatMap((result) => result.diagnostics));
  const sourceInventory = buildTiledSourceInventory({
    tilesets: withWallRules.map((entry) => ({ tileset: entry.source, source: entry.sourcePath })),
    rules: input.ruleFiles ?? [],
    exampleMaps,
  });

  const packWithoutRoles = new TilesetPack({
    schemaVersion: 1,
    id: deterministicPackId(PACK_SEED),
    name: input.packName ?? 'Tiled source',
    version: input.packVersion ?? '1.0.0',
    license: new TilesetPackLicense({
      spdxId: 'UNKNOWN',
      attribution: Option.some('Tiled source asset pack'),
      sourceUrl: Option.none(),
      notes: Option.some(input.sourceRoot),
      redistributable: false,
    }),
    tilesets: withWallRules.map((entry) => entry.tileset),
    assets: dedupeAssets(withWallRules.flatMap((entry) => entry.assets)),
    placeables: withWallRules.flatMap((entry) => entry.placeables),
  });
  const pack = new TilesetPack({
    ...packWithoutRoles,
    semanticRoles: inferAssetSemanticRoles(packWithoutRoles),
  });

  return {
    value: pack,
    diagnostics,
    provenance: createManifestProvenance({
      sourcePath: input.sourceRoot,
      originTool: 'tileborne-tiled-source-importer',
      ...(input.importedAt === undefined ? {} : { importedAt: input.importedAt }),
    }),
    maps,
    tileMetadata: metadataResults.flatMap((result) => result.metadata),
    tileProvenance: withWallRules.flatMap((entry) =>
      captureTileProvenance(entry.tileset, entry.sourcePath),
    ),
    sourceInventory,
  };
};
