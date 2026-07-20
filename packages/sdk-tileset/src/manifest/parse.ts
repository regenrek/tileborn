import { Option, Result, Schema, SchemaIssue } from 'effect';
import { AssetLicense } from '@tileborne/core';

import type { ParseDiagnostic, ParseResult } from '../diagnostics.js';
import type { AutotileRule } from '../schemas/autotile-rule.js';
import {
  Blob47AutotileRule,
  CustomAutotileRule,
  RpgmA2AutotileRule,
  RpgmA3AutotileRule,
  RpgmA4AutotileRule,
  Wang2CornerAutotileRule,
  Wang2EdgeAutotileRule,
  Wang4CornerAutotileRule,
} from '../schemas/autotile-rule.js';
import { Tile } from '../schemas/tile.js';
import { AssetSemanticRole } from '../schemas/semantic-role.js';
import { TerrainTransition } from '../schemas/terrain-transition.js';
import { CellSize, Tileset } from '../schemas/tileset.js';
import { TilesetPack, TilesetPackAsset, TilesetPackLicense } from '../schemas/tileset-pack.js';
import { VariantFilter } from '../schemas/variant-filter.js';
import {
  ManifestAutotileRule,
  TilesetManifest,
  TILESET_MANIFEST_SCHEMA_VERSION,
  type ManifestPlaceable,
  type ManifestPlaceableFrameRef,
  type ManifestSpriteClip,
  type ManifestAssetSemanticRole,
  type ManifestTiledPlaceableSource,
  type TilesetManifestLicense,
} from './schema-version.js';
import { inferAssetSemanticRoles } from './semantic-roles.js';
import {
  Placeable,
  PlaceableFrameRef,
  PlaceableSize,
  SpriteClip,
  TiledPlaceableSource,
} from '../schemas/placeable.js';

const optionalToOption = <A>(value: A | undefined): Option.Option<A> =>
  value === undefined ? Option.none() : Option.some(value);

const toPackLicense = (license: TilesetManifestLicense): TilesetPackLicense =>
  new TilesetPackLicense({
    spdxId: license.spdxId,
    attribution: optionalToOption(license.attribution),
    sourceUrl: optionalToOption(license.sourceUrl),
    sourcePath: license.sourcePath,
    modifications: license.modifications,
    notes: optionalToOption(license.notes),
    redistributable: license.redistributable ?? false,
  });

const toPlaceableFrameRef = (frame: ManifestPlaceableFrameRef): PlaceableFrameRef =>
  new PlaceableFrameRef({
    assetId: frame.assetId,
    tileId: frame.tileId,
    uv: frame.uv,
    durationMs: optionalToOption(frame.durationMs),
  });

const toSpriteClip = (clip: ManifestSpriteClip): SpriteClip =>
  new SpriteClip({
    id: clip.id,
    name: clip.name,
    frames: clip.frames.map(toPlaceableFrameRef) as [PlaceableFrameRef, ...PlaceableFrameRef[]],
    loop: clip.loop,
    defaultDurationMs: clip.defaultDurationMs,
  });

const toTiledPlaceableSource = (source: ManifestTiledPlaceableSource): TiledPlaceableSource =>
  new TiledPlaceableSource({
    format: source.format,
    tilesetName: source.tilesetName,
    localTileId: source.localTileId,
    image: optionalToOption(source.image),
    imageWidth: optionalToOption(source.imageWidth),
    imageHeight: optionalToOption(source.imageHeight),
    objectType: optionalToOption(source.objectType),
    objectClass: optionalToOption(source.objectClass),
    properties: source.properties,
  });

const toPlaceable = (placeable: ManifestPlaceable): Placeable =>
  new Placeable({
    id: placeable.id,
    name: placeable.name,
    size: new PlaceableSize(placeable.size),
    frames: placeable.frames.map(toPlaceableFrameRef) as [
      PlaceableFrameRef,
      ...PlaceableFrameRef[],
    ],
    ...(placeable.clips === undefined ? {} : { clips: placeable.clips.map(toSpriteClip) }),
    tags: placeable.tags,
    placementMode: placeable.placementMode ?? 'object',
    source: toTiledPlaceableSource(placeable.source),
  });

const toAssetSemanticRole = (role: ManifestAssetSemanticRole): AssetSemanticRole =>
  new AssetSemanticRole({
    role: role.role,
    tileId: role.tileId,
    source: role.source,
    confidence: role.confidence,
  });

const KNOWN_AUTOTILE_PATTERNS = new Set<string>([
  'wang2corner',
  'wang2edge',
  'wang4corner',
  'blob47',
  'rpgmA2',
  'rpgmA3',
  'rpgmA4',
  'custom',
]);

const formatIssuePath = (segments: readonly (string | number)[]): string =>
  segments.length === 0 ? '/' : `/${segments.map(String).join('/')}`;

const issueMessage = (issue: SchemaIssue.Issue): string => {
  switch (issue._tag) {
    case 'MissingKey':
      return 'Missing required field';
    case 'UnexpectedKey':
      return 'Unexpected field';
    case 'InvalidType':
      return 'Invalid type';
    case 'InvalidValue':
      return 'Invalid value';
    default:
      return SchemaIssue.makeFormatterDefault()(issue).trim();
  }
};

const flattenSchemaIssues = (
  issue: SchemaIssue.Issue,
  path: readonly (string | number)[] = [],
): ReadonlyArray<{ readonly path: string; readonly message: string }> => {
  switch (issue._tag) {
    case 'Composite':
      return issue.issues.flatMap((child) => flattenSchemaIssues(child, path));
    case 'Pointer':
      return flattenSchemaIssues(issue.issue, [
        ...path,
        ...issue.path.filter((segment): segment is string | number => typeof segment !== 'symbol'),
      ]);
    case 'MissingKey':
      return [{ path: formatIssuePath(path), message: issueMessage(issue) }];
    case 'UnexpectedKey':
      return [{ path: formatIssuePath(path), message: issueMessage(issue) }];
    default:
      return [{ path: formatIssuePath(path), message: issueMessage(issue) }];
  }
};

const schemaFailureDiagnostics = (error: Schema.SchemaError): readonly ParseDiagnostic[] =>
  flattenSchemaIssues(error.issue).map(({ path, message }) => ({
    _tag: 'InvalidManifestField' as const,
    path,
    message,
    severity: 'error' as const,
  }));

const collectUnknownAutotilePatterns = (json: unknown): readonly ParseDiagnostic[] => {
  if (typeof json !== 'object' || json === null || !('autotileRules' in json)) {
    return [];
  }

  const rules = (json as { autotileRules?: unknown }).autotileRules;
  if (!Array.isArray(rules)) {
    return [];
  }

  return rules.flatMap((rule, index) => {
    if (typeof rule !== 'object' || rule === null || !('_tag' in rule)) {
      return [];
    }

    const pattern = (rule as { _tag: unknown })._tag;
    if (typeof pattern !== 'string' || KNOWN_AUTOTILE_PATTERNS.has(pattern)) {
      return [];
    }

    return [
      {
        _tag: 'UnknownAutotilePattern' as const,
        path: `/autotileRules/${index}`,
        message: `Unsupported autotile pattern: ${pattern}`,
        severity: 'error' as const,
        pattern,
      },
    ];
  });
};

const terrainClassRefDiagnostics = (
  manifest: TilesetManifest,
  terrainClasses: ReadonlySet<string>,
): readonly ParseDiagnostic[] => {
  const diagnostics: ParseDiagnostic[] = [];

  const checkRef = (path: string, terrainClass: string | undefined) => {
    if (terrainClass === undefined || terrainClasses.has(terrainClass)) {
      return;
    }
    diagnostics.push({
      _tag: 'MissingTerrainClassRef',
      path,
      message: `Terrain class is not declared in terrainClasses: ${terrainClass}`,
      severity: 'error',
      terrainClass,
    });
  };

  manifest.tiles.forEach((tile, index) => {
    if (tile.terrainClass !== undefined) {
      checkRef(`/tiles/${index}/terrainClass`, tile.terrainClass);
    }
  });

  manifest.autotileRules.forEach((rule, index) => {
    rule.terrainClasses.forEach((terrainClass, classIndex) => {
      checkRef(`/autotileRules/${index}/terrainClasses/${classIndex}`, terrainClass);
    });
  });

  manifest.variantFilters.forEach((filter, index) => {
    if (filter.terrainClass !== undefined) {
      checkRef(`/variantFilters/${index}/terrainClass`, filter.terrainClass);
    }
  });

  manifest.terrainTransitions.forEach((transition, index) => {
    checkRef(`/terrainTransitions/${index}/from`, transition.from);
    checkRef(`/terrainTransitions/${index}/to`, transition.to);
  });

  return diagnostics;
};

type ManifestTile = TilesetManifest['tiles'][number];

/**
 * Groups tiles by tileset id in a single O(tiles) pass. Callers previously
 * re-filtered the flat `manifest.tiles` array once per tileset, which is
 * O(tilesets * tiles) and dominates parsing of large packs (tens of thousands
 * of tiles). Grouping once keeps the whole assemble/validate path O(tiles).
 */
const groupTilesByTilesetId = (tiles: readonly ManifestTile[]): Map<string, ManifestTile[]> => {
  const byTileset = new Map<string, ManifestTile[]>();
  for (const tile of tiles) {
    const key = String(tile.tilesetId);
    const bucket = byTileset.get(key);
    if (bucket === undefined) {
      byTileset.set(key, [tile]);
    } else {
      bucket.push(tile);
    }
  }
  return byTileset;
};

const tileIdSetFromTiles = (tiles: readonly ManifestTile[]): ReadonlySet<string> =>
  new Set(tiles.map((tile) => String(tile.id)));

const validateSemanticRules = (manifest: TilesetManifest): readonly ParseDiagnostic[] => {
  const diagnostics: ParseDiagnostic[] = [];
  const assetIds = new Set(manifest.assets.map((asset) => String(asset.id)));
  const terrainClasses = new Set(manifest.terrainClasses.map(String));
  const tilesetIds = new Set(manifest.tilesets.map((tileset) => String(tileset.id)));

  diagnostics.push(...terrainClassRefDiagnostics(manifest, terrainClasses));

  manifest.tilesets.forEach((tileset, index) => {
    if (tileset.cellSize.width <= 0 || tileset.cellSize.height <= 0) {
      diagnostics.push({
        _tag: 'InvalidCellSize',
        path: `/tilesets/${index}/cellSize`,
        message: 'Cell size must be positive',
        severity: 'error',
        width: tileset.cellSize.width,
        height: tileset.cellSize.height,
      });
    }

    if (tileset.margin < 0 || tileset.spacing < 0) {
      diagnostics.push({
        _tag: 'InvalidMarginSpacing',
        path: `/tilesets/${index}`,
        message: 'Margin and spacing must be non-negative',
        severity: 'warning',
        margin: tileset.margin,
        spacing: tileset.spacing,
      });
    }

    if (!assetIds.has(String(tileset.atlasAssetId))) {
      diagnostics.push({
        _tag: 'MissingAtlas',
        path: `/tilesets/${index}/atlasAssetId`,
        message: 'Atlas asset is not declared in pack assets',
        severity: 'error',
        atlasAssetId: String(tileset.atlasAssetId),
      });
    }
  });

  manifest.tiles.forEach((tile, index) => {
    if (!tilesetIds.has(String(tile.tilesetId))) {
      diagnostics.push({
        _tag: 'InvalidManifestField',
        path: `/tiles/${index}/tilesetId`,
        message: 'Tile references an unknown tileset',
        severity: 'error',
      });
    }

    if (tile.uv.w <= 0 || tile.uv.h <= 0) {
      diagnostics.push({
        _tag: 'InvalidUvRect',
        path: `/tiles/${index}/uv`,
        message: 'UV rect must have positive width and height',
        severity: 'error',
        x: tile.uv.x,
        y: tile.uv.y,
        w: tile.uv.w,
        h: tile.uv.h,
      });
    }
  });

  const tilesByTilesetId = groupTilesByTilesetId(manifest.tiles);
  const tileIdsByTileset = new Map<string, ReadonlySet<string>>();
  for (const tileset of manifest.tilesets) {
    const tilesetId = String(tileset.id);
    const tilesetTiles = tilesByTilesetId.get(tilesetId) ?? [];
    tileIdsByTileset.set(tilesetId, tileIdSetFromTiles(tilesetTiles));

    const seenTileIds = new Set<string>();
    tilesetTiles.forEach((tile, index) => {
      const tileId = String(tile.id);
      if (seenTileIds.has(tileId)) {
        diagnostics.push({
          _tag: 'DuplicateTileId',
          path: `/tiles/${index}/id`,
          message: 'Duplicate tile id in tileset',
          severity: 'error',
          tileId,
        });
      }
      seenTileIds.add(tileId);
    });
  }

  const animationById = new Map(
    manifest.animations.map((animation) => [String(animation.id), animation]),
  );
  manifest.tiles.forEach((tile, index) => {
    if (tile.animationId !== undefined) {
      const animationId = tile.animationId;
      const animation = animationById.get(String(animationId));
      if (animation === undefined) {
        diagnostics.push({
          _tag: 'InvalidManifestField',
          path: `/tiles/${index}/animationId`,
          message: 'Animation id is not declared in animations',
          severity: 'error',
        });
      } else {
        animation.frames.forEach((frame, frameIndex) => {
          const tileIds = tileIdsByTileset.get(String(tile.tilesetId));
          if (tileIds === undefined || !tileIds.has(String(frame.tileId))) {
            diagnostics.push({
              _tag: 'AnimationFrameOutOfBounds',
              path: `/animations/${String(animationId)}/frames/${frameIndex}`,
              message: 'Animation frame references an unknown tile',
              severity: 'error',
              animationId: String(animationId),
              frameIndex,
            });
          }
        });
      }
    }
  });

  const seenRuleIds = new Map<string, number>();
  manifest.autotileRules.forEach((rule, index) => {
    const ruleId = String(rule.id);
    if (seenRuleIds.has(ruleId)) {
      diagnostics.push({
        _tag: 'DuplicateAutotileRuleId',
        path: `/autotileRules/${index}/id`,
        message: 'Duplicate autotile rule id in tileset',
        severity: 'error',
        ruleId,
      });
    } else {
      seenRuleIds.set(ruleId, index);
    }

    if (!tilesetIds.has(String(rule.tilesetId))) {
      diagnostics.push({
        _tag: 'InvalidManifestField',
        path: `/autotileRules/${index}/tilesetId`,
        message: 'Autotile rule references an unknown tileset',
        severity: 'error',
      });
    }

    const tileIds = tileIdsByTileset.get(String(rule.tilesetId));
    if (tileIds !== undefined) {
      for (const [mask, tileIdList] of Object.entries(rule.maskToTileIds)) {
        for (const [tileIndex, tileId] of tileIdList.entries()) {
          if (!tileIds.has(String(tileId))) {
            diagnostics.push({
              _tag: 'InvalidManifestField',
              path: `/autotileRules/${index}/maskToTileIds/${mask}/${tileIndex}`,
              message: 'Autotile rule references an unknown tile',
              severity: 'warning',
            });
          }
        }
      }
    }
  });

  manifest.variantFilters.forEach((filter, index) => {
    if (!tilesetIds.has(String(filter.tilesetId))) {
      diagnostics.push({
        _tag: 'InvalidManifestField',
        path: `/variantFilters/${index}/tilesetId`,
        message: 'Variant filter references an unknown tileset',
        severity: 'error',
      });
    }

    if (filter.weights.length !== filter.tileIds.length) {
      diagnostics.push({
        _tag: 'VariantWeightCountMismatch',
        path: `/variantFilters/${index}`,
        message: 'Variant filter weights must match tile id count',
        severity: 'error',
        filterId: String(filter.id),
        tileCount: filter.tileIds.length,
        weightCount: filter.weights.length,
      });
    }

    filter.weights.forEach((weight, weightIndex) => {
      if (weight < 0) {
        diagnostics.push({
          _tag: 'VariantWeightOutOfRange',
          path: `/variantFilters/${index}/weights/${weightIndex}`,
          message: 'Variant weight must be non-negative',
          severity: 'warning',
          filterId: String(filter.id),
          weightIndex,
          weight,
        });
      }
    });

    if (filter.weights.every((weight) => weight <= 0)) {
      diagnostics.push({
        _tag: 'EmptyVariantSelection',
        path: `/variantFilters/${index}`,
        message: 'No positive variant weights; using first tile as fallback',
        severity: 'warning',
        filterId: String(filter.id),
      });
    }
  });

  manifest.terrainTransitions.forEach((transition, index) => {
    if (!tilesetIds.has(String(transition.tilesetId))) {
      diagnostics.push({
        _tag: 'InvalidManifestField',
        path: `/terrainTransitions/${index}/tilesetId`,
        message: 'Terrain transition references an unknown tileset',
        severity: 'error',
      });
    }

    if (!seenRuleIds.has(String(transition.ruleId))) {
      diagnostics.push({
        _tag: 'InvalidManifestField',
        path: `/terrainTransitions/${index}/ruleId`,
        message: 'Terrain transition references an unknown autotile rule',
        severity: 'error',
      });
    }
  });

  manifest.collisionMasks.forEach((entry, index) => {
    const tile = manifest.tiles.find((candidate) => String(candidate.id) === String(entry.tileId));
    if (tile === undefined) {
      diagnostics.push({
        _tag: 'InvalidManifestField',
        path: `/collisionMasks/${index}/tileId`,
        message: 'Collision mask references an unknown tile',
        severity: 'error',
      });
    }
  });

  manifest.placeables?.forEach((placeable, placeableIndex) => {
    if (placeable.size.width <= 0 || placeable.size.height <= 0) {
      diagnostics.push({
        _tag: 'InvalidManifestField',
        path: `/placeables/${placeableIndex}/size`,
        message: 'Placeable size must be positive',
        severity: 'error',
      });
    }

    placeable.frames.forEach((frame, frameIndex) => {
      if (!assetIds.has(String(frame.assetId))) {
        diagnostics.push({
          _tag: 'InvalidManifestField',
          path: `/placeables/${placeableIndex}/frames/${frameIndex}/assetId`,
          message: 'Placeable frame references an unknown asset',
          severity: 'error',
        });
      }

      if (frame.uv.w <= 0 || frame.uv.h <= 0) {
        diagnostics.push({
          _tag: 'InvalidUvRect',
          path: `/placeables/${placeableIndex}/frames/${frameIndex}/uv`,
          message: 'UV rect must have positive width and height',
          severity: 'error',
          x: frame.uv.x,
          y: frame.uv.y,
          w: frame.uv.w,
          h: frame.uv.h,
        });
      }
    });

    const seenClipIds = new Set<string>();
    placeable.clips?.forEach((clip, clipIndex) => {
      const clipId = String(clip.id);
      if (seenClipIds.has(clipId)) {
        diagnostics.push({
          _tag: 'InvalidManifestField',
          path: `/placeables/${placeableIndex}/clips/${clipIndex}/id`,
          message: 'Duplicate clip id on placeable',
          severity: 'error',
        });
      }
      seenClipIds.add(clipId);

      clip.frames.forEach((frame, frameIndex) => {
        if (!assetIds.has(String(frame.assetId))) {
          diagnostics.push({
            _tag: 'InvalidManifestField',
            path: `/placeables/${placeableIndex}/clips/${clipIndex}/frames/${frameIndex}/assetId`,
            message: 'Clip frame references an unknown asset',
            severity: 'error',
          });
        }

        if (frame.uv.w <= 0 || frame.uv.h <= 0) {
          diagnostics.push({
            _tag: 'InvalidUvRect',
            path: `/placeables/${placeableIndex}/clips/${clipIndex}/frames/${frameIndex}/uv`,
            message: 'UV rect must have positive width and height',
            severity: 'error',
            x: frame.uv.x,
            y: frame.uv.y,
            w: frame.uv.w,
            h: frame.uv.h,
          });
        }
      });
    });
  });

  return diagnostics;
};

const hasBlockingDiagnostics = (diagnostics: readonly ParseDiagnostic[]): boolean =>
  diagnostics.some((diagnostic) => diagnostic.severity === 'error');

const sanitizeMaskToTileIds = (
  maskToTileIds: ManifestAutotileRule['maskToTileIds'],
  validTileIds: ReadonlySet<string> | undefined,
): ManifestAutotileRule['maskToTileIds'] => {
  if (validTileIds === undefined) {
    return maskToTileIds;
  }
  const sanitized: Record<
    string,
    [
      ManifestAutotileRule['maskToTileIds'][string][number],
      ...ManifestAutotileRule['maskToTileIds'][string][number][],
    ]
  > = {};
  for (const [mask, tileIds] of Object.entries(maskToTileIds)) {
    const valid = tileIds.filter((tileId) => validTileIds.has(String(tileId)));
    if (valid[0] !== undefined) {
      sanitized[mask] = valid as [(typeof valid)[number], ...(typeof valid)[number][]];
    }
  }
  return sanitized;
};

const fallbackTileIdOption = (
  fallbackTileId: ManifestAutotileRule['fallbackTileId'],
  validTileIds: ReadonlySet<string> | undefined,
) =>
  fallbackTileId === undefined || validTileIds?.has(String(fallbackTileId)) === false
    ? Option.none()
    : Option.some(fallbackTileId);

const toAutotileRule = (
  rule: ManifestAutotileRule,
  validTileIds?: ReadonlySet<string> | undefined,
): AutotileRule => {
  const base = {
    id: rule.id,
    name: rule.name,
    terrainClasses: rule.terrainClasses,
    maskToTileIds: sanitizeMaskToTileIds(rule.maskToTileIds, validTileIds),
    fallbackTileId: fallbackTileIdOption(rule.fallbackTileId, validTileIds),
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
    default: {
      const unreachable: never = rule;
      throw new Error(`Unsupported autotile rule tag: ${String(unreachable)}`);
    }
  }
};

const assembleTilesetPack = (manifest: TilesetManifest): TilesetPack => {
  const animationById = new Map(
    manifest.animations.map((animation) => [String(animation.id), animation]),
  );
  const collisionByTileId = new Map(
    manifest.collisionMasks.map((entry) => [String(entry.tileId), entry.mask]),
  );
  const tilesByTilesetId = groupTilesByTilesetId(manifest.tiles);
  const tileIdsByTileset = new Map<string, ReadonlySet<string>>();
  for (const tileset of manifest.tilesets) {
    const tilesetId = String(tileset.id);
    tileIdsByTileset.set(tilesetId, tileIdSetFromTiles(tilesByTilesetId.get(tilesetId) ?? []));
  }

  const tilesets = manifest.tilesets.map((entry) => {
    const tilesetId = String(entry.id);
    const tiles = (tilesByTilesetId.get(tilesetId) ?? []).map(
      (tile) =>
        new Tile({
          id: tile.id,
          uv: tile.uv,
          tags: tile.tags,
          terrainClass: optionalToOption(tile.terrainClass),
          collisionMask: Option.fromNullishOr(collisionByTileId.get(String(tile.id))),
          animation:
            tile.animationId === undefined
              ? Option.none()
              : Option.fromNullishOr(animationById.get(String(tile.animationId))),
        }),
    );

    const autotileRules = manifest.autotileRules
      .filter((rule) => String(rule.tilesetId) === tilesetId)
      .map((rule) => toAutotileRule(rule, tileIdsByTileset.get(tilesetId)));

    const variantFilters = manifest.variantFilters
      .filter((filter) => String(filter.tilesetId) === tilesetId)
      .map(
        (filter) =>
          new VariantFilter({
            id: filter.id,
            terrainClass: optionalToOption(filter.terrainClass),
            tileIds: filter.tileIds,
            weights: filter.weights,
            seedSalt: filter.seedSalt,
            stableAcrossAnimationFrames: filter.stableAcrossAnimationFrames,
          }),
      );

    const terrainTransitions = manifest.terrainTransitions
      .filter((transition) => String(transition.tilesetId) === tilesetId)
      .map(
        (transition) =>
          new TerrainTransition({
            from: transition.from,
            to: transition.to,
            ruleId: transition.ruleId,
          }),
      );

    return new Tileset({
      id: entry.id,
      name: entry.name,
      atlasAssetId: entry.atlasAssetId,
      cellSize: new CellSize(entry.cellSize),
      margin: entry.margin,
      spacing: entry.spacing,
      tiles,
      autotileRules,
      variantFilters,
      terrainTransitions,
    });
  });

  const pack = new TilesetPack({
    schemaVersion: TILESET_MANIFEST_SCHEMA_VERSION,
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    license: toPackLicense(manifest.license),
    tilesets,
    assets: manifest.assets.map(
      (asset) =>
        new TilesetPackAsset({
          id: asset.id,
          path: asset.path,
          mime: asset.mime,
          ...(asset.license === undefined
            ? {}
            : { license: new AssetLicense({ ...asset.license }) }),
        }),
    ),
    placeables: manifest.placeables?.map(toPlaceable),
    semanticRoles: manifest.assetSemanticRoles?.map(toAssetSemanticRole),
  });
  return pack.semanticRoles === undefined
    ? new TilesetPack({ ...pack, semanticRoles: inferAssetSemanticRoles(pack) })
    : pack;
};

/** Decode canonical Tileborne manifest JSON into a typed `TilesetPack`. */
export const parseTilesetManifest = (json: unknown): ParseResult<TilesetPack> => {
  const patternDiagnostics = collectUnknownAutotilePatterns(json);
  if (patternDiagnostics.length > 0) {
    return { diagnostics: patternDiagnostics };
  }

  const decoded = Schema.decodeUnknownResult(TilesetManifest)(json);
  if (Result.isFailure(decoded)) {
    return { diagnostics: schemaFailureDiagnostics(decoded.failure) };
  }

  const semanticDiagnostics = validateSemanticRules(decoded.success);
  if (hasBlockingDiagnostics(semanticDiagnostics)) {
    return { diagnostics: semanticDiagnostics };
  }

  return {
    value: assembleTilesetPack(decoded.success),
    diagnostics: semanticDiagnostics,
  };
};
