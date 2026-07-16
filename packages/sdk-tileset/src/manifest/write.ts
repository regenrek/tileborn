import { Option, Schema } from 'effect';

import { Animation } from '../schemas/animation.js';
import { CollisionMask } from '../schemas/collision-mask.js';
import type { TilesetPack } from '../schemas/tileset-pack.js';
import type { Tile } from '../schemas/tile.js';
import type { AssetSemanticRole } from '../schemas/semantic-role.js';
import type { ManifestProvenanceInput } from './provenance.js';
import { inferAssetSemanticRoles } from './semantic-roles.js';
import { TILESET_MANIFEST_SCHEMA_VERSION } from './schema-version.js';

const optionProperty = <K extends string, A>(
  key: K,
  value: Option.Option<A>,
): Partial<Record<K, A>> =>
  Option.match(value, {
    onNone: () => ({}),
    onSome: (inner) => ({ [key]: inner }) as Record<K, A>,
  });

const licenseToJson = (license: TilesetPack['license']) => ({
  spdxId: license.spdxId,
  ...optionProperty('attribution', license.attribution),
  ...optionProperty('sourceUrl', license.sourceUrl),
  ...optionProperty('notes', license.notes),
  redistributable: license.redistributable,
});

const encodeCollisionMask = (mask: typeof CollisionMask.Type): unknown =>
  Schema.encodeUnknownSync(CollisionMask)(mask);

const uvToJson = (uv: Tile['uv']) => ({
  x: uv.x,
  y: uv.y,
  w: uv.w,
  h: uv.h,
});

const sizeToJson = (size: NonNullable<TilesetPack['placeables']>[number]['size']) => ({
  width: size.width,
  height: size.height,
});

const cellSizeToJson = (cellSize: TilesetPack['tilesets'][number]['cellSize']) => ({
  width: cellSize.width,
  height: cellSize.height,
});

const animationToJson = (animation: Animation) => ({
  id: animation.id,
  frames: animation.frames.map((frame) => ({
    tileId: frame.tileId,
    durationMs: frame.durationMs,
  })),
  loop: animation.loop,
});

const frameToJson = (frame: NonNullable<TilesetPack['placeables']>[number]['frames'][number]) => ({
  assetId: frame.assetId,
  tileId: frame.tileId,
  uv: uvToJson(frame.uv),
  ...optionProperty('durationMs', frame.durationMs),
});

const clipToJson = (
  clip: NonNullable<NonNullable<TilesetPack['placeables']>[number]['clips']>[number],
) => ({
  id: clip.id,
  name: clip.name,
  frames: clip.frames.map(frameToJson),
  loop: clip.loop,
  defaultDurationMs: clip.defaultDurationMs,
});

const placeablesToJson = (placeables: TilesetPack['placeables']) =>
  (placeables ?? []).map((placeable) => ({
    id: placeable.id,
    name: placeable.name,
    size: sizeToJson(placeable.size),
    frames: placeable.frames.map(frameToJson),
    ...(placeable.clips === undefined ? {} : { clips: placeable.clips.map(clipToJson) }),
    tags: placeable.tags,
    placementMode: placeable.placementMode,
    source: {
      format: placeable.source.format,
      tilesetName: placeable.source.tilesetName,
      localTileId: placeable.source.localTileId,
      ...optionProperty('image', placeable.source.image),
      ...optionProperty('imageWidth', placeable.source.imageWidth),
      ...optionProperty('imageHeight', placeable.source.imageHeight),
      ...optionProperty('objectType', placeable.source.objectType),
      ...optionProperty('objectClass', placeable.source.objectClass),
      properties: placeable.source.properties,
    },
  }));

const semanticRoleToJson = (role: AssetSemanticRole) => ({
  role: role.role,
  tileId: role.tileId,
  source: role.source,
  confidence: role.confidence,
});

const tileToJson = (
  tile: Tile,
  tilesetId: string,
): {
  readonly id: string;
  readonly tilesetId: string;
  readonly uv: Tile['uv'];
  readonly tags: readonly string[];
  readonly terrainClass?: string;
  readonly animationId?: string;
} => ({
  id: tile.id,
  tilesetId,
  uv: uvToJson(tile.uv),
  tags: tile.tags,
  ...Option.match(tile.terrainClass, {
    onNone: () => ({}),
    onSome: (terrainClass) => ({ terrainClass }),
  }),
  ...Option.match(tile.animation, {
    onNone: () => ({}),
    onSome: (animation) => ({ animationId: animation.id }),
  }),
});

const collectTerrainClasses = (pack: TilesetPack): readonly string[] => {
  const classes = new Set<string>();

  for (const tileset of pack.tilesets) {
    for (const tile of tileset.tiles) {
      Option.match(tile.terrainClass, {
        onNone: () => undefined,
        onSome: (terrainClass) => classes.add(terrainClass),
      });
    }

    for (const rule of tileset.autotileRules) {
      for (const terrainClass of rule.terrainClasses) {
        classes.add(terrainClass);
      }
    }

    for (const filter of tileset.variantFilters) {
      Option.match(filter.terrainClass, {
        onNone: () => undefined,
        onSome: (terrainClass) => classes.add(terrainClass),
      });
    }

    for (const transition of tileset.terrainTransitions) {
      classes.add(transition.from);
      classes.add(transition.to);
    }
  }

  return [...classes].sort();
};

/** Encode a `TilesetPack` into canonical Tileborne manifest JSON. */
export const writeTilesetManifest = (
  pack: TilesetPack,
  options?: {
    readonly provenance?: ManifestProvenanceInput;
  },
): unknown => {
  const animations = new Map<string, ReturnType<typeof animationToJson>>();
  const collisionMasks: Array<{ readonly tileId: string; readonly mask: unknown }> = [];
  const tiles: ReturnType<typeof tileToJson>[] = [];
  const autotileRules: unknown[] = [];
  const variantFilters: unknown[] = [];
  const terrainTransitions: unknown[] = [];

  for (const tileset of pack.tilesets) {
    const tilesetId = String(tileset.id);

    for (const tile of tileset.tiles) {
      tiles.push(tileToJson(tile, tilesetId));

      Option.match(tile.animation, {
        onNone: () => undefined,
        onSome: (animation) => {
          animations.set(String(animation.id), animationToJson(animation));
        },
      });

      Option.match(tile.collisionMask, {
        onNone: () => undefined,
        onSome: (mask) => {
          collisionMasks.push({
            tileId: tile.id,
            mask: encodeCollisionMask(mask),
          });
        },
      });
    }

    for (const rule of tileset.autotileRules) {
      autotileRules.push({
        _tag: rule._tag,
        tilesetId,
        id: rule.id,
        name: rule.name,
        terrainClasses: rule.terrainClasses,
        maskToTileIds: rule.maskToTileIds,
        ...Option.match(rule.fallbackTileId, {
          onNone: () => ({}),
          onSome: (fallbackTileId) => ({ fallbackTileId }),
        }),
        ...(rule._tag === 'custom' ? { source: rule.source } : {}),
      });
    }

    for (const filter of tileset.variantFilters) {
      variantFilters.push({
        id: filter.id,
        tilesetId,
        tileIds: filter.tileIds,
        weights: filter.weights,
        seedSalt: filter.seedSalt,
        stableAcrossAnimationFrames: filter.stableAcrossAnimationFrames,
        ...Option.match(filter.terrainClass, {
          onNone: () => ({}),
          onSome: (terrainClass) => ({ terrainClass }),
        }),
      });
    }

    for (const transition of tileset.terrainTransitions) {
      terrainTransitions.push({
        tilesetId,
        from: transition.from,
        to: transition.to,
        ruleId: transition.ruleId,
      });
    }
  }

  const semanticRoles = pack.semanticRoles ?? inferAssetSemanticRoles(pack);

  return {
    schemaVersion: TILESET_MANIFEST_SCHEMA_VERSION,
    id: pack.id,
    name: pack.name,
    version: pack.version,
    license: licenseToJson(pack.license),
    assets: pack.assets.map((asset) => ({
      id: asset.id,
      path: asset.path,
      mime: asset.mime,
    })),
    ...(options?.provenance === undefined ? {} : { provenance: options.provenance }),
    terrainClasses: collectTerrainClasses(pack),
    tilesets: pack.tilesets.map((tileset) => ({
      id: tileset.id,
      name: tileset.name,
      atlasAssetId: tileset.atlasAssetId,
      cellSize: cellSizeToJson(tileset.cellSize),
      margin: tileset.margin,
      spacing: tileset.spacing,
    })),
    tiles,
    autotileRules,
    variantFilters,
    animations: [...animations.values()],
    terrainTransitions,
    collisionMasks,
    ...(semanticRoles.length === 0
      ? {}
      : { assetSemanticRoles: semanticRoles.map(semanticRoleToJson) }),
    ...(pack.placeables === undefined || pack.placeables.length === 0
      ? {}
      : { placeables: placeablesToJson(pack.placeables) }),
  };
};
