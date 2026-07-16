import type { CollisionMask } from '../schemas/collision-mask.js';
import type { TerrainClass } from '../schemas/terrain-class.js';
import type { TileId } from '../schemas/ids.js';

/** Pixel dimensions used when validating collision geometry. */
export type CollisionCellSize = {
  readonly width: number;
  readonly height: number;
};

/** Axis-aligned bounding box in tile-local pixel coordinates. */
export type AxisAlignedBounds = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** Normalized spawn anchor in tile-local pixel coordinates. */
export type SpawnAnchor = {
  readonly identifier: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** Pathfinding hint derived from collision and custom properties. */
export type PathfindingHint = {
  readonly blocked: boolean;
  readonly cost: number;
};

/** Custom properties grouped by namespace to avoid key collisions. */
export type NamespacedProperties = Readonly<
  Record<string, Readonly<Record<string, string | number | boolean>>>
>;

/** Compiled per-tile metadata block consumed by importers and manifests. */
export type CompiledTileMetadata = {
  readonly tileId: TileId;
  readonly terrainClasses: readonly TerrainClass[];
  readonly bounds: AxisAlignedBounds | undefined;
  readonly spawnAnchors: readonly SpawnAnchor[];
  readonly pathfinding: PathfindingHint | undefined;
  readonly custom: NamespacedProperties;
  readonly collisionMask: CollisionMask | undefined;
};

/** LDtk IntGrid value definition used for collision bitmask compilation. */
export type LdtkIntGridCollisionValue = {
  readonly value: number;
  readonly identifier: string | null;
  readonly blocked?: boolean;
};

/** Best-effort Unity `.meta` sprite outline input for collision fallback. */
export type UnityMetaSprite = {
  readonly name: string;
  readonly rect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly outline?: readonly {
    readonly points: readonly { readonly x: number; readonly y: number }[];
  }[];
};
