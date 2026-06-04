import {
  WeaponDefinition,
  WeaponDefinitionId,
  makeWeaponDefinition,
} from "@tileborne/simulation";
import { Option, Result, Schema } from "effect";

/**
 * The arena mode's single melee weapon as plain DATA (the manifest
 * `runtime.weaponCatalogs` slot shape). The engine owns the `WeaponDefinition` +
 * `DamageDelivery` SHAPE (`@tileborne/simulation`); this plugin supplies only the
 * balance numbers, decoded + validated by `decodeWeaponCatalog` in
 * `@tileborne/plugin-api`.
 *
 * Distinct from BR's projectile weapon: this is a short-range `MeleeDelivery`
 * (a sword swing), proving the same neutral weapon registry serves a melee genre
 * with no engine edits.
 */

export const ARENA_WEAPON_ID = "weapon:c1111111-1111-4111-8111-111111111111";
export const ARENA_WEAPON_CATALOG_CONTRIBUTION_ID = "arena-weapon-catalog";
export const ARENA_WEAPON_CATALOG_SCHEMA_VERSION = 1;

/** Quarter-turn melee arc in radians (≈ π/2), authored as a JSON literal. */
const MELEE_ARC = 1.5708;

const ARENA_WEAPON_DEFINITION_ID = Schema.decodeUnknownSync(WeaponDefinitionId)(ARENA_WEAPON_ID);

export const buildArenaWeaponCatalogData = (): {
  readonly schemaVersion: number;
  readonly weapons: readonly unknown[];
} => ({
  schemaVersion: ARENA_WEAPON_CATALOG_SCHEMA_VERSION,
  weapons: [
    {
      weapon: {
        id: ARENA_WEAPON_ID,
        damage: 15,
        cooldownTicks: 12,
        magazineSize: 1,
        reloadTicks: 0,
      },
      delivery: {
        _tag: "MeleeDelivery",
        damage: 15,
        range: 28,
        arc: MELEE_ARC,
        knockback: 4,
      },
      appliesStatus: [],
    },
  ],
});

/** A weapon entry failed to build/validate against the engine schema. */
export class ArenaWeaponCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArenaWeaponCatalogError";
  }
}

/**
 * Resolve the arena melee weapon into a validated `@tileborne/simulation`
 * `WeaponDefinition` the runtime adapter drives the engine's firing core with.
 * Worker-safe: validates against the same engine schema the manifest slot uses,
 * but never imports `@tileborne/plugin-api` (which pulls `node:fs`).
 */
export const resolveArenaWeapon = (): WeaponDefinition => {
  const raw = buildArenaWeaponCatalogData().weapons[0] as { readonly weapon?: unknown };
  const decoded = Schema.decodeUnknownOption(WeaponDefinition)(raw.weapon);
  if (Option.isNone(decoded)) {
    throw new ArenaWeaponCatalogError("arena weapon entry is not a valid WeaponDefinition");
  }
  const validated = makeWeaponDefinition(decoded.value);
  if (Result.isFailure(validated)) {
    throw new ArenaWeaponCatalogError(validated.failure.message);
  }
  if (validated.success.id !== ARENA_WEAPON_DEFINITION_ID) {
    throw new ArenaWeaponCatalogError("arena weapon id did not round-trip");
  }
  return validated.success;
};
