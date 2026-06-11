import type { GrantRef } from '@tileborne/core';

import { addAmmo, ammoAmount, type AmmoReserve } from './ammo.js';
import type { Vec2Like } from './geometry.js';
import { makeInventoryItemId, type AmmoKind } from './ids.js';
import {
  AmmoGranted,
  WeaponGranted,
  grantItem,
  type InventoryOverflowPolicy,
  type InventoryResult,
  type InventoryState,
} from './inventory.js';

/**
 * The state a grant applies against: the capacity-bounded item inventory plus
 * the ammunition reserve (ADR-0018 inventory/loot addendum, Slice 2). Both are
 * owned by the caller per entity; {@link applyGrantRef} returns new instances
 * and never mutates the input.
 */
export interface GrantTargetState {
  readonly inventory: InventoryState;
  readonly ammo: AmmoReserve;
}

/** Caller-resolved ammunition a grant confers (plugin content data). */
export interface AmmoGrant {
  readonly kind: AmmoKind;
  readonly amount: number;
}

/**
 * Caller-resolved interpretation of a single catalog `GrantRef` (the runtime
 * half of the ADR-0023 §C pickup-grants join). The catalog carries only the
 * *reference* (item/weapon by id); everything content-shaped — overflow
 * policy, drop position, stack quantity, conferred ammo — is plugin data the
 * caller resolves and passes here. The engine has no defaults beyond the
 * neutral identity quantity of one.
 */
export interface GrantResolution {
  /** Overflow behavior when a granted item meets a full inventory. */
  readonly policy: InventoryOverflowPolicy;
  /** Where an overflow-evicted item materializes as a world pickup. */
  readonly dropAt?: Vec2Like;
  /**
   * Copies an `item-grant` stores (integer, floored; non-positive grants
   * nothing). Absent ⇒ one copy. Ignored by `weapon-grant` and by an
   * ammo-routed grant.
   */
  readonly quantity?: number;
  /**
   * Routes the grant into the ammo reserve: an `item-grant` with `ammo` is an
   * ammo-bearing item (the BR ammo-box shape) and adds to the reserve instead
   * of occupying a slot; a `weapon-grant` with `ammo` confers starting reserve
   * rounds alongside the weapon.
   */
  readonly ammo?: AmmoGrant;
}

/** New {@link GrantTargetState} plus the ordered result values of one grant. */
export interface GrantApplication {
  readonly state: GrantTargetState;
  readonly results: readonly InventoryResult[];
}

const resolvedQuantity = (quantity: number | undefined): number => {
  if (quantity === undefined || !Number.isFinite(quantity)) {
    return 1;
  }
  return Math.max(0, Math.floor(quantity));
};

const applyAmmoGrant = (state: GrantTargetState, grant: AmmoGrant): GrantApplication => {
  const reserve = addAmmo(state.ammo, grant.kind, grant.amount);
  const total = ammoAmount(reserve, grant.kind);
  const added = total - ammoAmount(state.ammo, grant.kind);
  if (added <= 0) {
    return { state, results: [] };
  }
  return {
    state: { inventory: state.inventory, ammo: reserve },
    results: [new AmmoGranted({ ammoKind: grant.kind, amount: added, total })],
  };
};

/**
 * Interpret a catalog `GrantRef` against an entity's inventory + ammo reserve
 * (ADR-0018 inventory/loot addendum, Slice 2 — the runtime half of ADR-0023
 * §C). Pure and total:
 *
 * - `item-grant` (default): the referenced `ItemDefinitionId` enters the
 *   inventory as an open {@link InventoryItemId}, once per resolved
 *   `quantity`, threading state through `grantItem` so overflow
 *   eviction/rejection follows the explicit policy per copy.
 * - `item-grant` with `resolution.ammo`: an ammo-bearing item — rounds enter
 *   the reserve ({@link AmmoGranted}); no slot is occupied.
 * - `weapon-grant`: emits {@link WeaponGranted} for the caller's weapon system
 *   (the simulation never mints `WeaponState` here — that seam stays with the
 *   caller via `initialWeaponState`), plus any conferred reserve ammo.
 */
export const applyGrantRef = (
  state: GrantTargetState,
  grant: GrantRef,
  resolution: GrantResolution,
): GrantApplication => {
  switch (grant._tag) {
    case 'item-grant': {
      if (resolution.ammo !== undefined) {
        return applyAmmoGrant(state, resolution.ammo);
      }
      const item = makeInventoryItemId(grant.itemId);
      const copies = resolvedQuantity(resolution.quantity);
      let inventory = state.inventory;
      const results: InventoryResult[] = [];
      for (let copy = 0; copy < copies; copy += 1) {
        const granted = grantItem(inventory, item, {
          policy: resolution.policy,
          ...(resolution.dropAt === undefined ? {} : { dropAt: resolution.dropAt }),
        });
        inventory = granted.state;
        results.push(...granted.results);
      }
      return { state: { inventory, ammo: state.ammo }, results };
    }
    case 'weapon-grant': {
      const granted = new WeaponGranted({ weapon: grant.weaponId });
      if (resolution.ammo === undefined) {
        return { state, results: [granted] };
      }
      const withAmmo = applyAmmoGrant(state, resolution.ammo);
      return { state: withAmmo.state, results: [granted, ...withAmmo.results] };
    }
  }
};
