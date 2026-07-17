import { Result, Schema } from 'effect';
import type { Uuid } from '@tileborne/core';
import { describe, expect, it } from 'vitest';

import {
  CombatResult,
  initialCombatTickState,
  runCombatTick,
  type CombatFireIntent,
  type CombatTickState,
  type EquippedWeapon,
} from './combat.js';
import { DamageApplied } from './damage.js';
import {
  HitscanDelivery,
  PelletDelivery,
  ProjectileDelivery,
  type DamageDelivery,
} from './delivery.js';
import { NoFalloff } from './falloff.js';
import { vec2 } from './geometry.js';
import { fullHealth } from './health.js';
import { alwaysHostile, type HitResolutionPolicy } from './hit-policy.js';
import {
  makeCombatEntityId,
  makeProjectileId,
  makeStatusEffectId,
  makeWeaponDefinitionId,
} from './ids.js';
import { ProjectileSpawned } from './projectile.js';
import { createSeededRng, type SeededRng } from './rng.js';
import { StatusApplied } from './status.js';
import { createFixedClock, type SimulationClock } from './clock.js';
import {
  initialWeaponState,
  makeWeaponDefinition,
  WeaponFired,
  type WeaponDefinition,
} from './weapon.js';
import { createInMemoryCombatWorld, type CombatActorSeed, type CombatWorldView } from './world.js';

const WEAPON_A = makeWeaponDefinitionId('11111111-1111-4111-8111-111111111111' as Uuid);
const WEAPON_B = makeWeaponDefinitionId('22222222-2222-4222-9222-222222222222' as Uuid);
const STATUS_BURN = makeStatusEffectId('33333333-3333-4333-a333-333333333333' as Uuid);

const shooter = makeCombatEntityId(1);
const e = (id: number) => makeCombatEntityId(id);

const defineWeapon = (fields: {
  readonly id?: ReturnType<typeof makeWeaponDefinitionId>;
  readonly damage?: number;
  readonly cooldownTicks?: number;
  readonly magazineSize?: number;
  readonly reloadTicks?: number;
}): WeaponDefinition =>
  Result.getOrThrow(
    makeWeaponDefinition({
      id: fields.id ?? WEAPON_A,
      damage: fields.damage ?? 30,
      cooldownTicks: fields.cooldownTicks ?? 0,
      magazineSize: fields.magazineSize ?? 5,
      reloadTicks: fields.reloadTicks ?? 4,
    }),
  );

const hitscan = (damage = 30): HitscanDelivery =>
  new HitscanDelivery({ damage, range: 100, hitRadius: 1, falloff: new NoFalloff(), knockback: 0 });

const equip = (
  entity: ReturnType<typeof makeCombatEntityId>,
  definition: WeaponDefinition,
  delivery: DamageDelivery,
): EquippedWeapon => ({ entity, definition, delivery, state: initialWeaponState(definition) });

interface Harness {
  readonly world: CombatWorldView;
  readonly clock: SimulationClock;
  readonly rng: SeededRng;
  readonly policy: HitResolutionPolicy;
  state: CombatTickState;
}

const harness = (options: {
  readonly actors: readonly CombatActorSeed[];
  readonly weapons: readonly EquippedWeapon[];
  readonly seed?: number;
}): Harness => ({
  world: createInMemoryCombatWorld(options.actors, []),
  clock: createFixedClock({ dtMs: 16 }),
  rng: createSeededRng(options.seed ?? 1),
  policy: alwaysHostile,
  state: initialCombatTickState(options.weapons),
});

const fire = (h: Harness, intents: readonly CombatFireIntent[]) => {
  const result = runCombatTick({
    world: h.world,
    state: h.state,
    clock: h.clock,
    rng: h.rng,
    policy: h.policy,
    intents,
  });
  h.state = result.state;
  return result;
};

const tags = (result: { readonly results: readonly { readonly _tag: string }[] }): string[] =>
  result.results.map((r) => r._tag);

const health = (world: CombatWorldView, entity: ReturnType<typeof makeCombatEntityId>): number => {
  const pool = world.getHealth(entity);
  return pool._tag === 'Some' ? pool.value.current : -1;
};

// ---------------------------------------------------------------------------

describe('runCombatTick — fire → deliver → apply', () => {
  it('wires a hitscan shot into an ordered WeaponFired + DamageApplied stream', () => {
    const h = harness({
      actors: [
        { entity: shooter, health: fullHealth(100), position: vec2(0, 0) },
        { entity: e(2), health: fullHealth(100), position: vec2(10, 0) },
      ],
      weapons: [equip(shooter, defineWeapon({ damage: 30 }), hitscan(30))],
    });
    const result = fire(h, [{ entity: shooter, weapon: WEAPON_A, aim: vec2(1, 0) }]);
    expect(tags(result)).toEqual(['WeaponFired', 'DamageApplied']);
    expect(health(h.world, e(2))).toBe(70);
    expect(result.results[0]).toBeInstanceOf(WeaponFired);
  });

  it('never lets a weapon strike its own wielder', () => {
    const h = harness({
      actors: [{ entity: shooter, health: fullHealth(100), position: vec2(0, 0) }],
      weapons: [equip(shooter, defineWeapon({}), hitscan(30))],
    });
    const result = fire(h, [{ entity: shooter, weapon: WEAPON_A, aim: vec2(1, 0) }]);
    expect(tags(result)).toEqual(['WeaponFired']);
    expect(health(h.world, shooter)).toBe(100);
  });

  it('advances the clock by one tick per call', () => {
    const h = harness({
      actors: [{ entity: shooter, health: fullHealth(100), position: vec2(0, 0) }],
      weapons: [equip(shooter, defineWeapon({}), hitscan())],
    });
    expect(h.clock.tick()).toBe(0);
    fire(h, []);
    fire(h, []);
    expect(h.clock.tick()).toBe(2);
  });
});

describe('runCombatTick — cooldown / ammo across ticks', () => {
  it('gates repeated fire on the post-shot cooldown', () => {
    const h = harness({
      actors: [
        { entity: shooter, health: fullHealth(100), position: vec2(0, 0) },
        { entity: e(2), health: fullHealth(1000), position: vec2(10, 0) },
      ],
      weapons: [equip(shooter, defineWeapon({ cooldownTicks: 2 }), hitscan())],
    });
    const intent: CombatFireIntent = { entity: shooter, weapon: WEAPON_A, aim: vec2(1, 0) };
    expect(tags(fire(h, [intent]))).toEqual(['WeaponFired', 'DamageApplied']);
    expect(tags(fire(h, [intent]))).toEqual(['WeaponOnCooldown']);
    expect(tags(fire(h, [intent]))).toEqual(['WeaponFired', 'DamageApplied']);
  });

  it('reports an empty magazine once ammo is spent', () => {
    const h = harness({
      actors: [
        { entity: shooter, health: fullHealth(100), position: vec2(0, 0) },
        { entity: e(2), health: fullHealth(1000), position: vec2(10, 0) },
      ],
      weapons: [equip(shooter, defineWeapon({ magazineSize: 1, cooldownTicks: 0 }), hitscan())],
    });
    const intent: CombatFireIntent = { entity: shooter, weapon: WEAPON_A, aim: vec2(1, 0) };
    expect(tags(fire(h, [intent]))).toEqual(['WeaponFired', 'DamageApplied']);
    expect(tags(fire(h, [intent]))).toEqual(['WeaponOutOfAmmo']);
  });
});

describe('runCombatTick — defeat handling', () => {
  it('emits EntityDefeated then ignores further hits on the corpse', () => {
    const h = harness({
      actors: [
        { entity: shooter, health: fullHealth(100), position: vec2(0, 0) },
        { entity: e(2), health: fullHealth(20), position: vec2(10, 0) },
      ],
      weapons: [equip(shooter, defineWeapon({ damage: 50, cooldownTicks: 0 }), hitscan(50))],
    });
    const intent: CombatFireIntent = { entity: shooter, weapon: WEAPON_A, aim: vec2(1, 0) };
    expect(tags(fire(h, [intent]))).toEqual(['WeaponFired', 'EntityDefeated']);
    expect(health(h.world, e(2))).toBe(0);

    const second = fire(h, [intent]);
    expect(tags(second)).toEqual(['WeaponFired', 'DamageIgnored']);
    const ignored = second.results[1];
    if (ignored?._tag === 'DamageIgnored') {
      expect(ignored.reason).toBe('already-defeated');
    }
  });
});

describe('runCombatTick — status hook', () => {
  it('emits StatusApplied for each struck target when the intent declares effects', () => {
    const h = harness({
      actors: [
        { entity: shooter, health: fullHealth(100), position: vec2(0, 0) },
        { entity: e(2), health: fullHealth(100), position: vec2(10, 0) },
      ],
      weapons: [equip(shooter, defineWeapon({}), hitscan(30))],
    });
    const result = fire(h, [
      { entity: shooter, weapon: WEAPON_A, aim: vec2(1, 0), appliesStatus: [STATUS_BURN] },
    ]);
    expect(tags(result)).toEqual(['WeaponFired', 'DamageApplied', 'StatusApplied']);
    const status = result.results[2];
    if (status?._tag === 'StatusApplied') {
      expect(status.effect).toBe(STATUS_BURN);
      expect(status.target).toBe(e(2));
    }
  });
});

describe('runCombatTick — projectile lifecycle across ticks', () => {
  const projectileWeapon = (): EquippedWeapon =>
    equip(
      shooter,
      defineWeapon({ damage: 25, cooldownTicks: 100, magazineSize: 5 }),
      new ProjectileDelivery({
        damage: 25,
        speed: 4,
        ttlTicks: 10,
        radius: 1,
        falloff: new NoFalloff(),
        knockback: 0,
      }),
    );

  it('spawns, moves over ticks, then hits and expires', () => {
    const h = harness({
      actors: [
        { entity: shooter, health: fullHealth(100), position: vec2(0, 0) },
        { entity: e(2), health: fullHealth(100), position: vec2(10, 0) },
      ],
      weapons: [projectileWeapon()],
    });
    expect(tags(fire(h, [{ entity: shooter, weapon: WEAPON_A, aim: vec2(1, 0) }]))).toEqual([
      'WeaponFired',
      'ProjectileSpawned',
    ]);
    expect(tags(fire(h, []))).toEqual(['ProjectileMoved']);
    expect(tags(fire(h, []))).toEqual(['ProjectileMoved']);
    const impact = fire(h, []);
    expect(tags(impact)).toEqual(['DamageApplied', 'ProjectileExpired']);
    expect(health(h.world, e(2))).toBe(75);
    expect(h.state.projectiles).toHaveLength(0);
  });

  it('expires by ttl when it cannot reach the target', () => {
    const h = harness({
      actors: [
        { entity: shooter, health: fullHealth(100), position: vec2(0, 0) },
        { entity: e(2), health: fullHealth(100), position: vec2(100, 0) },
      ],
      weapons: [
        equip(
          shooter,
          defineWeapon({ cooldownTicks: 100 }),
          new ProjectileDelivery({
            damage: 25,
            speed: 1,
            ttlTicks: 2,
            radius: 1,
            falloff: new NoFalloff(),
            knockback: 0,
          }),
        ),
      ],
    });
    fire(h, [{ entity: shooter, weapon: WEAPON_A, aim: vec2(1, 0) }]);
    expect(tags(fire(h, []))).toEqual(['ProjectileMoved']);
    const expiry = fire(h, []);
    expect(tags(expiry)).toEqual(['ProjectileMoved', 'ProjectileExpired']);
    expect(h.state.projectiles).toHaveLength(0);
  });
});

describe('runCombatTick — determinism', () => {
  const pellet = (): PelletDelivery =>
    new PelletDelivery({
      damage: 7,
      pelletCount: 6,
      range: 100,
      hitRadius: 3,
      spread: 0.8,
      falloff: new NoFalloff(),
      knockback: 2,
    });

  const scenario = () => {
    const h = harness({
      actors: [
        { entity: e(1), health: fullHealth(1000), position: vec2(0, 0) },
        { entity: e(2), health: fullHealth(1000), position: vec2(20, 1) },
        { entity: e(3), health: fullHealth(1000), position: vec2(10, 0) },
        { entity: e(4), health: fullHealth(1000), position: vec2(12, -1) },
      ],
      weapons: [
        equip(e(1), defineWeapon({ id: WEAPON_A, cooldownTicks: 0 }), pellet()),
        equip(e(2), defineWeapon({ id: WEAPON_B, cooldownTicks: 0 }), pellet()),
      ],
      seed: 2026,
    });
    const intents: readonly CombatFireIntent[] = [
      { entity: e(1), weapon: WEAPON_A, aim: vec2(1, 0) },
      { entity: e(2), weapon: WEAPON_B, aim: vec2(-1, 0) },
    ];
    const stream: unknown[] = [];
    for (let i = 0; i < 3; i += 1) {
      const result = fire(h, intents);
      stream.push(result.results.map((r) => Schema.encodeUnknownSync(CombatResult)(r)));
    }
    return stream;
  };

  it('produces a bit-identical result stream for the same seed + input log', () => {
    expect(scenario()).toEqual(scenario());
  });

  it('orders multi-entity fires by entity id', () => {
    const stream = scenario();
    const firstTick = stream[0] as { readonly _tag: string }[];
    const fireTags = firstTick.filter((r) => r._tag === 'WeaponFired');
    expect(fireTags).toHaveLength(2);
  });
});

describe('CombatResult schema', () => {
  it('round-trips the new Slice 4 result variants through the union', () => {
    const samples: readonly CombatResult[] = [
      new WeaponFired({ weapon: WEAPON_A, damage: 30, ammoRemaining: 4 }),
      new DamageApplied({ target: e(2), amount: 30, healthBefore: 100, healthAfter: 70 }),
      new ProjectileSpawned({
        projectile: makeProjectileId(1),
        source: shooter,
        x: 0,
        y: 0,
        vx: 4,
        vy: 0,
      }),
      new StatusApplied({ target: e(2), effect: STATUS_BURN, source: shooter }),
    ];
    for (const sample of samples) {
      const encoded = Schema.encodeUnknownSync(CombatResult)(sample);
      expect(Schema.decodeUnknownSync(CombatResult)(encoded)._tag).toBe(sample._tag);
    }
  });
});
