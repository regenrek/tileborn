import type { CombatEntityId } from './ids.js';
import type { Vec2Like } from './geometry.js';

/**
 * A deterministic spatial *broadphase* over entity positions. It narrows the
 * candidate set a delivery resolver must run its precise geometry test against,
 * replacing the O(entities) linear scan of {@link CombatWorldView.entities} that
 * every spatial delivery would otherwise perform.
 *
 * The contract is intentionally weak so it can never change a result: a query
 * returns a *superset* of the entities whose precise test could pass for the
 * given region — the caller still runs the exact geometry/policy test on each
 * candidate. Two invariants make it safe to swap in for the brute-force scan:
 *
 * 1. **No false negatives.** Every indexed entity whose position lies inside the
 *    queried axis-aligned box is returned. The resolvers compute a box that
 *    bounds their precise region, so an accepted target is never dropped.
 * 2. **Deterministic id order.** Candidates come back in ascending
 *    {@link CombatEntityId} order, matching {@link CombatWorldView.entities}'
 *    stable order. Resolvers that emit one outcome per candidate (AoE / melee)
 *    therefore produce a bit-identical, id-sorted result.
 *
 * The index is built once over the world's *positioned* entities (those that
 * appear in `entities()` and have a position); position-less entities are never
 * candidates, exactly as the brute-force scan skipped them via `getPosition`.
 */
export interface CombatBroadphase {
  /**
   * Entities whose position lies within the inclusive axis-aligned box
   * `[minX, maxX] × [minY, maxY]`, in ascending id order. A non-finite bound
   * conservatively returns every indexed entity so the precise test decides.
   */
  readonly queryAabb: (
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ) => readonly CombatEntityId[];
}

/** One positioned entity fed into {@link createUniformGridBroadphase}. */
export interface BroadphaseEntry {
  readonly entity: CombatEntityId;
  readonly position: Vec2Like;
}

// Default uniform-grid cell edge in world units. The cell edge only affects how
// finely the index buckets space (i.e. performance); it never changes which
// candidates a query returns, since results are filtered to the exact box and
// the precise geometry test runs afterwards.
const DEFAULT_CELL_EDGE = 32;

/** Tuning for {@link createUniformGridBroadphase} (performance only). */
export interface UniformGridOptions {
  /** Uniform cell edge in world units; coerced to a positive finite value. */
  readonly cellEdge?: number;
}

const cellKey = (cx: number, cy: number): string => `${cx}|${cy}`;

/**
 * Build a deterministic uniform-grid {@link CombatBroadphase} over `entries`.
 * Entities are bucketed by `floor(coord / cellEdge)`; a query walks only the
 * cells the box overlaps (falling back to a linear scan when the box would span
 * more cells than there are entities), filters to the exact box, and returns the
 * surviving ids sorted ascending. Entities with a non-finite coordinate cannot
 * be bucketed, so they are kept aside and included in *every* query result —
 * mirroring the brute-force scan, which also handed them to the precise test.
 *
 * Pure and dependency-free: no ambient entropy, no platform APIs. Positions are
 * snapshotted at construction (the combat world never moves an entity mid-tick).
 */
export const createUniformGridBroadphase = (
  entries: Iterable<BroadphaseEntry>,
  options: UniformGridOptions = {},
): CombatBroadphase => {
  const requested = options.cellEdge;
  const cellEdge =
    requested !== undefined && Number.isFinite(requested) && requested > 0
      ? requested
      : DEFAULT_CELL_EDGE;

  interface Indexed {
    readonly entity: CombatEntityId;
    readonly x: number;
    readonly y: number;
  }

  const grid = new Map<string, Indexed[]>();
  const positioned: Indexed[] = [];
  // Entities whose position is non-finite cannot be bucketed deterministically;
  // they are returned by every query so the precise test treats them exactly as
  // the linear scan did.
  const unbucketed: CombatEntityId[] = [];
  const allIds: CombatEntityId[] = [];

  for (const { entity, position } of entries) {
    allIds.push(entity);
    const { x, y } = position;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      unbucketed.push(entity);
      continue;
    }
    const indexed: Indexed = { entity, x, y };
    positioned.push(indexed);
    const key = cellKey(Math.floor(x / cellEdge), Math.floor(y / cellEdge));
    const bucket = grid.get(key);
    if (bucket === undefined) {
      grid.set(key, [indexed]);
    } else {
      bucket.push(indexed);
    }
  }

  allIds.sort((a, b) => a - b);
  unbucketed.sort((a, b) => a - b);

  const sortedIds = (ids: CombatEntityId[]): readonly CombatEntityId[] => ids.sort((a, b) => a - b);

  const withUnbucketed = (ids: CombatEntityId[]): readonly CombatEntityId[] =>
    unbucketed.length === 0 ? sortedIds(ids) : sortedIds([...ids, ...unbucketed]);

  const collectFrom = (
    source: readonly Indexed[],
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): CombatEntityId[] => {
    const hits: CombatEntityId[] = [];
    for (const entry of source) {
      if (entry.x >= minX && entry.x <= maxX && entry.y >= minY && entry.y <= maxY) {
        hits.push(entry.entity);
      }
    }
    return hits;
  };

  const queryAabb = (
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): readonly CombatEntityId[] => {
    if (
      !Number.isFinite(minX) ||
      !Number.isFinite(minY) ||
      !Number.isFinite(maxX) ||
      !Number.isFinite(maxY) ||
      minX > maxX ||
      minY > maxY
    ) {
      // A degenerate/non-finite box can't be bucket-walked safely; hand the
      // full positioned set to the precise test (still a faithful superset).
      return [...allIds];
    }

    const cx0 = Math.floor(minX / cellEdge);
    const cx1 = Math.floor(maxX / cellEdge);
    const cy0 = Math.floor(minY / cellEdge);
    const cy1 = Math.floor(maxY / cellEdge);
    const cellSpan = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);

    // When the box would touch more cells than there are entities, a direct
    // scan of the entity list is cheaper and identical in result.
    if (cellSpan > positioned.length) {
      return withUnbucketed(collectFrom(positioned, minX, minY, maxX, maxY));
    }

    const hits: CombatEntityId[] = [];
    for (let cx = cx0; cx <= cx1; cx += 1) {
      for (let cy = cy0; cy <= cy1; cy += 1) {
        const bucket = grid.get(cellKey(cx, cy));
        if (bucket === undefined) {
          continue;
        }
        for (const entry of bucket) {
          if (entry.x >= minX && entry.x <= maxX && entry.y >= minY && entry.y <= maxY) {
            hits.push(entry.entity);
          }
        }
      }
    }
    return withUnbucketed(hits);
  };

  return { queryAabb };
};

/**
 * A view of `base` with `excluded` filtered out of every query — the broadphase
 * analogue of the orchestrator's wielder-exclusion on `entities()`. Keeps the
 * narrowed candidate set identical to the brute-force scan over the excluded
 * view.
 */
export const excludeFromBroadphase = (
  base: CombatBroadphase,
  excluded: CombatEntityId,
): CombatBroadphase => ({
  queryAabb: (minX, minY, maxX, maxY) =>
    base.queryAabb(minX, minY, maxX, maxY).filter((entity) => entity !== excluded),
});
