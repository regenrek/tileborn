import { describe, expect, it } from 'vitest';

import {
  createUniformGridBroadphase,
  excludeFromBroadphase,
  type BroadphaseEntry,
} from './broadphase.js';
import {
  BeamDelivery,
  BounceDelivery,
  ChargeDelivery,
  ExplosiveDelivery,
  HitscanDelivery,
  MeleeDelivery,
  PelletDelivery,
  PierceDelivery,
  ProjectileDelivery,
  resolveDelivery,
  type DamageDelivery,
  type DeliveryContext,
} from './delivery.js';
import { entitySource, type DamageOutcome } from './damage.js';
import { NoFalloff } from './falloff.js';
import { CombatBlocker, vec2, type Vec2Like } from './geometry.js';
import { fullHealth } from './health.js';
import { alwaysHostile } from './hit-policy.js';
import { makeCombatEntityId, makeProjectileId, type CombatEntityId } from './ids.js';
import { advanceProjectile, Projectile } from './projectile.js';
import { createSeededRng, type SeededRng } from './rng.js';
import { createInMemoryCombatWorld, type CombatActorSeed, type CombatWorldView } from './world.js';

const e = (id: number): CombatEntityId => makeCombatEntityId(id);

const entry = (id: number, x: number, y: number): BroadphaseEntry => ({
  entity: e(id),
  position: vec2(x, y),
});

// ---------------------------------------------------------------------------
// Uniform-grid index: direct unit behaviour
// ---------------------------------------------------------------------------

describe('createUniformGridBroadphase', () => {
  it('returns nothing for an empty world', () => {
    const index = createUniformGridBroadphase([]);
    expect(index.queryAabb(-100, -100, 100, 100)).toEqual([]);
  });

  it('finds a single entity inside the box and excludes one outside', () => {
    const index = createUniformGridBroadphase([entry(2, 10, 10)]);
    expect(index.queryAabb(0, 0, 20, 20)).toEqual([e(2)]);
    expect(index.queryAabb(20.0001, 0, 40, 40)).toEqual([]);
  });

  it('returns candidates in ascending id order regardless of insertion order', () => {
    const index = createUniformGridBroadphase([
      entry(7, 1, 1),
      entry(3, 2, 2),
      entry(5, 3, 3),
      entry(1, 4, 4),
    ]);
    expect(index.queryAabb(-10, -10, 10, 10)).toEqual([e(1), e(3), e(5), e(7)]);
  });

  it('handles all entities packed into a single cell', () => {
    const index = createUniformGridBroadphase([
      entry(2, 0.1, 0.1),
      entry(3, 0.2, 0.2),
      entry(4, 0.3, 0.3),
    ]);
    expect(index.queryAabb(0, 0, 1, 1)).toEqual([e(2), e(3), e(4)]);
  });

  it('includes entities sitting exactly on a cell boundary (multiples of the cell edge)', () => {
    // Default cell edge is 32; place targets exactly on cell seams.
    const index = createUniformGridBroadphase([
      entry(2, 32, 0),
      entry(3, 64, 64),
      entry(4, -32, -32),
      entry(5, 0, 0),
    ]);
    expect(index.queryAabb(32, 0, 32, 0)).toEqual([e(2)]);
    expect(index.queryAabb(64, 64, 64, 64)).toEqual([e(3)]);
    expect(index.queryAabb(-32, -32, 0, 0)).toEqual([e(4), e(5)]);
  });

  it('honours a custom cell edge without changing results', () => {
    const entries = [entry(2, 5, 5), entry(3, 40, 40), entry(4, 41, 39)];
    const fine = createUniformGridBroadphase(entries, { cellEdge: 1 });
    const coarse = createUniformGridBroadphase(entries, { cellEdge: 1000 });
    expect(fine.queryAabb(35, 35, 45, 45)).toEqual(coarse.queryAabb(35, 35, 45, 45));
    expect(fine.queryAabb(35, 35, 45, 45)).toEqual([e(3), e(4)]);
  });

  it('always surfaces entities with a non-finite coordinate', () => {
    const index = createUniformGridBroadphase([
      entry(2, 10, 10),
      { entity: e(3), position: { x: Number.NaN, y: 0 } },
      { entity: e(4), position: { x: 0, y: Number.POSITIVE_INFINITY } },
    ]);
    // A box far from any finite entity still returns the unbucketed ids.
    expect(index.queryAabb(1000, 1000, 1001, 1001)).toEqual([e(3), e(4)]);
    expect(index.queryAabb(0, 0, 20, 20)).toEqual([e(2), e(3), e(4)]);
  });

  it('falls back to the full set for a non-finite or inverted box', () => {
    const index = createUniformGridBroadphase([entry(2, 1, 1), entry(3, 2, 2)]);
    expect(index.queryAabb(Number.NaN, 0, 10, 10)).toEqual([e(2), e(3)]);
    expect(index.queryAabb(10, 10, 0, 0)).toEqual([e(2), e(3)]);
  });
});

describe('excludeFromBroadphase', () => {
  it('drops the excluded entity from every query', () => {
    const index = excludeFromBroadphase(
      createUniformGridBroadphase([entry(1, 1, 1), entry(2, 2, 2), entry(3, 3, 3)]),
      e(2),
    );
    expect(index.queryAabb(-10, -10, 10, 10)).toEqual([e(1), e(3)]);
  });
});

// ---------------------------------------------------------------------------
// Behaviour-preservation: broadphase-driven resolution EQUALS the brute-force
// scan for every delivery family, on many seeded-random worlds.
// ---------------------------------------------------------------------------

const shooter = e(1);

/** A {@link CombatWorldView} with the broadphase stripped — the brute-force reference. */
const withoutBroadphase = (world: CombatWorldView): CombatWorldView => ({
  entities: world.entities,
  getHealth: world.getHealth,
  setHealth: world.setHealth,
  getTeam: world.getTeam,
  getPosition: world.getPosition,
  blockers: world.blockers,
});

interface OutcomeSnapshot {
  readonly tag: string;
  readonly target: number;
  readonly amount: number;
}

const snapshotOutcomes = (outcomes: readonly DamageOutcome[]): readonly OutcomeSnapshot[] =>
  outcomes.map((o) => ({
    tag: o._tag,
    target: o.target as number,
    amount: o._tag === 'DamageApplied' || o._tag === 'EntityDefeated' ? o.amount : 0,
  }));

const snapshotKnockbacks = (knockbacks: { target: CombatEntityId; x: number; y: number }[]) =>
  knockbacks.map((k) => ({ target: k.target as number, x: k.x, y: k.y }));

const noFalloff = new NoFalloff();

const randInRange = (rng: SeededRng, min: number, max: number): number =>
  min + rng.nextFloat() * (max - min);

// Occasionally snap a coordinate onto a cell seam (a multiple of the default
// edge) so the random worlds exercise the boundary path directly.
const randCoord = (rng: SeededRng): number => {
  if (rng.nextFloat() < 0.2) {
    return (rng.nextInt(13) - 6) * 32;
  }
  return Math.round(randInRange(rng, -120, 120) * 100) / 100;
};

const randomActors = (rng: SeededRng, count: number): CombatActorSeed[] => {
  const actors: CombatActorSeed[] = [];
  for (let i = 0; i < count; i += 1) {
    actors.push({
      entity: e(i + 2),
      health: fullHealth(1000),
      position: vec2(randCoord(rng), randCoord(rng)),
    });
  }
  return actors;
};

const randomBlockers = (rng: SeededRng): CombatBlocker[] => {
  if (rng.nextFloat() < 0.5) {
    return [];
  }
  const count = rng.nextInt(3) + 1;
  const blockers: CombatBlocker[] = [];
  for (let i = 0; i < count; i += 1) {
    const cx = randInRange(rng, -100, 100);
    const cy = randInRange(rng, -100, 100);
    const hw = randInRange(rng, 1, 12);
    const hh = randInRange(rng, 1, 12);
    blockers.push(
      new CombatBlocker({
        minX: cx - hw,
        minY: cy - hh,
        maxX: cx + hw,
        maxY: cy + hh,
        blocksProjectiles: rng.nextFloat() < 0.7,
        blocksVision: rng.nextFloat() < 0.5,
      }),
    );
  }
  return blockers;
};

type Family =
  | 'hitscan'
  | 'beam'
  | 'projectile'
  | 'pellet'
  | 'charge'
  | 'bounce'
  | 'pierce'
  | 'explosive'
  | 'melee';

const FAMILIES: readonly Family[] = [
  'hitscan',
  'beam',
  'projectile',
  'pellet',
  'charge',
  'bounce',
  'pierce',
  'explosive',
  'melee',
];

const randomDelivery = (rng: SeededRng, family: Family): DamageDelivery => {
  const reach = randInRange(rng, 5, 200);
  const hitRadius = randInRange(rng, 0.5, 10);
  const kb = rng.nextFloat() < 0.5 ? randInRange(rng, 1, 6) : 0;
  switch (family) {
    case 'hitscan':
      return new HitscanDelivery({
        damage: randInRange(rng, 5, 60),
        range: reach,
        hitRadius,
        falloff: noFalloff,
        knockback: kb,
      });
    case 'beam':
      return new BeamDelivery({
        damage: randInRange(rng, 5, 60),
        range: reach,
        hitRadius,
        falloff: noFalloff,
        knockback: kb,
      });
    case 'projectile':
      return new ProjectileDelivery({
        damage: randInRange(rng, 5, 60),
        speed: randInRange(rng, 1, 12),
        ttlTicks: rng.nextInt(20) + 1,
        radius: randInRange(rng, 0.5, 8),
        falloff: noFalloff,
        knockback: kb,
      });
    case 'pellet':
      return new PelletDelivery({
        damage: randInRange(rng, 5, 30),
        pelletCount: rng.nextInt(8) + 1,
        range: reach,
        hitRadius,
        spread: randInRange(rng, 0, 1.2),
        falloff: noFalloff,
        knockback: kb,
      });
    case 'charge':
      return new ChargeDelivery({
        minDamage: randInRange(rng, 5, 20),
        maxDamage: randInRange(rng, 20, 60),
        chargeTicks: rng.nextInt(10),
        range: reach,
        hitRadius,
        falloff: noFalloff,
        knockback: kb,
      });
    case 'bounce':
      return new BounceDelivery({
        damage: randInRange(rng, 5, 60),
        range: reach,
        hitRadius,
        maxBounces: rng.nextInt(4),
        falloff: noFalloff,
        knockback: kb,
      });
    case 'pierce':
      return new PierceDelivery({
        damage: randInRange(rng, 5, 60),
        range: reach,
        hitRadius,
        maxTargets: rng.nextInt(6) + 1,
        falloff: noFalloff,
        knockback: kb,
      });
    case 'explosive':
      return new ExplosiveDelivery({
        damage: randInRange(rng, 5, 60),
        radius: randInRange(rng, 5, 120),
        falloff: noFalloff,
        knockback: kb,
        requiresLineOfSight: rng.nextFloat() < 0.5,
      });
    case 'melee':
      return new MeleeDelivery({
        damage: randInRange(rng, 5, 60),
        range: randInRange(rng, 2, 60),
        arc: randInRange(rng, 0.2, Math.PI),
        knockback: kb,
      });
  }
};

const buildContext = (
  world: CombatWorldView,
  rng: SeededRng,
  origin: Vec2Like,
  aim: Vec2Like,
  heldTicks: number,
): DeliveryContext => ({
  world,
  source: entitySource(shooter),
  origin,
  aim,
  policy: alwaysHostile,
  rng,
  heldTicks,
});

describe('broadphase resolution equals the brute-force scan (every family)', () => {
  for (const family of FAMILIES) {
    it(`is behaviour-preserving for ${family} across seeded-random worlds`, () => {
      const driver = createSeededRng(0xc0ffee + family.length);
      for (let trial = 0; trial < 60; trial += 1) {
        const seed = driver.nextUint32();
        const setup = createSeededRng(seed);
        const actorCount = setup.nextInt(40) + 1;
        const actors = randomActors(setup, actorCount);
        const blockers = randomBlockers(setup);
        const delivery = randomDelivery(setup, family);
        const origin = vec2(randInRange(setup, -60, 60), randInRange(setup, -60, 60));
        const aim = vec2(randInRange(setup, -1, 1) || 1, randInRange(setup, -1, 1));
        const heldTicks = setup.nextInt(12);
        // A fresh, independent rng seed for each resolution path so the pellet
        // spread sampling is identical between the two worlds.
        const rngSeed = setup.nextUint32();

        const bruteWorld = withoutBroadphase(createInMemoryCombatWorld(actors, blockers));
        const fastWorld = createInMemoryCombatWorld(actors, blockers);
        expect(fastWorld.broadphase).toBeDefined();

        const brute = resolveDelivery(
          delivery,
          buildContext(bruteWorld, createSeededRng(rngSeed), origin, aim, heldTicks),
        );
        const fast = resolveDelivery(
          delivery,
          buildContext(fastWorld, createSeededRng(rngSeed), origin, aim, heldTicks),
        );

        const label = `${family} trial ${trial} (seed ${seed})`;
        expect(snapshotOutcomes(fast.outcomes), label).toEqual(snapshotOutcomes(brute.outcomes));
        expect(snapshotKnockbacks([...fast.knockbacks]), label).toEqual(
          snapshotKnockbacks([...brute.knockbacks]),
        );
      }
    });
  }
});

describe('broadphase projectile sweep equals the brute-force scan', () => {
  it('matches advanceProjectile output across seeded-random worlds', () => {
    const driver = createSeededRng(0xbeef);
    for (let trial = 0; trial < 80; trial += 1) {
      const seed = driver.nextUint32();
      const setup = createSeededRng(seed);
      const actors = randomActors(setup, setup.nextInt(40) + 1);
      const blockers = randomBlockers(setup);
      const projectile = new Projectile({
        id: makeProjectileId(1),
        source: shooter,
        x: randInRange(setup, -60, 60),
        y: randInRange(setup, -60, 60),
        vx: randInRange(setup, -10, 10),
        vy: randInRange(setup, -10, 10),
        ttlRemaining: setup.nextInt(10) + 1,
        damage: randInRange(setup, 5, 60),
        radius: randInRange(setup, 0.5, 8),
        falloff: noFalloff,
        knockback: setup.nextFloat() < 0.5 ? randInRange(setup, 1, 6) : 0,
        travelled: randInRange(setup, 0, 50),
      });

      const bruteWorld = withoutBroadphase(createInMemoryCombatWorld(actors, blockers));
      const fastWorld = createInMemoryCombatWorld(actors, blockers);

      const brute = advanceProjectile(bruteWorld, projectile, alwaysHostile);
      const fast = advanceProjectile(fastWorld, projectile, alwaysHostile);

      const label = `projectile trial ${trial} (seed ${seed})`;
      expect(
        fast.events.map((ev) => ev._tag),
        label,
      ).toEqual(brute.events.map((ev) => ev._tag));
      const dmg = (
        events: readonly { _tag: string }[],
      ): readonly { target: number; amount: number }[] =>
        events.flatMap((ev) =>
          ev._tag === 'DamageApplied' || ev._tag === 'EntityDefeated'
            ? [
                {
                  target: (ev as DamageOutcome).target as number,
                  amount: (ev as { amount: number }).amount,
                },
              ]
            : [],
        );
      expect(dmg(fast.events), label).toEqual(dmg(brute.events));
      expect(snapshotKnockbacks([...fast.knockbacks]), label).toEqual(
        snapshotKnockbacks([...brute.knockbacks]),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Large-N sanity: thousands of entities exercise the index path
// ---------------------------------------------------------------------------

describe('large-N broadphase sanity', () => {
  it('resolves an explosive identically with and without the index over thousands of entities', () => {
    const rng = createSeededRng(123456);
    const actors: CombatActorSeed[] = [];
    for (let i = 0; i < 3000; i += 1) {
      actors.push({
        entity: e(i + 2),
        health: fullHealth(1000),
        position: vec2(randInRange(rng, -500, 500), randInRange(rng, -500, 500)),
      });
    }
    const delivery = new ExplosiveDelivery({
      damage: 40,
      radius: 60,
      falloff: noFalloff,
      knockback: 3,
      requiresLineOfSight: false,
    });
    const origin = vec2(0, 0);
    const aim = vec2(1, 0);

    const bruteWorld = withoutBroadphase(createInMemoryCombatWorld(actors));
    const fastWorld = createInMemoryCombatWorld(actors);

    const brute = resolveDelivery(
      delivery,
      buildContext(bruteWorld, createSeededRng(1), origin, aim, 0),
    );
    const fast = resolveDelivery(
      delivery,
      buildContext(fastWorld, createSeededRng(1), origin, aim, 0),
    );

    expect(fast.outcomes.length).toBeGreaterThan(0);
    expect(snapshotOutcomes(fast.outcomes)).toEqual(snapshotOutcomes(brute.outcomes));
    expect(snapshotKnockbacks([...fast.knockbacks])).toEqual(
      snapshotKnockbacks([...brute.knockbacks]),
    );
  });

  it('resolves a pierce ray identically with and without the index over thousands of entities', () => {
    const rng = createSeededRng(987654);
    const actors: CombatActorSeed[] = [];
    for (let i = 0; i < 2000; i += 1) {
      actors.push({
        entity: e(i + 2),
        health: fullHealth(1000),
        position: vec2(randInRange(rng, -400, 400), randInRange(rng, -10, 10)),
      });
    }
    const delivery = new PierceDelivery({
      damage: 15,
      range: 400,
      hitRadius: 5,
      maxTargets: 8,
      falloff: noFalloff,
      knockback: 0,
    });
    const origin = vec2(-400, 0);
    const aim = vec2(1, 0);

    const bruteWorld = withoutBroadphase(createInMemoryCombatWorld(actors));
    const fastWorld = createInMemoryCombatWorld(actors);

    const brute = resolveDelivery(
      delivery,
      buildContext(bruteWorld, createSeededRng(1), origin, aim, 0),
    );
    const fast = resolveDelivery(
      delivery,
      buildContext(fastWorld, createSeededRng(1), origin, aim, 0),
    );

    expect(snapshotOutcomes(fast.outcomes)).toEqual(snapshotOutcomes(brute.outcomes));
  });
});

// ---------------------------------------------------------------------------
// Resolution edge cases through the broadphase path
// ---------------------------------------------------------------------------

describe('broadphase resolution edge cases', () => {
  const hitscan = new HitscanDelivery({
    damage: 10,
    range: 100,
    hitRadius: 2,
    falloff: noFalloff,
    knockback: 0,
  });

  const run = (actors: readonly CombatActorSeed[]): readonly OutcomeSnapshot[] => {
    const world = createInMemoryCombatWorld(actors);
    return snapshotOutcomes(
      resolveDelivery(hitscan, buildContext(world, createSeededRng(1), vec2(0, 0), vec2(1, 0), 0))
        .outcomes,
    );
  };

  it('hits nothing in an empty world', () => {
    expect(run([])).toEqual([]);
  });

  it('hits the only entity when it is in range', () => {
    expect(run([{ entity: e(2), health: fullHealth(100), position: vec2(10, 0) }])).toHaveLength(1);
  });

  it('skips entities that have no position', () => {
    const world = createInMemoryCombatWorld([
      { entity: e(2), health: fullHealth(100) },
      { entity: e(3), health: fullHealth(100), position: vec2(10, 0) },
    ]);
    const out = resolveDelivery(
      hitscan,
      buildContext(world, createSeededRng(1), vec2(0, 0), vec2(1, 0), 0),
    ).outcomes;
    expect(out).toHaveLength(1);
    expect(out[0]?.target).toBe(e(3));
  });
});
