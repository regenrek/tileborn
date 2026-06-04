import {
  DamageDelivery,
  makeWeaponDefinition,
  StatusEffectId,
  validateDamageDelivery,
  WeaponDefinition,
  type WeaponDefinitionId,
} from "@tileborne/simulation";
import { Option, Result, Schema } from "effect";

/**
 * One neutral weapon entry of a contributed weapon-content pack (ADR-0018
 * Slice 5). It pairs a `WeaponDefinition` (firing cadence + per-shot damage)
 * with the `DamageDelivery` family that describes *how* the shot reaches its
 * target, and an optional set of status-effect ids the weapon applies on hit
 * (the P0 status hook — ids only, no definition runtime). Every field is a
 * `@tileborne/simulation` schema: the engine owns the shape, the plugin supplies
 * the balance numbers.
 */
export class WeaponCatalogEntry extends Schema.Class<WeaponCatalogEntry>("WeaponCatalogEntry")({
  weapon: WeaponDefinition,
  delivery: DamageDelivery,
  appliesStatus: Schema.OptionFromUndefinedOr(Schema.Array(StatusEffectId)),
}) {}

/** A contributed weapon-content pack: a versioned list of weapon entries. */
export class WeaponCatalog extends Schema.Class<WeaponCatalog>("WeaponCatalog")({
  schemaVersion: Schema.Int,
  weapons: Schema.Array(WeaponCatalogEntry),
}) {}

/** A contributed weapon catalog failed to decode against the simulation schemas. */
export class InvalidWeaponCatalogContributionError extends Schema.TaggedErrorClass<InvalidWeaponCatalogContributionError>()(
  "InvalidWeaponCatalogContributionError",
  {
    contributionId: Schema.String,
    message: Schema.String,
  },
) {}

/** Two contributed weapon catalogs registered the same weapon-definition id. */
export class DuplicateWeaponDefinitionError extends Schema.TaggedErrorClass<DuplicateWeaponDefinitionError>()(
  "DuplicateWeaponDefinitionError",
  {
    id: Schema.String,
    message: Schema.String,
  },
) {}

/** A contributed weapon catalog failed structural delivery validation. */
export class WeaponCatalogContributionValidationError extends Schema.TaggedErrorClass<WeaponCatalogContributionValidationError>()(
  "WeaponCatalogContributionValidationError",
  {
    contributionId: Schema.String,
    issues: Schema.Array(Schema.String),
  },
) {}

export type WeaponCatalogRegistryError =
  | InvalidWeaponCatalogContributionError
  | DuplicateWeaponDefinitionError
  | WeaponCatalogContributionValidationError;

/** A single contributed weapon catalog tagged with the contribution that supplied it. */
export interface WeaponCatalogContributionInput {
  readonly contributionId: string;
  readonly catalog: WeaponCatalog;
}

/** The merged, resolved weapon catalog across all contributions. */
export interface MergedWeaponCatalog {
  readonly weapons: readonly WeaponCatalogEntry[];
  /** Weapon-entry lookup by definition id (post-merge). */
  readonly byId: ReadonlyMap<WeaponDefinitionId, WeaponCatalogEntry>;
}

/** Decode raw contribution `data` into a typed `WeaponCatalog`. */
export const decodeWeaponCatalog = (
  contributionId: string,
  data: unknown,
): Result.Result<WeaponCatalog, InvalidWeaponCatalogContributionError> => {
  const decoded = Schema.decodeUnknownOption(WeaponCatalog)(data);
  return Option.match(decoded, {
    onNone: () =>
      Result.fail(
        new InvalidWeaponCatalogContributionError({
          contributionId,
          message: `contribution ${contributionId} is not a valid WeaponCatalog`,
        }),
      ),
    onSome: (catalog) => Result.succeed(catalog),
  });
};

/**
 * Merge contributed weapon catalogs into a single resolved registry. Each entry
 * is structurally validated against the simulation `WeaponDefinition` invariants
 * (via `makeWeaponDefinition`) and `DamageDelivery` rules (never balance ranges);
 * weapon-definition ids must be unique across all packs (plugin-neutral duplicate
 * detection, mirroring ADR-0019's catalog merge).
 */
export const mergeWeaponCatalogs = (
  contributions: readonly WeaponCatalogContributionInput[],
): Result.Result<MergedWeaponCatalog, WeaponCatalogRegistryError> => {
  const byId = new Map<WeaponDefinitionId, WeaponCatalogEntry>();
  const weapons: WeaponCatalogEntry[] = [];

  for (const { contributionId, catalog } of contributions) {
    const issues: string[] = [];
    for (const entry of catalog.weapons) {
      const weapon = makeWeaponDefinition(entry.weapon);
      if (Result.isFailure(weapon)) {
        issues.push(`${entry.weapon.id}: ${weapon.failure.message}`);
      }
      const validated = validateDamageDelivery(entry.delivery);
      if (Result.isFailure(validated)) {
        issues.push(`${entry.weapon.id}: ${validated.failure.message}`);
      }
    }
    if (issues.length > 0) {
      return Result.fail(
        new WeaponCatalogContributionValidationError({ contributionId, issues }),
      );
    }

    for (const entry of catalog.weapons) {
      if (byId.has(entry.weapon.id)) {
        return Result.fail(
          new DuplicateWeaponDefinitionError({
            id: entry.weapon.id,
            message: `weapon ${entry.weapon.id} is registered by more than one catalog`,
          }),
        );
      }
      byId.set(entry.weapon.id, entry);
      weapons.push(entry);
    }
  }

  return Result.succeed({ weapons, byId });
};
