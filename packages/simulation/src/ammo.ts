import { Schema } from 'effect';

import { AmmoKind } from './ids.js';

/** One reserve stack: how many rounds of an open {@link AmmoKind} are held. */
export class AmmoStack extends Schema.Class<AmmoStack>('AmmoStack')({
  ammoKind: AmmoKind,
  amount: Schema.Int,
}) {}

/**
 * The inventory-owned ammunition reserve (ADR-0018 inventory/loot addendum).
 * The weapon runtime (`weapon.ts`) owns the magazine/reload state and only
 * *reports* how many rounds a reload pulled (`WeaponReloadResult.ammoLoaded`);
 * this reserve is the counter those rounds are pulled from — the two never
 * duplicate each other's state.
 *
 * Stacks are kept sorted by `ammoKind` (code-unit order) so the reserve has a
 * single canonical, replay-stable representation.
 */
export class AmmoReserve extends Schema.Class<AmmoReserve>('AmmoReserve')({
  stacks: Schema.Array(AmmoStack),
}) {}

/** A reserve holding no ammunition. */
export const emptyAmmoReserve = (): AmmoReserve => new AmmoReserve({ stacks: [] });

/** Rounds of `kind` currently held (`0` when no stack exists). */
export const ammoAmount = (reserve: AmmoReserve, kind: AmmoKind): number =>
  reserve.stacks.find((stack) => stack.ammoKind === kind)?.amount ?? 0;

const compareStacks = (a: AmmoStack, b: AmmoStack): number =>
  a.ammoKind < b.ammoKind ? -1 : a.ammoKind > b.ammoKind ? 1 : 0;

const withStackAmount = (reserve: AmmoReserve, kind: AmmoKind, amount: number): AmmoReserve => {
  // Empty stacks are removed so equal reserves are structurally equal.
  const others = reserve.stacks.filter((stack) => stack.ammoKind !== kind);
  const stacks = amount > 0 ? [...others, new AmmoStack({ ammoKind: kind, amount })] : others;
  return new AmmoReserve({ stacks: [...stacks].sort(compareStacks) });
};

/**
 * Add rounds to a reserve stack. Pure and total: a non-positive or non-finite
 * `amount` is a no-op (the unchanged reserve is returned); fractions are
 * floored so the reserve only ever holds integers.
 */
export const addAmmo = (reserve: AmmoReserve, kind: AmmoKind, amount: number): AmmoReserve => {
  const added = Number.isFinite(amount) ? Math.floor(amount) : 0;
  if (added <= 0) {
    return reserve;
  }
  return withStackAmount(reserve, kind, ammoAmount(reserve, kind) + added);
};

/** New {@link AmmoReserve} plus how many rounds were actually taken. */
export interface AmmoConsumeResult {
  readonly reserve: AmmoReserve;
  readonly consumed: number;
}

/**
 * Take up to `requested` rounds of `kind` from the reserve, clamped to what is
 * held. The returned `consumed` is what the caller (e.g. a `beginReload`
 * driver honoring `ammoLoaded`) actually received; a non-positive or
 * non-finite request consumes nothing.
 */
export const consumeAmmo = (
  reserve: AmmoReserve,
  kind: AmmoKind,
  requested: number,
): AmmoConsumeResult => {
  const wanted = Number.isFinite(requested) ? Math.floor(requested) : 0;
  if (wanted <= 0) {
    return { reserve, consumed: 0 };
  }
  const held = ammoAmount(reserve, kind);
  const consumed = Math.min(held, wanted);
  if (consumed <= 0) {
    return { reserve, consumed: 0 };
  }
  return { reserve: withStackAmount(reserve, kind, held - consumed), consumed };
};
