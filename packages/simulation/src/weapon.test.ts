import { Option, Result, Schema } from 'effect';
import type { Uuid } from '@tileborne/core';
import { describe, expect, it } from 'vitest';

import { createFixedClock } from './clock.js';
import { DamageApplied, entitySource, resolveDamage, type DamageTarget } from './damage.js';
import { fullHealth } from './health.js';
import { alwaysHostile } from './hit-policy.js';
import { makeCombatEntityId, makeWeaponDefinitionId } from './ids.js';
import {
  InvalidWeaponDefinitionError,
  ReloadCompleted,
  ReloadOutcome,
  WeaponDefinition,
  WeaponFireOutcome,
  WeaponFired,
  WeaponState,
  advanceWeaponTick,
  beginReload,
  fireWeapon,
  initialWeaponState,
  makeWeaponDefinition,
} from './weapon.js';

const WEAPON_UUID = '550e8400-e29b-41d4-a716-446655440000' as Uuid;
const weaponId = makeWeaponDefinitionId(WEAPON_UUID);

const defineWeapon = (fields: {
  readonly damage?: number;
  readonly cooldownTicks?: number;
  readonly magazineSize?: number;
  readonly reloadTicks?: number;
}): WeaponDefinition =>
  Result.getOrElse(
    makeWeaponDefinition({
      id: weaponId,
      damage: fields.damage ?? 10,
      cooldownTicks: fields.cooldownTicks ?? 5,
      magazineSize: fields.magazineSize ?? 3,
      reloadTicks: fields.reloadTicks ?? 4,
    }),
    () => {
      throw new Error('test weapon definition must be valid');
    },
  );

describe('makeWeaponDefinition', () => {
  it('accepts a structurally valid definition', () => {
    const result = makeWeaponDefinition({
      id: weaponId,
      damage: 25,
      cooldownTicks: 8,
      magazineSize: 12,
      reloadTicks: 30,
    });
    expect(Result.isSuccess(result)).toBe(true);
  });

  it('rejects negative or non-finite damage', () => {
    expect(
      Result.isFailure(
        makeWeaponDefinition({
          id: weaponId,
          damage: -1,
          cooldownTicks: 0,
          magazineSize: 1,
          reloadTicks: 0,
        }),
      ),
    ).toBe(true);
    const nan = makeWeaponDefinition({
      id: weaponId,
      damage: Number.NaN,
      cooldownTicks: 0,
      magazineSize: 1,
      reloadTicks: 0,
    });
    expect(Result.isFailure(nan)).toBe(true);
    if (Result.isFailure(nan)) {
      expect(nan.failure).toBeInstanceOf(InvalidWeaponDefinitionError);
    }
  });

  it('rejects a non-positive magazine and non-integer timers', () => {
    expect(
      Result.isFailure(
        makeWeaponDefinition({
          id: weaponId,
          damage: 1,
          cooldownTicks: 0,
          magazineSize: 0,
          reloadTicks: 0,
        }),
      ),
    ).toBe(true);
    expect(
      Result.isFailure(
        makeWeaponDefinition({
          id: weaponId,
          damage: 1,
          cooldownTicks: 1.5,
          magazineSize: 1,
          reloadTicks: 0,
        }),
      ),
    ).toBe(true);
    expect(
      Result.isFailure(
        makeWeaponDefinition({
          id: weaponId,
          damage: 1,
          cooldownTicks: 0,
          magazineSize: 1,
          reloadTicks: -2,
        }),
      ),
    ).toBe(true);
  });

  it('round-trips a WeaponDefinition through schema encode/decode', () => {
    const definition = defineWeapon({
      damage: 25,
      cooldownTicks: 8,
      magazineSize: 12,
      reloadTicks: 30,
    });
    const encoded = Schema.encodeUnknownSync(WeaponDefinition)(definition);
    expect(encoded).toEqual({
      id: weaponId,
      damage: 25,
      cooldownTicks: 8,
      magazineSize: 12,
      reloadTicks: 30,
    });
    const decoded = Schema.decodeUnknownSync(WeaponDefinition)(encoded);
    expect(decoded.id).toBe(weaponId);
    expect(decoded.magazineSize).toBe(12);
  });
});

describe('initialWeaponState', () => {
  it('starts with a full magazine, ready to fire', () => {
    const state = initialWeaponState(defineWeapon({ magazineSize: 3 }));
    expect(state.ammoInMagazine).toBe(3);
    expect(state.cooldownRemaining).toBe(0);
    expect(state.reloadRemaining).toBe(0);
    expect(state.isReady).toBe(true);
    expect(state.isReloading).toBe(false);
  });

  it('round-trips a WeaponState through schema encode/decode', () => {
    const state = initialWeaponState(defineWeapon({ magazineSize: 5 }));
    const encoded = Schema.encodeUnknownSync(WeaponState)(state);
    expect(encoded).toEqual({
      ammoInMagazine: 5,
      cooldownRemaining: 0,
      reloadRemaining: 0,
      reloadAmount: 0,
    });
    const decoded = Schema.decodeUnknownSync(WeaponState)(encoded);
    expect(decoded.isReady).toBe(true);
  });
});

describe('fireWeapon — cooldown gating', () => {
  it('fires when ready and arms the post-shot cooldown', () => {
    const definition = defineWeapon({ damage: 25, cooldownTicks: 5, magazineSize: 3 });
    const { state, outcome } = fireWeapon(definition, initialWeaponState(definition));
    expect(outcome).toBeInstanceOf(WeaponFired);
    if (outcome._tag === 'WeaponFired') {
      expect(outcome.damage).toBe(25);
      expect(outcome.ammoRemaining).toBe(2);
      expect(outcome.weapon).toBe(weaponId);
    }
    expect(state.cooldownRemaining).toBe(5);
    expect(state.ammoInMagazine).toBe(2);
  });

  it('declines a second shot during cooldown without consuming ammo', () => {
    const definition = defineWeapon({ cooldownTicks: 5, magazineSize: 3 });
    const fired = fireWeapon(definition, initialWeaponState(definition));
    const blocked = fireWeapon(definition, fired.state);
    expect(blocked.outcome._tag).toBe('WeaponOnCooldown');
    if (blocked.outcome._tag === 'WeaponOnCooldown') {
      expect(blocked.outcome.cooldownRemaining).toBe(5);
    }
    expect(blocked.state.ammoInMagazine).toBe(2);
    expect(blocked.state).toBe(fired.state);
  });

  it('can fire again once the cooldown ticks down to 0', () => {
    const definition = defineWeapon({ cooldownTicks: 3, magazineSize: 3 });
    let { state } = fireWeapon(definition, initialWeaponState(definition));
    for (let i = 0; i < 3; i += 1) {
      state = advanceWeaponTick(definition, state).state;
    }
    expect(state.cooldownRemaining).toBe(0);
    const again = fireWeapon(definition, state);
    expect(again.outcome._tag).toBe('WeaponFired');
    expect(again.state.ammoInMagazine).toBe(1);
  });
});

describe('fireWeapon — zero cooldown (rapid fire)', () => {
  it('fires every call until the magazine empties', () => {
    const definition = defineWeapon({ cooldownTicks: 0, magazineSize: 3 });
    let state = initialWeaponState(definition);
    const tags: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const result = fireWeapon(definition, state);
      tags.push(result.outcome._tag);
      state = result.state;
    }
    expect(tags).toEqual(['WeaponFired', 'WeaponFired', 'WeaponFired', 'WeaponOutOfAmmo']);
    expect(state.ammoInMagazine).toBe(0);
  });
});

describe('fireWeapon — ammo depletion', () => {
  it('reports WeaponOutOfAmmo once the magazine is empty', () => {
    const definition = defineWeapon({ cooldownTicks: 0, magazineSize: 1 });
    const first = fireWeapon(definition, initialWeaponState(definition));
    expect(first.outcome._tag).toBe('WeaponFired');
    const empty = fireWeapon(definition, first.state);
    expect(empty.outcome._tag).toBe('WeaponOutOfAmmo');
    if (empty.outcome._tag === 'WeaponOutOfAmmo') {
      expect(empty.outcome.weapon).toBe(weaponId);
    }
    expect(empty.state).toBe(first.state);
  });

  it('single-shot weapon must reload between shots', () => {
    const definition = defineWeapon({ cooldownTicks: 0, magazineSize: 1, reloadTicks: 2 });
    const fired = fireWeapon(definition, initialWeaponState(definition));
    expect(fired.state.ammoInMagazine).toBe(0);
    const reload = beginReload(definition, fired.state, 5);
    expect(reload.outcome._tag).toBe('ReloadStarted');
    expect(reload.ammoLoaded).toBe(1);
  });
});

describe('beginReload + advanceWeaponTick — reload timing', () => {
  it('loads rounds only when the reload timer completes', () => {
    const definition = defineWeapon({ cooldownTicks: 0, magazineSize: 3, reloadTicks: 2 });
    let state = fireWeapon(definition, initialWeaponState(definition)).state;
    state = fireWeapon(definition, state).state;
    expect(state.ammoInMagazine).toBe(1);

    const reload = beginReload(definition, state, 10);
    expect(reload.outcome._tag).toBe('ReloadStarted');
    expect(reload.ammoLoaded).toBe(2);
    state = reload.state;
    expect(state.isReloading).toBe(true);

    const tick1 = advanceWeaponTick(definition, state);
    expect(Option.isNone(tick1.outcome)).toBe(true);
    expect(tick1.state.ammoInMagazine).toBe(1);
    state = tick1.state;

    const tick2 = advanceWeaponTick(definition, state);
    expect(Option.isSome(tick2.outcome)).toBe(true);
    if (Option.isSome(tick2.outcome)) {
      expect(tick2.outcome.value).toBeInstanceOf(ReloadCompleted);
      expect(tick2.outcome.value.ammoLoaded).toBe(2);
      expect(tick2.outcome.value.ammoRemaining).toBe(3);
    }
    expect(tick2.state.ammoInMagazine).toBe(3);
    expect(tick2.state.isReloading).toBe(false);
  });

  it('blocks firing while reloading', () => {
    const definition = defineWeapon({ cooldownTicks: 0, magazineSize: 2, reloadTicks: 3 });
    let state = fireWeapon(definition, initialWeaponState(definition)).state;
    state = beginReload(definition, state, 10).state;
    const blocked = fireWeapon(definition, state);
    expect(blocked.outcome._tag).toBe('WeaponReloading');
    if (blocked.outcome._tag === 'WeaponReloading') {
      expect(blocked.outcome.reloadRemaining).toBe(3);
    }
  });

  it('completes a zero-tick reload instantly', () => {
    const definition = defineWeapon({ cooldownTicks: 0, magazineSize: 2, reloadTicks: 0 });
    const state = fireWeapon(definition, initialWeaponState(definition)).state;
    const reload = beginReload(definition, state, 10);
    expect(reload.outcome._tag).toBe('ReloadCompleted');
    expect(reload.state.ammoInMagazine).toBe(2);
    expect(reload.state.isReloading).toBe(false);
  });

  it('pulls only what the reserve allows (inventory owns the reserve)', () => {
    const definition = defineWeapon({ cooldownTicks: 0, magazineSize: 5, reloadTicks: 1 });
    let state = initialWeaponState(definition);
    for (let i = 0; i < 4; i += 1) {
      state = fireWeapon(definition, state).state;
    }
    expect(state.ammoInMagazine).toBe(1);
    const reload = beginReload(definition, state, 2);
    expect(reload.ammoLoaded).toBe(2);
    const completed = advanceWeaponTick(definition, reload.state);
    expect(completed.state.ammoInMagazine).toBe(3);
  });

  it('ignores reload when full, already reloading, or reserve empty', () => {
    const definition = defineWeapon({ cooldownTicks: 0, magazineSize: 2, reloadTicks: 2 });
    const full = beginReload(definition, initialWeaponState(definition), 10);
    expect(full.outcome._tag).toBe('ReloadIgnored');
    if (full.outcome._tag === 'ReloadIgnored') {
      expect(full.outcome.reason).toBe('already-full');
    }

    const fired = fireWeapon(definition, initialWeaponState(definition)).state;
    const noReserve = beginReload(definition, fired, 0);
    expect(noReserve.outcome._tag).toBe('ReloadIgnored');
    if (noReserve.outcome._tag === 'ReloadIgnored') {
      expect(noReserve.outcome.reason).toBe('no-reserve');
    }

    const reloading = beginReload(definition, fired, 10).state;
    const twice = beginReload(definition, reloading, 10);
    expect(twice.outcome._tag).toBe('ReloadIgnored');
    if (twice.outcome._tag === 'ReloadIgnored') {
      expect(twice.outcome.reason).toBe('already-reloading');
    }
    expect(twice.ammoLoaded).toBe(0);
  });
});

describe('advanceWeaponTick — boundaries', () => {
  it('advancing by multiple ticks crosses cooldown and reload boundaries at once', () => {
    const definition = defineWeapon({ cooldownTicks: 5, magazineSize: 3, reloadTicks: 4 });
    const fired = fireWeapon(definition, initialWeaponState(definition));
    const reload = beginReload(definition, fired.state, 10);
    const jumped = advanceWeaponTick(definition, reload.state, 10);
    expect(jumped.state.cooldownRemaining).toBe(0);
    expect(Option.isSome(jumped.outcome)).toBe(true);
    expect(jumped.state.ammoInMagazine).toBe(3);
  });

  it('is a no-op (same reference) when nothing is in flight', () => {
    const definition = defineWeapon({ cooldownTicks: 0, magazineSize: 3 });
    const state = initialWeaponState(definition);
    const ticked = advanceWeaponTick(definition, state, 3);
    expect(ticked.state).toBe(state);
    expect(Option.isNone(ticked.outcome)).toBe(true);
  });

  it('rejects negative or non-integer tick counts', () => {
    const definition = defineWeapon({});
    const state = initialWeaponState(definition);
    expect(() => advanceWeaponTick(definition, state, -1)).toThrow(RangeError);
    expect(() => advanceWeaponTick(definition, state, 1.5)).toThrow(RangeError);
  });
});

describe('determinism + damage hand-off', () => {
  it('produces an identical outcome tag stream for a fixed clock-driven schedule', () => {
    const definition = defineWeapon({ cooldownTicks: 2, magazineSize: 3, reloadTicks: 3 });

    const run = (): string[] => {
      const clock = createFixedClock({ dtMs: 50 });
      let state = initialWeaponState(definition);
      const tags: string[] = [];
      for (let i = 0; i < 12; i += 1) {
        const fired = fireWeapon(definition, state);
        tags.push(`t${clock.tick()}:${fired.outcome._tag}`);
        state = fired.state;
        if (state.ammoInMagazine === 0 && !state.isReloading) {
          state = beginReload(definition, state, 10).state;
        }
        state = advanceWeaponTick(definition, state).state;
        clock.advance();
      }
      return tags;
    };

    expect(run()).toEqual(run());
  });

  it('hands the fired damage to resolveDamage', () => {
    const definition = defineWeapon({ damage: 25, cooldownTicks: 0, magazineSize: 1 });
    const fired = fireWeapon(definition, initialWeaponState(definition));
    expect(fired.outcome._tag).toBe('WeaponFired');
    if (fired.outcome._tag !== 'WeaponFired') {
      return;
    }

    const target: DamageTarget = {
      entity: makeCombatEntityId(2),
      team: Option.none(),
      health: fullHealth(100),
    };
    const resolution = resolveDamage(
      target,
      fired.outcome.damage,
      entitySource(makeCombatEntityId(1)),
      alwaysHostile,
    );
    expect(resolution.health.current).toBe(75);
    expect(resolution.outcome).toBeInstanceOf(DamageApplied);
  });

  it('round-trips fire and reload outcome variants through their schema unions', () => {
    const definition = defineWeapon({ cooldownTicks: 0, magazineSize: 1, reloadTicks: 0 });
    const fired = fireWeapon(definition, initialWeaponState(definition));
    const fireEncoded = Schema.encodeUnknownSync(WeaponFireOutcome)(fired.outcome);
    expect(Schema.decodeUnknownSync(WeaponFireOutcome)(fireEncoded)._tag).toBe('WeaponFired');

    const reload = beginReload(definition, fired.state, 5);
    const reloadEncoded = Schema.encodeUnknownSync(ReloadOutcome)(reload.outcome);
    expect(Schema.decodeUnknownSync(ReloadOutcome)(reloadEncoded)._tag).toBe('ReloadCompleted');
  });
});
