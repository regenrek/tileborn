import {
  DamageDelivery,
  ProjectileDelivery,
  WeaponDefinition,
  WeaponDefinitionId,
  makeWeaponDefinition,
  validateDamageDelivery,
} from "@tileborne/simulation";
import { Option, Result, Schema } from "effect";

import type { ResolvedBattleRoyaleConfig } from "./battle-royale-config.js";
import { BR_PRIMARY_WEAPON_ID } from "./constants.js";

export { BR_PRIMARY_WEAPON_ID } from "./constants.js";

/** Contribution id for BR's weapon-content pack registered via the typed slot. */
export const BR_WEAPON_CATALOG_CONTRIBUTION_ID = "br-weapon-catalog";

/** Schema version of the contributed weapon-content pack. */
export const BR_WEAPON_CATALOG_SCHEMA_VERSION = 1;

const BR_WEAPON_DEFINITION_ID = Schema.decodeUnknownSync(WeaponDefinitionId)(BR_PRIMARY_WEAPON_ID);

/** BR projectile travel speed in the engine's native world-units **per tick**. */
const perTickSpeed = (config: ResolvedBattleRoyaleConfig): number =>
  config.projectile.speed / config.tickRate;

/**
 * Build BR's weapon-content pack as plain neutral DATA (ADR-0018 c-bulu: plugins
 * inject balance NUMBERS as content data). This is the wire/JSON shape declared
 * in the plugin manifest's typed `weaponCatalogs` slot and decoded/validated by
 * `@tileborne/plugin-api`'s weapon-catalog registry (exercised in tests). The
 * numbers come straight from the resolved BR balance config — plugin-owned; the
 * engine owns only the `WeaponDefinition` + `DamageDelivery` *shape*.
 *
 * `ProjectileDelivery.speed` is expressed in world-units **per tick**
 * (`unitsPerSecond / tickRate`), so the neutral projectile lifecycle advances one
 * tick at a time exactly as BR's per-`dt` integration did. The delivery hit radius
 * is BR's combined player+projectile collision radius (the threshold BR's
 * `findHitPlayer` swept), since the neutral resolver measures the target's center
 * distance to the projectile path.
 */
export const buildBattleRoyaleWeaponCatalogData = (
  config: ResolvedBattleRoyaleConfig,
): {
  readonly schemaVersion: number;
  readonly weapons: readonly unknown[];
} => ({
  schemaVersion: BR_WEAPON_CATALOG_SCHEMA_VERSION,
  weapons: [
    {
      weapon: {
        id: BR_PRIMARY_WEAPON_ID,
        damage: config.projectile.damage,
        cooldownTicks: config.projectile.shootCooldownTicks,
        magazineSize: config.projectile.magazineSize,
        reloadTicks: config.projectile.reloadTicks,
      },
      delivery: {
        _tag: "ProjectileDelivery",
        damage: config.projectile.damage,
        speed: perTickSpeed(config),
        ttlTicks: config.projectile.ttlTicks,
        radius: config.movement.radius + config.projectile.radius,
        falloff: { _tag: "NoFalloff" },
        knockback: 0,
      },
      // BR applies no on-hit status effects (the P0 status hook is unused here);
      // an explicit empty list is the JSON-authorable form of "no status".
      appliesStatus: [],
    },
  ],
});

/** A contributed weapon catalog failed to build/validate against the engine schemas. */
export class BattleRoyaleWeaponCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BattleRoyaleWeaponCatalogError";
  }
}

/** BR's resolved primary weapon: the neutral firing definition + its delivery family. */
export interface BattleRoyaleWeaponEntry {
  readonly weapon: WeaponDefinition;
  readonly delivery: ProjectileDelivery;
}

/**
 * Decode one weapon entry's `WeaponDefinition` against the engine schema and
 * assert the same structural invariants `makeWeaponDefinition` enforces. Throws
 * a {@link BattleRoyaleWeaponCatalogError} so a balance/shape mistake fails loudly.
 */
const decodeWeapon = (raw: unknown): WeaponDefinition => {
  const decoded = Schema.decodeUnknownOption(WeaponDefinition)(raw);
  if (Option.isNone(decoded)) {
    throw new BattleRoyaleWeaponCatalogError("weapon entry is not a valid WeaponDefinition");
  }
  const validated = makeWeaponDefinition(decoded.value);
  if (Result.isFailure(validated)) {
    throw new BattleRoyaleWeaponCatalogError(validated.failure.message);
  }
  return validated.success;
};

/**
 * Decode one weapon entry's `DamageDelivery` against the engine union and assert
 * the same structural rules `validateDamageDelivery` enforces.
 */
const decodeDelivery = (raw: unknown): DamageDelivery => {
  const decoded = Schema.decodeUnknownOption(DamageDelivery)(raw);
  if (Option.isNone(decoded)) {
    throw new BattleRoyaleWeaponCatalogError("delivery entry is not a valid DamageDelivery");
  }
  const validated = validateDamageDelivery(decoded.value);
  if (Result.isFailure(validated)) {
    throw new BattleRoyaleWeaponCatalogError(validated.failure.message);
  }
  return validated.success;
};

/**
 * Decode + merge BR's weapon-content pack (the typed `weaponCatalogs` slot data
 * from {@link buildBattleRoyaleWeaponCatalogData}) into engine instances keyed by
 * weapon-definition id. This is the worker-safe twin of `@tileborne/plugin-api`'s
 * `decodeWeaponCatalog` / `mergeWeaponCatalogs`: it validates against the same
 * `@tileborne/simulation` schemas the typed slot uses, but never imports
 * `@tileborne/plugin-api` — whose package index transitively pulls `node:fs`
 * (via `@tileborne/asset-pipeline`) and so cannot enter the browser-worker
 * runtime bundle. The runtime and the manifest slot therefore decode the SAME
 * data through the same engine validators, making the catalog data the single
 * source of BR's weapon definition (ADR-0018 §7).
 */
const decodeBattleRoyaleWeaponCatalog = (data: {
  readonly schemaVersion: number;
  readonly weapons: readonly unknown[];
}): ReadonlyMap<WeaponDefinitionId, BattleRoyaleWeaponEntry> => {
  const byId = new Map<WeaponDefinitionId, BattleRoyaleWeaponEntry>();
  for (const raw of data.weapons) {
    const entry = raw as { readonly weapon?: unknown; readonly delivery?: unknown };
    const weapon = decodeWeapon(entry.weapon);
    const delivery = decodeDelivery(entry.delivery);
    if (delivery._tag !== "ProjectileDelivery") {
      throw new BattleRoyaleWeaponCatalogError(
        `weapon ${weapon.id} delivery must be a ProjectileDelivery (got ${delivery._tag})`,
      );
    }
    if (byId.has(weapon.id)) {
      throw new BattleRoyaleWeaponCatalogError(`weapon ${weapon.id} is registered more than once`);
    }
    byId.set(weapon.id, { weapon, delivery });
  }
  return byId;
};

/**
 * Resolve BR's primary weapon into worker-safe `@tileborne/simulation` instances
 * the runtime drives the neutral combat systems with. The runtime now CONSUMES
 * the typed `weaponCatalogs` slot: it builds the slot's wire data via
 * {@link buildBattleRoyaleWeaponCatalogData}, decodes + validates it through the
 * engine schemas ({@link decodeBattleRoyaleWeaponCatalog}), and looks the primary
 * weapon up by id — so the same catalog data backs both the manifest slot and
 * the runtime (ADR-0018 §7). The decode path is worker-safe (only
 * `@tileborne/simulation`); a balance mistake fails loudly at resolve time.
 */
export const resolveBattleRoyaleWeaponEntry = (
  config: ResolvedBattleRoyaleConfig,
): BattleRoyaleWeaponEntry => {
  const byId = decodeBattleRoyaleWeaponCatalog(buildBattleRoyaleWeaponCatalogData(config));
  const entry = byId.get(BR_WEAPON_DEFINITION_ID);
  if (!entry) {
    throw new BattleRoyaleWeaponCatalogError(
      `weapon catalog is missing BR's primary weapon ${BR_PRIMARY_WEAPON_ID}`,
    );
  }
  return entry;
};
