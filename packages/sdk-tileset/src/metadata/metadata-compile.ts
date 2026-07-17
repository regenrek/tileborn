import { Option, Schema } from 'effect';

import type { ParseDiagnostic } from '../diagnostics.js';
import type { CollisionMask } from '../schemas/collision-mask.js';
import { TerrainClass } from '../schemas/terrain-class.js';
import type { TileId } from '../schemas/ids.js';
import type { TiledJsonObject, TiledJsonProperty } from '../tiled/types.js';

import {
  collisionMaskFromManifest,
  compileCollisionFromLdtkIntGridValue,
  compileCollisionFromTiledObjectGroup,
  compileCollisionFromUnityMetaSprite,
} from './collision.js';
import type {
  AxisAlignedBounds,
  CompiledTileMetadata,
  LdtkIntGridCollisionValue,
  NamespacedProperties,
  PathfindingHint,
  SpawnAnchor,
  UnityMetaSprite,
} from './types.js';
import { validateCollisionMask } from './validate.js';

const KNOWN_NAMESPACES = ['tileborne', 'gameplay', 'tiled', 'ldtk', 'unity'] as const;
const SPAWN_IDENTIFIER = /spawn|player|start|character/i;
const BLOCKED_IDENTIFIER = /block|solid|wall|collision|obstacle/i;

const isBlockedIntGridValue = (value: LdtkIntGridCollisionValue): boolean => {
  if (value.blocked === true) {
    return true;
  }
  if (value.blocked === false) {
    return false;
  }
  return value.identifier !== null && BLOCKED_IDENTIFIER.test(value.identifier);
};

const decodeTerrainClass = (value: string): typeof TerrainClass.Type | undefined =>
  Schema.decodeUnknownOption(TerrainClass)(value).pipe(Option.getOrUndefined);

const propertiesToRecord = (
  properties: readonly TiledJsonProperty[] | undefined,
): Readonly<Record<string, string | number | boolean>> => {
  if (!properties || properties.length === 0) {
    return {};
  }
  const record: Record<string, string | number | boolean> = {};
  for (const property of properties) {
    record[property.name] = property.value;
  }
  return record;
};

const splitNamespacedKey = (key: string): { readonly namespace: string; readonly name: string } => {
  const dotIndex = key.indexOf('.');
  if (dotIndex <= 0 || dotIndex === key.length - 1) {
    return { namespace: 'tiled', name: key };
  }
  const namespace = key.slice(0, dotIndex);
  return { namespace, name: key.slice(dotIndex + 1) };
};

/** Group flat property keys into namespaces without overwriting existing keys. */
export const namespaceCustomProperties = (
  properties: Readonly<Record<string, string | number | boolean>>,
): NamespacedProperties => {
  const grouped: Record<string, Record<string, string | number | boolean>> = {};

  for (const [rawKey, value] of Object.entries(properties)) {
    const { namespace, name } = splitNamespacedKey(rawKey);
    const bucket = grouped[namespace] ?? (grouped[namespace] = {});
    if (bucket[name] !== undefined) {
      continue;
    }
    bucket[name] = value;
  }

  return grouped;
};

const boundsFromTiledObjects = (
  objects: readonly TiledJsonObject[],
): AxisAlignedBounds | undefined => {
  if (objects.length === 0) {
    return undefined;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const object of objects) {
    const points =
      object.polygon ??
      object.polyline ??
      (object.width !== undefined && object.height !== undefined
        ? [
            { x: 0, y: 0 },
            { x: object.width, y: 0 },
            { x: object.width, y: object.height },
            { x: 0, y: object.height },
          ]
        : [{ x: 0, y: 0 }]);

    for (const point of points) {
      const x = object.x + point.x;
      const y = object.y + point.y;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(maxY)
  ) {
    return undefined;
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
};

const isSpawnTiledObject = (object: TiledJsonObject): boolean => {
  const cls = object.class ?? object.type ?? object.name ?? '';
  return SPAWN_IDENTIFIER.test(cls);
};

const spawnAnchorFromTiledObject = (object: TiledJsonObject): SpawnAnchor => ({
  identifier: object.name ?? object.class ?? object.type ?? `object-${object.id}`,
  x: object.x,
  y: object.y,
  width: object.width ?? 0,
  height: object.height ?? 0,
});

const pathfindingFromProperties = (
  properties: Readonly<Record<string, string | number | boolean>>,
  collisionMask: CollisionMask | undefined,
): PathfindingHint | undefined => {
  const blockedProperty = properties['tileborne.blocked'] ?? properties['gameplay.blocked'];
  const costProperty = properties['tileborne.pathCost'] ?? properties['gameplay.pathCost'];

  const blockedFromProperty =
    blockedProperty === true || blockedProperty === 1 || blockedProperty === 'true';
  const blockedFromCollision =
    collisionMask?._tag === 'bitmask'
      ? collisionMask.blocked !== 0 && collisionMask.passable === 0
      : collisionMask?._tag === 'polygon'
        ? collisionMask.blocksMovement
        : false;

  const blocked = blockedFromProperty || blockedFromCollision;
  const cost =
    typeof costProperty === 'number'
      ? costProperty
      : typeof costProperty === 'string'
        ? Number.parseFloat(costProperty)
        : blocked
          ? Number.POSITIVE_INFINITY
          : 1;

  if (!blocked && cost === 1 && costProperty === undefined && collisionMask === undefined) {
    return undefined;
  }

  return {
    blocked,
    cost: Number.isFinite(cost) ? cost : blocked ? Number.POSITIVE_INFINITY : 1,
  };
};

export type CompileTileMetadataInput = {
  readonly tileId: TileId;
  readonly path: string;
  readonly cellSize: { readonly width: number; readonly height: number };
  readonly collisionSubgrid?: { readonly width: number; readonly height: number };
  readonly terrainClass?: typeof TerrainClass.Type;
  readonly tags?: readonly string[];
  readonly tiled?: {
    readonly properties?: readonly TiledJsonProperty[];
    readonly type?: string;
    readonly class?: string;
    readonly objectgroupObjects?: readonly TiledJsonObject[];
  };
  readonly ldtk?: {
    readonly intGridValue?: LdtkIntGridCollisionValue;
    readonly entity?: {
      readonly identifier: string;
      readonly px: readonly [number, number];
      readonly size: readonly [number, number];
      readonly kind: 'spawn' | 'prop';
    };
    readonly fields?: Readonly<Record<string, unknown>>;
  };
  readonly manifest?: {
    readonly collisionMask?: CollisionMask;
    readonly customProperties?: Readonly<Record<string, string | number | boolean>>;
  };
  readonly unityMeta?: UnityMetaSprite;
};

/** Normalize per-tile metadata from importer-specific inputs into one compiled block. */
export const compileTileMetadata = (
  input: CompileTileMetadataInput,
): { readonly value: CompiledTileMetadata; readonly diagnostics: readonly ParseDiagnostic[] } => {
  const diagnostics: ParseDiagnostic[] = [];
  const propertyRecords: Record<string, string | number | boolean> = {};

  for (const tag of input.tags ?? []) {
    const eqIndex = tag.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }
    const rawKey = tag.slice(0, eqIndex);
    const rawValue = tag.slice(eqIndex + 1);
    const namespacedKey = rawKey.startsWith('tiled:')
      ? `tiled.${rawKey.slice('tiled:'.length)}`
      : rawKey;
    if (propertyRecords[namespacedKey] === undefined) {
      propertyRecords[namespacedKey] = rawValue;
    }
  }

  Object.assign(propertyRecords, propertiesToRecord(input.tiled?.properties));
  Object.assign(propertyRecords, input.manifest?.customProperties ?? {});

  if (input.ldtk?.fields) {
    for (const [key, value] of Object.entries(input.ldtk.fields)) {
      if (
        propertyRecords[`ldtk.${key}`] === undefined &&
        (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
      ) {
        propertyRecords[`ldtk.${key}`] = value;
      }
    }
  }

  const terrainClasses: Array<typeof TerrainClass.Type> = [];
  if (input.terrainClass !== undefined) {
    terrainClasses.push(input.terrainClass);
  }

  const terrainProperty =
    propertyRecords['terrainClass'] ??
    propertyRecords['terrain'] ??
    propertyRecords['tileborne.terrainClass'];
  if (typeof terrainProperty === 'string') {
    const terrainClass = decodeTerrainClass(terrainProperty);
    if (terrainClass !== undefined && !terrainClasses.includes(terrainClass)) {
      terrainClasses.push(terrainClass);
    }
  }

  let collisionMask =
    input.manifest?.collisionMask !== undefined
      ? collisionMaskFromManifest(input.manifest.collisionMask)
      : undefined;

  if (collisionMask === undefined && input.tiled?.objectgroupObjects !== undefined) {
    collisionMask = compileCollisionFromTiledObjectGroup(input.tiled.objectgroupObjects);
  }

  if (collisionMask === undefined && input.ldtk?.intGridValue !== undefined) {
    collisionMask = compileCollisionFromLdtkIntGridValue(
      input.ldtk.intGridValue,
      input.collisionSubgrid ?? { width: 2, height: 2 },
    );
  }

  if (collisionMask === undefined && input.unityMeta !== undefined) {
    collisionMask = compileCollisionFromUnityMetaSprite(input.unityMeta);
  }

  if (collisionMask !== undefined) {
    diagnostics.push(
      ...validateCollisionMask(collisionMask, input.cellSize, {
        tileId: String(input.tileId),
        path: `${input.path}/collisionMask`,
        ...(input.collisionSubgrid === undefined ? {} : { subgrid: input.collisionSubgrid }),
      }),
    );
  }

  const objectBounds = input.tiled?.objectgroupObjects
    ? boundsFromTiledObjects(input.tiled.objectgroupObjects)
    : undefined;

  const spawnAnchors: SpawnAnchor[] = [];
  for (const object of input.tiled?.objectgroupObjects ?? []) {
    if (isSpawnTiledObject(object)) {
      spawnAnchors.push(spawnAnchorFromTiledObject(object));
    }
  }

  if (input.ldtk?.entity?.kind === 'spawn') {
    spawnAnchors.push({
      identifier: input.ldtk.entity.identifier,
      x: input.ldtk.entity.px[0],
      y: input.ldtk.entity.px[1],
      width: input.ldtk.entity.size[0],
      height: input.ldtk.entity.size[1],
    });
  }

  const custom = namespaceCustomProperties(propertyRecords);
  const pathfinding = pathfindingFromProperties(propertyRecords, collisionMask);

  return {
    value: {
      tileId: input.tileId,
      terrainClasses,
      bounds: objectBounds,
      spawnAnchors,
      pathfinding:
        pathfinding ??
        (input.ldtk?.intGridValue !== undefined && isBlockedIntGridValue(input.ldtk.intGridValue)
          ? { blocked: true, cost: Number.POSITIVE_INFINITY }
          : undefined),
      custom,
      collisionMask,
    },
    diagnostics,
  };
};

export { KNOWN_NAMESPACES };
