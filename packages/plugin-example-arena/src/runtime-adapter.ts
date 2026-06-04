import { advanceWeaponTick, fireWeapon, initialWeaponState, type WeaponState } from "@tileborne/simulation";

import { ARENA_PLUGIN_ID } from "./constants.js";
import type { ArenaRuntimeHost, ArenaRuntimePlugin } from "./types/runtime-plugin.js";
import { resolveArenaWeapon } from "./weapon-catalog.js";

/**
 * Skeletal runtime adapter for the example arena mode. It reuses
 * `@tileborne/simulation`'s weapon firing core (the same engine code BR drives)
 * to advance a melee weapon's cadence each tick and swing it on attack input,
 * while integrating a trivial top-down position. It is intentionally tiny — the
 * purpose is to show the engine runtime contract is genre-neutral, not to ship a
 * playable game. No engine package is touched.
 */
export const createRuntimeAdapter = (host: ArenaRuntimeHost): ArenaRuntimePlugin => {
  const weapon = resolveArenaWeapon();
  let weaponState: WeaponState = initialWeaponState(weapon);
  let position = { x: 0, y: 0 };

  return {
    id: ARENA_PLUGIN_ID,
    onTick(dt) {
      // Engine-owned firing cadence: decay cooldown/reload timers each tick.
      weaponState = advanceWeaponTick(weapon, weaponState).state;
      // No inventory system in this skeleton; top the magazine back up so the
      // demo can keep swinging once the post-swing cooldown clears.
      if (weaponState.ammoInMagazine <= 0 && weaponState.cooldownRemaining <= 0) {
        weaponState = initialWeaponState(weapon);
      }

      const input = host.getPlayerInput?.();
      if (input === undefined) {
        return;
      }

      position = { x: position.x + input.moveX * dt, y: position.y + input.moveY * dt };

      if (input.attack) {
        // Fire through the engine's neutral weapon core (gates on cooldown/ammo).
        weaponState = fireWeapon(weapon, weaponState).state;
      }
    },
  };
};
