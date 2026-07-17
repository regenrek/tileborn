import { Option, Schema } from 'effect';

/**
 * Neutral 2D point/vector in world units. A {@link Schema.Class} so positions
 * and impulses round-trip through the wire; carries no balance numbers. The
 * combat systems are 2D and brand-neutral — the runtime/plugin map their own
 * coordinate space onto these values.
 */
export class Vec2 extends Schema.Class<Vec2>('Vec2')({
  x: Schema.Number,
  y: Schema.Number,
}) {}

/** Anything shaped like a 2D vector (lets math helpers accept plain literals). */
export interface Vec2Like {
  readonly x: number;
  readonly y: number;
}

/** Construct a {@link Vec2}. */
export const vec2 = (x: number, y: number): Vec2 => new Vec2({ x, y });

/** Component-wise sum. */
export const addVec = (a: Vec2Like, b: Vec2Like): Vec2 => new Vec2({ x: a.x + b.x, y: a.y + b.y });

/** Component-wise difference (`a - b`). */
export const subVec = (a: Vec2Like, b: Vec2Like): Vec2 => new Vec2({ x: a.x - b.x, y: a.y - b.y });

/** Uniform scale by a scalar. */
export const scaleVec = (a: Vec2Like, scalar: number): Vec2 =>
  new Vec2({ x: a.x * scalar, y: a.y * scalar });

/** Dot product. */
export const dotVec = (a: Vec2Like, b: Vec2Like): number => a.x * b.x + a.y * b.y;

/** Squared length (avoids a `sqrt` when only comparing magnitudes). */
export const vecLengthSquared = (a: Vec2Like): number => a.x * a.x + a.y * a.y;

/** Euclidean length. */
export const vecLength = (a: Vec2Like): number => Math.hypot(a.x, a.y);

/** Distance between two points. */
export const distance = (a: Vec2Like, b: Vec2Like): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Unit vector in the direction of `a`. A zero-length input has no direction, so
 * it is returned as the canonical `(1, 0)` axis — deterministic and total.
 */
export const normalizeVec = (a: Vec2Like): Vec2 => {
  const length = Math.hypot(a.x, a.y);
  if (length === 0) {
    return new Vec2({ x: 1, y: 0 });
  }
  return new Vec2({ x: a.x / length, y: a.y / length });
};

/** Rotate a vector counter-clockwise by `radians`. */
export const rotateVec = (a: Vec2Like, radians: number): Vec2 => {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return new Vec2({ x: a.x * cos - a.y * sin, y: a.x * sin + a.y * cos });
};

/**
 * Unsigned angle (radians) between two directions, in `[0, π]`. Zero-length
 * inputs are treated as the `(1, 0)` axis so the result is always defined.
 */
export const angleBetween = (a: Vec2Like, b: Vec2Like): number => {
  const na = normalizeVec(a);
  const nb = normalizeVec(b);
  const cos = Math.min(1, Math.max(-1, dotVec(na, nb)));
  return Math.acos(cos);
};

/** Anything shaped like an axis-aligned box (lets helpers accept plain literals). */
export interface AabbLike {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

const axisGap = (aMin: number, aMax: number, bMin: number, bMax: number): number =>
  Math.max(0, aMin - bMax, bMin - aMax);

/**
 * Shortest Euclidean distance between the boundaries of two axis-aligned
 * boxes: `0` when they touch or overlap, otherwise the hypot of the per-axis
 * gaps. A point is the degenerate box with `min === max`, so point-to-box
 * gap distance needs no separate helper. This is the neutral form of the
 * body-gap pickup metric (an interaction reach measured between collision
 * bodies rather than centers).
 */
export const aabbGapDistance = (a: AabbLike, b: AabbLike): number =>
  Math.hypot(axisGap(a.minX, a.maxX, b.minX, b.maxX), axisGap(a.minY, a.maxY, b.minY, b.maxY));

/**
 * Axis-aligned blocking rectangle the combat systems test against for
 * line-of-sight and projectile/beam blocking. Neutral geometry + neutral flags
 * only: the runtime/plugin derive these from the catalog
 * `CollisionFootprintComponent` (`blocksProjectiles` / `blocksVision`) — the
 * simulation never imports the catalog component, it consumes the flag values.
 */
export class CombatBlocker extends Schema.Class<CombatBlocker>('CombatBlocker')({
  minX: Schema.Number,
  minY: Schema.Number,
  maxX: Schema.Number,
  maxY: Schema.Number,
  /** Stops physical shots (hitscan / projectile / beam / pellet / pierce). */
  blocksProjectiles: Schema.Boolean,
  /** Stops sight lines (used for vision-gated line-of-sight checks). */
  blocksVision: Schema.Boolean,
}) {}

/** Which blocking flag a line-of-sight query honors. */
export type BlockingChannel = 'projectiles' | 'vision';

const blockerStops = (blocker: CombatBlocker, channel: BlockingChannel): boolean =>
  channel === 'projectiles' ? blocker.blocksProjectiles : blocker.blocksVision;

/**
 * Whether the segment `a → b` enters an axis-aligned box (slab method). Touching
 * the boundary counts as an intersection so flush walls reliably block.
 *
 * `expand` grows the box by that margin on all sides (Minkowski-style): testing
 * a *center* segment against a box grown by a swept circle's radius is the
 * equivalent of sweeping the circle itself, so a body of that radius grazing the
 * box within the margin is detected even though its center never enters. The
 * default `0` is the exact point/segment test used for line-of-sight and the
 * ray delivery families (which carry no swept body). The corners are squared
 * rather than rounded — a conservative, deterministic over-approximation.
 */
export const segmentIntersectsAabb = (
  a: Vec2Like,
  b: Vec2Like,
  blocker: CombatBlocker,
  expand = 0,
): boolean => {
  const minX = blocker.minX - expand;
  const minY = blocker.minY - expand;
  const maxX = blocker.maxX + expand;
  const maxY = blocker.maxY + expand;

  const dx = b.x - a.x;
  const dy = b.y - a.y;

  let tMin = 0;
  let tMax = 1;

  // X slab.
  if (dx === 0) {
    if (a.x < minX || a.x > maxX) {
      return false;
    }
  } else {
    const t1 = (minX - a.x) / dx;
    const t2 = (maxX - a.x) / dx;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
    if (tMin > tMax) {
      return false;
    }
  }

  // Y slab.
  if (dy === 0) {
    if (a.y < minY || a.y > maxY) {
      return false;
    }
  } else {
    const t1 = (minY - a.y) / dy;
    const t2 = (maxY - a.y) / dy;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
    if (tMin > tMax) {
      return false;
    }
  }

  return true;
};

/**
 * Line-of-sight test: `true` when no blocker on the given channel sits between
 * `from` and `to`. The neutral basis for hitscan/beam LOS gating and for
 * vision-gated explosive AoE.
 */
export const hasLineOfSight = (
  blockers: Iterable<CombatBlocker>,
  from: Vec2Like,
  to: Vec2Like,
  channel: BlockingChannel,
): boolean => {
  for (const blocker of blockers) {
    if (blockerStops(blocker, channel) && segmentIntersectsAabb(from, to, blocker)) {
      return false;
    }
  }
  return true;
};

/**
 * Distance along the ray (`origin` + `direction` * t) at which a point target is
 * first within `hitRadius`, or `None` if the target is behind the origin, beyond
 * `range`, or too far off-axis. `direction` need not be normalized.
 */
export const rayHitDistance = (
  origin: Vec2Like,
  direction: Vec2Like,
  target: Vec2Like,
  range: number,
  hitRadius: number,
): Option.Option<number> => {
  const dir = normalizeVec(direction);
  const toTarget = subVec(target, origin);
  const along = dotVec(toTarget, dir);
  if (along < 0 || along > range) {
    return Option.none();
  }
  const closest = addVec(origin, scaleVec(dir, along));
  if (distance(closest, target) > hitRadius) {
    return Option.none();
  }
  return Option.some(along);
};

/**
 * Distance from a point to the segment `a → b` — used to sweep a moving
 * projectile so a fast shot cannot tunnel through a target between ticks.
 */
export const pointToSegmentDistance = (point: Vec2Like, a: Vec2Like, b: Vec2Like): number => {
  const ab = subVec(b, a);
  const lengthSquared = vecLengthSquared(ab);
  if (lengthSquared === 0) {
    return distance(point, a);
  }
  const t = Math.min(1, Math.max(0, dotVec(subVec(point, a), ab) / lengthSquared));
  const closest = addVec(a, scaleVec(ab, t));
  return distance(point, closest);
};

/**
 * First entry distance (as a fraction `t` in `[0, 1]`) at which the segment
 * `a → b` enters an axis-aligned box, plus the box face normal at that point, or
 * `None` if the segment misses. Used to reflect a bouncing shot off geometry.
 */
export const segmentAabbEntry = (
  a: Vec2Like,
  b: Vec2Like,
  blocker: CombatBlocker,
): Option.Option<{ readonly t: number; readonly normal: Vec2 }> => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;

  let tMin = 0;
  let tMax = 1;
  let normalAxis: 'x' | 'y' = 'x';
  let normalSign = -1;

  if (dx === 0) {
    if (a.x < blocker.minX || a.x > blocker.maxX) {
      return Option.none();
    }
  } else {
    const inv = 1 / dx;
    let tNear = (blocker.minX - a.x) * inv;
    let tFar = (blocker.maxX - a.x) * inv;
    let sign = -1;
    if (tNear > tFar) {
      [tNear, tFar] = [tFar, tNear];
      sign = 1;
    }
    if (tNear > tMin) {
      tMin = tNear;
      normalAxis = 'x';
      normalSign = sign;
    }
    tMax = Math.min(tMax, tFar);
    if (tMin > tMax) {
      return Option.none();
    }
  }

  if (dy === 0) {
    if (a.y < blocker.minY || a.y > blocker.maxY) {
      return Option.none();
    }
  } else {
    const inv = 1 / dy;
    let tNear = (blocker.minY - a.y) * inv;
    let tFar = (blocker.maxY - a.y) * inv;
    let sign = -1;
    if (tNear > tFar) {
      [tNear, tFar] = [tFar, tNear];
      sign = 1;
    }
    if (tNear > tMin) {
      tMin = tNear;
      normalAxis = 'y';
      normalSign = sign;
    }
    tMax = Math.min(tMax, tFar);
    if (tMin > tMax) {
      return Option.none();
    }
  }

  const normal =
    normalAxis === 'x' ? new Vec2({ x: normalSign, y: 0 }) : new Vec2({ x: 0, y: normalSign });
  return Option.some({ t: tMin, normal });
};

/** Reflect a direction across a surface normal (`d - 2 (d·n) n`). */
export const reflectVec = (direction: Vec2Like, normal: Vec2Like): Vec2 => {
  const d = dotVec(direction, normal);
  return new Vec2({ x: direction.x - 2 * d * normal.x, y: direction.y - 2 * d * normal.y });
};
