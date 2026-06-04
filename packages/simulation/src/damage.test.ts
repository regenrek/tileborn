import { Option, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  DamageApplied,
  DamageOutcome,
  EntityDefeated,
  entitySource,
  environmentSource,
  resolveDamage,
  type DamageTarget,
} from './damage.js';
import { fullHealth, HealthComponent } from './health.js';
import { alwaysHostile, hostileWhenTeamsDiffer } from './hit-policy.js';
import { makeCombatEntityId, makeTeamId } from './ids.js';

const attacker = makeCombatEntityId(1);
const victim = makeCombatEntityId(2);

const targetWith = (health: HealthComponent, team?: string): DamageTarget => ({
  entity: victim,
  team: team === undefined ? Option.none() : Option.some(makeTeamId(team)),
  health,
});

describe('resolveDamage', () => {
  it('applies non-lethal damage and returns DamageApplied', () => {
    const result = resolveDamage(
      targetWith(fullHealth(100)),
      30,
      entitySource(attacker),
      alwaysHostile,
    );
    expect(result.health.current).toBe(70);
    expect(result.outcome).toBeInstanceOf(DamageApplied);
    if (result.outcome._tag === 'DamageApplied') {
      expect(result.outcome.amount).toBe(30);
      expect(result.outcome.healthBefore).toBe(100);
      expect(result.outcome.healthAfter).toBe(70);
      expect(result.outcome.target).toBe(victim);
    }
  });

  it('returns EntityDefeated when health reaches 0', () => {
    const result = resolveDamage(
      targetWith(fullHealth(40)),
      40,
      entitySource(attacker),
      alwaysHostile,
    );
    expect(result.health.current).toBe(0);
    expect(result.health.isDefeated).toBe(true);
    expect(result.outcome).toBeInstanceOf(EntityDefeated);
  });

  it('clamps overkill, reporting only the amount actually applied', () => {
    const result = resolveDamage(
      targetWith(fullHealth(40)),
      999,
      entitySource(attacker),
      alwaysHostile,
    );
    expect(result.health.current).toBe(0);
    if (result.outcome._tag === 'EntityDefeated') {
      expect(result.outcome.amount).toBe(40);
    }
  });

  it('ignores zero and negative amounts (no-op), leaving health unchanged', () => {
    const before = fullHealth(100);
    for (const amount of [0, -10, Number.NaN]) {
      const result = resolveDamage(
        targetWith(before),
        amount,
        entitySource(attacker),
        alwaysHostile,
      );
      expect(result.health).toBe(before);
      expect(result.outcome._tag).toBe('DamageIgnored');
      if (result.outcome._tag === 'DamageIgnored') {
        expect(result.outcome.reason).toBe('no-op');
      }
    }
  });

  it('ignores hits against an already-defeated target', () => {
    const dead = new HealthComponent({ current: 0, max: 100 });
    const result = resolveDamage(targetWith(dead), 25, entitySource(attacker), alwaysHostile);
    expect(result.outcome._tag).toBe('DamageIgnored');
    if (result.outcome._tag === 'DamageIgnored') {
      expect(result.outcome.reason).toBe('already-defeated');
    }
  });

  it('respects an injected hostility policy (same-team blocked)', () => {
    const result = resolveDamage(
      targetWith(fullHealth(100), 'blue'),
      30,
      entitySource(attacker, makeTeamId('blue')),
      hostileWhenTeamsDiffer,
    );
    expect(result.health.current).toBe(100);
    expect(result.outcome._tag).toBe('DamageIgnored');
    if (result.outcome._tag === 'DamageIgnored') {
      expect(result.outcome.reason).toBe('not-hostile');
    }
  });

  it('applies cross-team damage under the team policy', () => {
    const result = resolveDamage(
      targetWith(fullHealth(100), 'red'),
      30,
      entitySource(attacker, makeTeamId('blue')),
      hostileWhenTeamsDiffer,
    );
    expect(result.health.current).toBe(70);
    expect(result.outcome).toBeInstanceOf(DamageApplied);
  });

  it('supports environmental (non-entity) sources', () => {
    const result = resolveDamage(
      targetWith(fullHealth(100), 'blue'),
      15,
      environmentSource(),
      hostileWhenTeamsDiffer,
    );
    expect(result.health.current).toBe(85);
    expect(result.outcome).toBeInstanceOf(DamageApplied);
  });

  it('round-trips outcome variants through the schema union', () => {
    const result = resolveDamage(
      targetWith(fullHealth(40)),
      40,
      entitySource(attacker),
      alwaysHostile,
    );
    const encoded = Schema.encodeUnknownSync(DamageOutcome)(result.outcome);
    const decoded = Schema.decodeUnknownSync(DamageOutcome)(encoded);
    expect(decoded._tag).toBe('EntityDefeated');
  });
});
