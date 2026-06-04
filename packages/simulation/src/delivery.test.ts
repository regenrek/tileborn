import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  BounceDelivery,
  ChargeDelivery,
  DamageDelivery,
  ExplosiveDelivery,
  HitscanDelivery,
  KnockbackImpulse,
  MeleeDelivery,
  PelletDelivery,
  PierceDelivery,
  ProjectileDelivery,
  resolveDelivery,
  validateDamageDelivery,
  type DeliveryContext,
} from './delivery.js';
import { entitySource, type DamageOutcome } from './damage.js';
import { LinearFalloff, NoFalloff } from './falloff.js';
import { CombatBlocker, vec2, type Vec2Like } from './geometry.js';
import { fullHealth } from './health.js';
import { alwaysHostile } from './hit-policy.js';
import { makeCombatEntityId } from './ids.js';
import { createSeededRng } from './rng.js';
import { createInMemoryCombatWorld, type CombatActorSeed } from './world.js';

const shooter = makeCombatEntityId(1);

const e = (id: number): ReturnType<typeof makeCombatEntityId> => makeCombatEntityId(id);

interface ScenarioOptions {
  readonly actors: readonly CombatActorSeed[];
  readonly blockers?: readonly CombatBlocker[];
  readonly origin?: Vec2Like;
  readonly aim?: Vec2Like;
  readonly seed?: number;
  readonly heldTicks?: number;
}

const scenario = (
  delivery: DamageDelivery,
  options: ScenarioOptions,
): {
  readonly outcomes: readonly DamageOutcome[];
  readonly knockbacks: readonly KnockbackImpulse[];
} => {
  const world = createInMemoryCombatWorld(options.actors, options.blockers ?? []);
  const ctx: DeliveryContext = {
    world,
    source: entitySource(shooter),
    origin: options.origin ?? vec2(0, 0),
    aim: options.aim ?? vec2(1, 0),
    policy: alwaysHostile,
    rng: createSeededRng(options.seed ?? 1),
    ...(options.heldTicks === undefined ? {} : { heldTicks: options.heldTicks }),
  };
  return resolveDelivery(delivery, ctx);
};

const target = (id: number, position: Vec2Like, max = 100): CombatActorSeed => ({
  entity: e(id),
  health: fullHealth(max),
  position: vec2(position.x, position.y),
});

const noFalloff = new NoFalloff();

const appliedAmount = (outcome: DamageOutcome): number => {
  if (outcome._tag === 'DamageApplied' || outcome._tag === 'EntityDefeated') {
    return outcome.amount;
  }
  return 0;
};

// ---------------------------------------------------------------------------

describe('hitscan delivery', () => {
  it('damages a single line-of-sight target via resolveDamage', () => {
    const delivery = new HitscanDelivery({
      damage: 30,
      range: 100,
      hitRadius: 1,
      falloff: noFalloff,
      knockback: 0,
    });
    const { outcomes } = scenario(delivery, { actors: [target(2, vec2(10, 0))] });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?._tag).toBe('DamageApplied');
    expect(appliedAmount(outcomes[0]!)).toBe(30);
  });

  it('hits only the nearest of several targets on the ray', () => {
    const delivery = new HitscanDelivery({
      damage: 10,
      range: 100,
      hitRadius: 1,
      falloff: noFalloff,
      knockback: 0,
    });
    const { outcomes } = scenario(delivery, {
      actors: [target(3, vec2(20, 0)), target(2, vec2(10, 0))],
    });
    expect(outcomes).toHaveLength(1);
    if (outcomes[0]?._tag === 'DamageApplied') {
      expect(outcomes[0].target).toBe(e(2));
    }
  });

  it('point-blank target is hit even at zero range', () => {
    const delivery = new HitscanDelivery({
      damage: 10,
      range: 0,
      hitRadius: 1,
      falloff: noFalloff,
      knockback: 0,
    });
    const { outcomes } = scenario(delivery, { actors: [target(2, vec2(0, 0))] });
    expect(outcomes).toHaveLength(1);
  });

  it('hits nothing when no target is in range', () => {
    const delivery = new HitscanDelivery({
      damage: 10,
      range: 5,
      hitRadius: 1,
      falloff: noFalloff,
      knockback: 0,
    });
    const { outcomes } = scenario(delivery, { actors: [target(2, vec2(50, 0))] });
    expect(outcomes).toHaveLength(0);
  });
});

describe('falloff', () => {
  it('reduces damage with distance', () => {
    const falloff = new LinearFalloff({ startDistance: 0, endDistance: 20, minMultiplier: 0 });
    const make = (x: number): readonly DamageOutcome[] =>
      scenario(
        new HitscanDelivery({ damage: 40, range: 100, hitRadius: 1, falloff, knockback: 0 }),
        { actors: [target(2, vec2(x, 0))] },
      ).outcomes;
    const near = appliedAmount(make(5)[0]!);
    const far = appliedAmount(make(15)[0]!);
    expect(near).toBeCloseTo(30);
    expect(far).toBeCloseTo(10);
    expect(near).toBeGreaterThan(far);
  });
});

describe('line-of-sight blocking', () => {
  const wall = new CombatBlocker({
    minX: 4,
    minY: -2,
    maxX: 6,
    maxY: 2,
    blocksProjectiles: true,
    blocksVision: true,
  });

  it('blocks a hit through projectile-blocking geometry', () => {
    const delivery = new HitscanDelivery({
      damage: 30,
      range: 100,
      hitRadius: 1,
      falloff: noFalloff,
      knockback: 0,
    });
    const blocked = scenario(delivery, { actors: [target(2, vec2(10, 0))], blockers: [wall] });
    expect(blocked.outcomes).toHaveLength(0);

    const clear = scenario(delivery, { actors: [target(2, vec2(10, 0))] });
    expect(clear.outcomes).toHaveLength(1);
  });
});

describe('knockback', () => {
  it('emits an impulse along the hit direction when knockback > 0', () => {
    const delivery = new HitscanDelivery({
      damage: 10,
      range: 100,
      hitRadius: 1,
      falloff: noFalloff,
      knockback: 5,
    });
    const { knockbacks } = scenario(delivery, { actors: [target(2, vec2(10, 0))] });
    expect(knockbacks).toHaveLength(1);
    expect(knockbacks[0]?.target).toBe(e(2));
    expect(knockbacks[0]?.x).toBeCloseTo(5);
    expect(knockbacks[0]?.y).toBeCloseTo(0);
  });

  it('emits no impulse when knockback is zero', () => {
    const delivery = new HitscanDelivery({
      damage: 10,
      range: 100,
      hitRadius: 1,
      falloff: noFalloff,
      knockback: 0,
    });
    const { knockbacks } = scenario(delivery, { actors: [target(2, vec2(10, 0))] });
    expect(knockbacks).toHaveLength(0);
  });
});

describe('pellet delivery (multi-sample spread)', () => {
  const delivery = new PelletDelivery({
    damage: 8,
    pelletCount: 5,
    range: 100,
    hitRadius: 6,
    spread: 0.6,
    falloff: noFalloff,
    knockback: 0,
  });

  it('samples every pellet against the target cluster', () => {
    const { outcomes } = scenario(delivery, { actors: [target(2, vec2(10, 0), 1000)] });
    expect(outcomes).toHaveLength(5);
  });

  it('is deterministic for a fixed seed', () => {
    const run = (): readonly number[] =>
      scenario(delivery, { actors: [target(2, vec2(10, 0), 1000)], seed: 42 }).outcomes.map(
        appliedAmount,
      );
    expect(run()).toEqual(run());
  });

  it('the seeded sequence drives the spread (state advances per pellet)', () => {
    const rng = createSeededRng(99);
    const before = rng.state();
    const world = createInMemoryCombatWorld([target(2, vec2(10, 0), 1000)]);
    resolveDelivery(delivery, {
      world,
      source: entitySource(shooter),
      origin: vec2(0, 0),
      aim: vec2(1, 0),
      policy: alwaysHostile,
      rng,
    });
    expect(rng.state()).not.toBe(before);
  });
});

describe('projectile delivery (integrated flight)', () => {
  const delivery = new ProjectileDelivery({
    damage: 25,
    speed: 4,
    ttlTicks: 10,
    radius: 1,
    falloff: noFalloff,
    knockback: 0,
  });

  it('hits a target swept along the flight path', () => {
    const { outcomes } = scenario(delivery, { actors: [target(2, vec2(10, 0))] });
    expect(outcomes).toHaveLength(1);
    expect(appliedAmount(outcomes[0]!)).toBe(25);
  });

  it('expires without a hit when ttl is too short to reach the target', () => {
    const short = new ProjectileDelivery({
      damage: 25,
      speed: 1,
      ttlTicks: 3,
      radius: 1,
      falloff: noFalloff,
      knockback: 0,
    });
    const { outcomes } = scenario(short, { actors: [target(2, vec2(10, 0))] });
    expect(outcomes).toHaveLength(0);
  });

  it('is stopped by projectile-blocking geometry', () => {
    const wall = new CombatBlocker({
      minX: 5,
      minY: -2,
      maxX: 6,
      maxY: 2,
      blocksProjectiles: true,
      blocksVision: false,
    });
    const { outcomes } = scenario(delivery, { actors: [target(2, vec2(10, 0))], blockers: [wall] });
    expect(outcomes).toHaveLength(0);
  });
});

describe('pierce delivery (penetrate N targets)', () => {
  it('hits up to maxTargets along the ray, nearest first', () => {
    const delivery = new PierceDelivery({
      damage: 10,
      range: 100,
      hitRadius: 1,
      maxTargets: 2,
      falloff: noFalloff,
      knockback: 0,
    });
    const { outcomes } = scenario(delivery, {
      actors: [target(2, vec2(5, 0)), target(3, vec2(10, 0)), target(4, vec2(15, 0))],
    });
    expect(outcomes).toHaveLength(2);
  });

  it('stops at a wall before deeper targets', () => {
    const delivery = new PierceDelivery({
      damage: 10,
      range: 100,
      hitRadius: 1,
      maxTargets: 5,
      falloff: noFalloff,
      knockback: 0,
    });
    const wall = new CombatBlocker({
      minX: 12,
      minY: -2,
      maxX: 13,
      maxY: 2,
      blocksProjectiles: true,
      blocksVision: false,
    });
    const { outcomes } = scenario(delivery, {
      actors: [target(2, vec2(5, 0)), target(3, vec2(10, 0)), target(4, vec2(15, 0))],
      blockers: [wall],
    });
    expect(outcomes).toHaveLength(2);
  });
});

describe('explosive delivery (AoE + falloff)', () => {
  it('damages every target within the blast radius', () => {
    const delivery = new ExplosiveDelivery({
      damage: 50,
      radius: 10,
      falloff: noFalloff,
      knockback: 0,
      requiresLineOfSight: false,
    });
    const { outcomes } = scenario(delivery, {
      actors: [target(2, vec2(3, 0)), target(3, vec2(8, 0)), target(4, vec2(20, 0))],
    });
    expect(outcomes).toHaveLength(2);
  });

  it('scales blast damage by distance from the center', () => {
    const delivery = new ExplosiveDelivery({
      damage: 50,
      radius: 10,
      falloff: new LinearFalloff({ startDistance: 0, endDistance: 10, minMultiplier: 0 }),
      knockback: 0,
      requiresLineOfSight: false,
    });
    const { outcomes } = scenario(delivery, {
      actors: [target(2, vec2(2, 0)), target(3, vec2(8, 0))],
    });
    const byTarget = new Map(
      outcomes.flatMap((o) =>
        o._tag === 'DamageApplied' ? [[o.target as number, o.amount] as const] : [],
      ),
    );
    expect(byTarget.get(2)!).toBeGreaterThan(byTarget.get(3)!);
  });

  it('spares targets behind cover when requiresLineOfSight is set', () => {
    const wall = new CombatBlocker({
      minX: 4,
      minY: -2,
      maxX: 6,
      maxY: 2,
      blocksProjectiles: true,
      blocksVision: true,
    });
    const delivery = new ExplosiveDelivery({
      damage: 50,
      radius: 20,
      falloff: noFalloff,
      knockback: 0,
      requiresLineOfSight: true,
    });
    const { outcomes } = scenario(delivery, {
      actors: [target(2, vec2(10, 0))],
      blockers: [wall],
    });
    expect(outcomes).toHaveLength(0);
  });
});

describe('charge delivery (windup → release scaling)', () => {
  const delivery = new ChargeDelivery({
    minDamage: 10,
    maxDamage: 50,
    chargeTicks: 10,
    range: 100,
    hitRadius: 1,
    falloff: noFalloff,
    knockback: 0,
  });

  it('scales damage between min and max by charge progress', () => {
    const half = scenario(delivery, { actors: [target(2, vec2(10, 0))], heldTicks: 5 });
    expect(appliedAmount(half.outcomes[0]!)).toBeCloseTo(30);

    const full = scenario(delivery, { actors: [target(2, vec2(10, 0))], heldTicks: 10 });
    expect(appliedAmount(full.outcomes[0]!)).toBeCloseTo(50);

    const none = scenario(delivery, { actors: [target(2, vec2(10, 0))], heldTicks: 0 });
    expect(appliedAmount(none.outcomes[0]!)).toBeCloseTo(10);
  });

  it('treats an omitted heldTicks as fully charged', () => {
    const { outcomes } = scenario(delivery, { actors: [target(2, vec2(10, 0))] });
    expect(appliedAmount(outcomes[0]!)).toBeCloseTo(50);
  });
});

describe('bounce delivery (reflect off geometry)', () => {
  const wall = new CombatBlocker({
    minX: 10,
    minY: -100,
    maxX: 12,
    maxY: 100,
    blocksProjectiles: true,
    blocksVision: false,
  });

  it('hits a target only reachable after a reflection', () => {
    const delivery = new BounceDelivery({
      damage: 20,
      range: 200,
      hitRadius: 0.5,
      maxBounces: 1,
      falloff: noFalloff,
      knockback: 0,
    });
    const { outcomes } = scenario(delivery, {
      actors: [target(2, vec2(5, 15))],
      blockers: [wall],
      aim: vec2(1, 1),
    });
    expect(outcomes).toHaveLength(1);
  });

  it('cannot reach the target with no bounces left', () => {
    const delivery = new BounceDelivery({
      damage: 20,
      range: 200,
      hitRadius: 0.5,
      maxBounces: 0,
      falloff: noFalloff,
      knockback: 0,
    });
    const { outcomes } = scenario(delivery, {
      actors: [target(2, vec2(5, 15))],
      blockers: [wall],
      aim: vec2(1, 1),
    });
    expect(outcomes).toHaveLength(0);
  });
});

describe('melee delivery (cone/arc)', () => {
  const delivery = new MeleeDelivery({ damage: 35, range: 3, arc: Math.PI / 2, knockback: 0 });

  it('hits targets inside the arc and spares those outside it', () => {
    const { outcomes } = scenario(delivery, {
      actors: [
        target(2, vec2(2, 0)), // in front, inside arc
        target(3, vec2(0, 2)), // 90° off aim, outside half-arc
        target(4, vec2(-2, 0)), // behind
        target(5, vec2(0, 0)), // point-blank
      ],
    });
    const hitIds = new Set(
      outcomes.flatMap((o) =>
        o._tag === 'DamageApplied' || o._tag === 'EntityDefeated' ? [o.target as number] : [],
      ),
    );
    expect(hitIds.has(2)).toBe(true);
    expect(hitIds.has(5)).toBe(true);
    expect(hitIds.has(3)).toBe(false);
    expect(hitIds.has(4)).toBe(false);
  });
});

describe('determinism', () => {
  it('produces a bit-identical outcome stream across two runs (fixed seed)', () => {
    const delivery = new PelletDelivery({
      damage: 7,
      pelletCount: 8,
      range: 100,
      hitRadius: 2,
      spread: 0.9,
      falloff: new LinearFalloff({ startDistance: 0, endDistance: 30, minMultiplier: 0.25 }),
      knockback: 3,
    });
    const actors = [
      target(2, vec2(10, -2), 1000),
      target(3, vec2(12, 0), 1000),
      target(4, vec2(11, 3), 1000),
    ];
    const snapshot = (): unknown =>
      scenario(delivery, { actors, seed: 2026 }).outcomes.map((o) => ({
        tag: o._tag,
        target: o.target as number,
        amount: appliedAmount(o),
      }));
    expect(snapshot()).toEqual(snapshot());
  });
});

describe('validateDamageDelivery', () => {
  it('accepts a structurally valid delivery', () => {
    const result = validateDamageDelivery(
      new HitscanDelivery({ damage: 10, range: 5, hitRadius: 1, falloff: noFalloff, knockback: 0 }),
    );
    expect(Result.isSuccess(result)).toBe(true);
  });

  it('rejects invalid counts and ordering', () => {
    expect(
      Result.isFailure(
        validateDamageDelivery(
          new PelletDelivery({
            damage: 1,
            pelletCount: 0,
            range: 1,
            hitRadius: 1,
            spread: 0,
            falloff: noFalloff,
            knockback: 0,
          }),
        ),
      ),
    ).toBe(true);
    expect(
      Result.isFailure(
        validateDamageDelivery(
          new ChargeDelivery({
            minDamage: 50,
            maxDamage: 10,
            chargeTicks: 5,
            range: 1,
            hitRadius: 1,
            falloff: noFalloff,
            knockback: 0,
          }),
        ),
      ),
    ).toBe(true);
  });
});

describe('schema round-trips', () => {
  it('round-trips delivery variants through the union', () => {
    const samples: readonly DamageDelivery[] = [
      new HitscanDelivery({ damage: 10, range: 5, hitRadius: 1, falloff: noFalloff, knockback: 2 }),
      new ProjectileDelivery({
        damage: 25,
        speed: 4,
        ttlTicks: 10,
        radius: 1,
        falloff: new LinearFalloff({ startDistance: 0, endDistance: 10, minMultiplier: 0.5 }),
        knockback: 0,
      }),
      new ExplosiveDelivery({
        damage: 50,
        radius: 10,
        falloff: noFalloff,
        knockback: 1,
        requiresLineOfSight: true,
      }),
      new MeleeDelivery({ damage: 35, range: 3, arc: 1.2, knockback: 4 }),
    ];
    for (const sample of samples) {
      const encoded = Schema.encodeUnknownSync(DamageDelivery)(sample);
      const decoded = Schema.decodeUnknownSync(DamageDelivery)(encoded);
      expect(decoded._tag).toBe(sample._tag);
    }
  });

  it('round-trips a KnockbackImpulse', () => {
    const impulse = new KnockbackImpulse({ target: e(2), x: 1.5, y: -2.5 });
    const encoded = Schema.encodeUnknownSync(KnockbackImpulse)(impulse);
    expect(Schema.decodeUnknownSync(KnockbackImpulse)(encoded)).toEqual(impulse);
  });
});
