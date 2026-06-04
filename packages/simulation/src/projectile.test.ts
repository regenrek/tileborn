import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { NoFalloff } from './falloff.js';
import { CombatBlocker, vec2 } from './geometry.js';
import { fullHealth } from './health.js';
import { alwaysHostile } from './hit-policy.js';
import { makeCombatEntityId, makeProjectileId } from './ids.js';
import {
  advanceProjectile,
  createProjectileFromDelivery,
  Projectile,
  ProjectileExpired,
  ProjectileMoved,
  ProjectileSpawned,
} from './projectile.js';
import { ProjectileDelivery } from './delivery.js';
import { createInMemoryCombatWorld, type CombatActorSeed } from './world.js';

const shooter = makeCombatEntityId(1);
const target = makeCombatEntityId(2);

const makeProjectile = (
  fields: Partial<ConstructorParameters<typeof Projectile>[0]> = {},
): Projectile =>
  new Projectile({
    id: makeProjectileId(1),
    source: shooter,
    x: 0,
    y: 0,
    vx: 4,
    vy: 0,
    ttlRemaining: 10,
    damage: 25,
    radius: 1,
    falloff: new NoFalloff(),
    knockback: 0,
    travelled: 0,
    ...fields,
  });

const worldWith = (...actors: readonly CombatActorSeed[]) => createInMemoryCombatWorld(actors, []);

describe('createProjectileFromDelivery', () => {
  it('uses ProjectileDelivery.speed as the canonical per-tick velocity', () => {
    const projectile = createProjectileFromDelivery({
      id: makeProjectileId(2),
      source: shooter,
      origin: vec2(10, 20),
      direction: vec2(0, 5),
      delivery: new ProjectileDelivery({
        damage: 10,
        speed: 7,
        ttlTicks: 12,
        radius: 3,
        falloff: new NoFalloff(),
        knockback: 0,
      }),
    });

    expect(projectile.x).toBe(10);
    expect(projectile.y).toBe(20);
    expect(projectile.vx).toBeCloseTo(0);
    expect(projectile.vy).toBeCloseTo(7);
    expect(projectile.ttlRemaining).toBe(12);
  });
});

describe('advanceProjectile', () => {
  it('moves forward and decrements ttl when nothing is hit', () => {
    const world = worldWith({ entity: target, health: fullHealth(100), position: vec2(100, 0) });
    const step = advanceProjectile(world, makeProjectile(), alwaysHostile);
    expect(step.alive?.x).toBe(4);
    expect(step.alive?.ttlRemaining).toBe(9);
    expect(step.alive?.travelled).toBe(4);
    expect(step.events).toHaveLength(1);
    expect(step.events[0]?._tag).toBe('ProjectileMoved');
  });

  it('hits a target swept along the step and expires', () => {
    const world = worldWith({ entity: target, health: fullHealth(100), position: vec2(3, 0) });
    const step = advanceProjectile(world, makeProjectile(), alwaysHostile);
    expect(step.alive).toBeUndefined();
    const tags = step.events.map((e) => e._tag);
    expect(tags).toEqual(['DamageApplied', 'ProjectileExpired']);
    const expired = step.events[1];
    if (expired?._tag === 'ProjectileExpired') {
      expect(expired.reason).toBe('hit');
    }
  });

  it('expires on blocking geometry without dealing damage', () => {
    // The wall straddles the center flight line (y ∈ [-5, 5]), so it blocks
    // regardless of radius; the grazing case below covers the radius-aware path.
    const wall = new CombatBlocker({
      minX: 1,
      minY: -5,
      maxX: 2,
      maxY: 5,
      blocksProjectiles: true,
      blocksVision: false,
    });
    const world = createInMemoryCombatWorld(
      [{ entity: target, health: fullHealth(100), position: vec2(3, 0) }],
      [wall],
    );
    const step = advanceProjectile(world, makeProjectile(), alwaysHostile);
    expect(step.alive).toBeUndefined();
    expect(step.events).toHaveLength(1);
    if (step.events[0]?._tag === 'ProjectileExpired') {
      expect(step.events[0].reason).toBe('blocked');
    }
  });

  it('culls a projectile grazing a wall within its radius, but not beyond it', () => {
    // Regression for ADR-0018 Slice 7 review: blocking now sweeps the projectile
    // *radius* against walls (Minkowski-style), matching the radius-aware entity
    // hit test. The center path runs along y = 0 and never enters the wall
    // (minY = 2), but a radius-3 body overlaps it — the pre-fix center-only test
    // let such a shot tunnel through.
    const wall = new CombatBlocker({
      minX: 1,
      minY: 2,
      maxX: 2,
      maxY: 10,
      blocksProjectiles: true,
      blocksVision: false,
    });
    const world = createInMemoryCombatWorld(
      [{ entity: target, health: fullHealth(100), position: vec2(100, 0) }],
      [wall],
    );

    const grazing = advanceProjectile(world, makeProjectile({ radius: 3 }), alwaysHostile);
    expect(grazing.alive).toBeUndefined();
    expect(grazing.events).toHaveLength(1);
    if (grazing.events[0]?._tag === 'ProjectileExpired') {
      expect(grazing.events[0].reason).toBe('blocked');
    }

    // A radius-1 body leaves a clear 2-unit gap to the wall, so the same shot
    // passes — proving the cull is driven by the radius, not the wall position.
    const clears = advanceProjectile(world, makeProjectile({ radius: 1 }), alwaysHostile);
    expect(clears.alive).toBeDefined();
    expect(clears.events.map((e) => e._tag)).toEqual(['ProjectileMoved']);
  });

  it('expires on the tick ttl reaches zero, emitting move then expiry', () => {
    const world = worldWith({ entity: target, health: fullHealth(100), position: vec2(100, 0) });
    const step = advanceProjectile(world, makeProjectile({ ttlRemaining: 1 }), alwaysHostile);
    expect(step.alive).toBeUndefined();
    expect(step.events.map((e) => e._tag)).toEqual(['ProjectileMoved', 'ProjectileExpired']);
    if (step.events[1]?._tag === 'ProjectileExpired') {
      expect(step.events[1].reason).toBe('ttl');
    }
  });

  it('emits a knockback impulse along the flight direction on impact', () => {
    const world = worldWith({ entity: target, health: fullHealth(100), position: vec2(3, 0) });
    const step = advanceProjectile(world, makeProjectile({ knockback: 7 }), alwaysHostile);
    expect(step.knockbacks).toHaveLength(1);
    expect(step.knockbacks[0]?.x).toBeCloseTo(7);
    expect(step.knockbacks[0]?.y).toBeCloseTo(0);
  });

  it('never strikes a target sitting at the source position (excluded by the orchestrator)', () => {
    // advanceProjectile itself does not exclude the source; the orchestrator
    // passes a filtered view. Here the source is absent, so a same-spot target
    // at the origin would be hit immediately — documents the raw step behavior.
    const world = worldWith({ entity: target, health: fullHealth(100), position: vec2(0, 0) });
    const step = advanceProjectile(world, makeProjectile(), alwaysHostile);
    expect(step.events[0]?._tag).toBe('DamageApplied');
  });
});

describe('projectile schema round-trips', () => {
  it('round-trips an in-flight Projectile', () => {
    const projectile = makeProjectile({ travelled: 12.5 });
    const encoded = Schema.encodeUnknownSync(Projectile)(projectile);
    const decoded = Schema.decodeUnknownSync(Projectile)(encoded);
    expect(decoded.id).toBe(projectile.id);
    expect(decoded.travelled).toBe(12.5);
  });

  it('round-trips the lifecycle result values', () => {
    const spawned = new ProjectileSpawned({
      projectile: makeProjectileId(1),
      source: shooter,
      x: 0,
      y: 0,
      vx: 4,
      vy: 0,
    });
    const moved = new ProjectileMoved({ projectile: makeProjectileId(1), x: 4, y: 0 });
    const expired = new ProjectileExpired({
      projectile: makeProjectileId(1),
      reason: 'hit',
      x: 10,
      y: 0,
    });
    expect(
      Schema.decodeUnknownSync(ProjectileSpawned)(
        Schema.encodeUnknownSync(ProjectileSpawned)(spawned),
      ),
    ).toEqual(spawned);
    expect(
      Schema.decodeUnknownSync(ProjectileMoved)(Schema.encodeUnknownSync(ProjectileMoved)(moved)),
    ).toEqual(moved);
    expect(
      Schema.decodeUnknownSync(ProjectileExpired)(
        Schema.encodeUnknownSync(ProjectileExpired)(expired),
      ),
    ).toEqual(expired);
  });
});
