import type { TiledJsonObject } from "../tiled/types.js";
import {
  BitmaskCollisionMask,
  CollisionEdge,
  PolygonCollisionMask,
  type CollisionMask,
} from "../schemas/collision-mask.js";

import type { LdtkIntGridCollisionValue, UnityMetaSprite } from "./types.js";

const BLOCKED_IDENTIFIER = /block|solid|wall|collision|obstacle/i;

const polygonEdgesFromPoints = (
  points: readonly { readonly x: number; readonly y: number }[],
  offsetX: number,
  offsetY: number,
): readonly CollisionEdge[] =>
  points.map((point, index) => {
    const next = points[(index + 1) % points.length]!;
    return new CollisionEdge({
      x1: offsetX + point.x,
      y1: offsetY + point.y,
      x2: offsetX + next.x,
      y2: offsetY + next.y,
    });
  });

const rectangleEdges = (x: number, y: number, width: number, height: number): readonly CollisionEdge[] => [
  new CollisionEdge({ x1: x, y1: y, x2: x + width, y2: y }),
  new CollisionEdge({ x1: x + width, y1: y, x2: x + width, y2: y + height }),
  new CollisionEdge({ x1: x + width, y1: y + height, x2: x, y2: y + height }),
  new CollisionEdge({ x1: x, y1: y + height, x2: x, y2: y }),
];

const polygonCollision = (edges: readonly CollisionEdge[]): PolygonCollisionMask =>
  new PolygonCollisionMask({
    edges: [...edges],
    passable: false,
    blocksMovement: true,
    blocksProjectiles: true,
  });

/** Compile a Tiled tile object into a polygon collision mask. */
export const compileCollisionFromTiledObject = (object: TiledJsonObject): CollisionMask | undefined => {
  const polygon = object.polygon ?? object.polyline;
  if (polygon && polygon.length > 0) {
    return polygonCollision(polygonEdgesFromPoints(polygon, object.x, object.y));
  }

  if (object.ellipse && object.width !== undefined && object.height !== undefined) {
    const width = object.width;
    const height = object.height;
    return polygonCollision(rectangleEdges(object.x, object.y, width, height));
  }

  if (object.width !== undefined && object.height !== undefined && object.width > 0 && object.height > 0) {
    return polygonCollision(rectangleEdges(object.x, object.y, object.width, object.height));
  }

  if (object.point) {
    return polygonCollision([
      new CollisionEdge({ x1: object.x, y1: object.y, x2: object.x, y2: object.y }),
    ]);
  }

  return undefined;
};

/** Compile the first collision-bearing object from a Tiled tile object group. */
export const compileCollisionFromTiledObjectGroup = (
  objects: readonly TiledJsonObject[],
): CollisionMask | undefined => {
  for (const object of objects) {
    const collision = compileCollisionFromTiledObject(object);
    if (collision !== undefined) {
      return collision;
    }
  }
  return undefined;
};

const isBlockedIntGridValue = (value: LdtkIntGridCollisionValue): boolean => {
  if (value.blocked === true) {
    return true;
  }
  if (value.blocked === false) {
    return false;
  }
  return value.identifier !== null && BLOCKED_IDENTIFIER.test(value.identifier);
};

/** Compile an LDtk IntGrid value into a full-tile bitmask collision mask. */
export const compileCollisionFromLdtkIntGridValue = (
  value: LdtkIntGridCollisionValue,
  subgrid: { readonly width: number; readonly height: number } = { width: 2, height: 2 },
): BitmaskCollisionMask => {
  const cellCount = subgrid.width * subgrid.height;
  const fullMask = cellCount >= 31 ? Number.MAX_SAFE_INTEGER : (1 << cellCount) - 1;
  const blocked = isBlockedIntGridValue(value);

  return new BitmaskCollisionMask({
    passable: blocked ? 0 : fullMask,
    blocked: blocked ? fullMask : 0,
  });
};

/** Pass through an explicit Tileborne manifest collision mask unchanged. */
export const collisionMaskFromManifest = (mask: CollisionMask): CollisionMask => mask;

/** Best-effort Unity `.meta` sprite outline fallback into polygon collision. */
export const compileCollisionFromUnityMetaSprite = (sprite: UnityMetaSprite): CollisionMask | undefined => {
  const outline = sprite.outline?.find((entry) => entry.points.length >= 3);
  if (outline === undefined) {
    return undefined;
  }

  const { width, height } = sprite.rect;
  const edges = polygonEdgesFromPoints(outline.points, 0, 0).map(
    (edge) =>
      new CollisionEdge({
        x1: Math.round(Math.min(width, Math.max(0, edge.x1))),
        y1: Math.round(Math.min(height, Math.max(0, edge.y1))),
        x2: Math.round(Math.min(width, Math.max(0, edge.x2))),
        y2: Math.round(Math.min(height, Math.max(0, edge.y2))),
      }),
  );

  return polygonCollision(edges);
};

export { polygonEdgesFromPoints, rectangleEdges };
