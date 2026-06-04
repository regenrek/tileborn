import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { entitySource } from './damage.js';
import { fullHealth } from './health.js';
import { alwaysHostile, hostileWhenTeamsDiffer } from './hit-policy.js';
import { makeCombatEntityId, makeTeamId } from './ids.js';
import { applyDamageToEntity, createInMemoryCombatWorld } from './world.js';

const a = makeCombatEntityId(1);
const b = makeCombatEntityId(2);
const c = makeCombatEntityId(3);

describe('createInMemoryCombatWorld', () => {
  it('enumerates entities in ascending id order', () => {
    const world = createInMemoryCombatWorld([
      { entity: c, health: fullHealth(100) },
      { entity: a, health: fullHealth(100) },
      { entity: b, health: fullHealth(100) },
    ]);
    expect([...world.entities()]).toEqual([a, b, c]);
  });

  it('reads seeded health and team', () => {
    const world = createInMemoryCombatWorld([
      { entity: a, health: fullHealth(80), team: makeTeamId('blue') },
    ]);
    expect(Option.getOrNull(world.getHealth(a))?.current).toBe(80);
    expect(Option.getOrNull(world.getTeam(a))).toBe('blue');
    expect(Option.isNone(world.getHealth(b))).toBe(true);
  });
});

describe('applyDamageToEntity', () => {
  it('writes reduced health back through the port', () => {
    const world = createInMemoryCombatWorld([{ entity: b, health: fullHealth(100) }]);
    const outcome = applyDamageToEntity(world, b, 25, entitySource(a), alwaysHostile);
    expect(outcome._tag).toBe('DamageApplied');
    expect(Option.getOrNull(world.getHealth(b))?.current).toBe(75);
  });

  it('ignores a missing target without writing', () => {
    const world = createInMemoryCombatWorld([{ entity: b, health: fullHealth(100) }]);
    const outcome = applyDamageToEntity(world, c, 25, entitySource(a), alwaysHostile);
    expect(outcome._tag).toBe('DamageIgnored');
    if (outcome._tag === 'DamageIgnored') {
      expect(outcome.reason).toBe('no-op');
    }
  });

  it('does not mutate health when the policy declines the hit', () => {
    const world = createInMemoryCombatWorld([
      { entity: a, health: fullHealth(100), team: makeTeamId('blue') },
      { entity: b, health: fullHealth(100), team: makeTeamId('blue') },
    ]);
    const outcome = applyDamageToEntity(
      world,
      b,
      30,
      entitySource(a, makeTeamId('blue')),
      hostileWhenTeamsDiffer,
    );
    expect(outcome._tag).toBe('DamageIgnored');
    expect(Option.getOrNull(world.getHealth(b))?.current).toBe(100);
  });

  it('is deterministic across identical runs', () => {
    const run = (): number => {
      const world = createInMemoryCombatWorld([{ entity: b, health: fullHealth(100) }]);
      for (const amount of [10, 20, 5]) {
        applyDamageToEntity(world, b, amount, entitySource(a), alwaysHostile);
      }
      return Option.getOrNull(world.getHealth(b))?.current ?? -1;
    };
    expect(run()).toBe(run());
    expect(run()).toBe(65);
  });
});
