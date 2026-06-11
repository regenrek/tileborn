import {
  GameObjectCatalog,
  validateCatalog,
  type GameObjectType,
  type GameObjectTypeId,
  type ItemDefinition,
  type LootTable,
} from "@tileborne/core";
import { Option, Result, Schema } from "effect";

/** A contributed catalog failed to decode against the core schema. */
export class InvalidCatalogContributionError extends Schema.TaggedErrorClass<InvalidCatalogContributionError>()(
  "InvalidCatalogContributionError",
  {
    contributionId: Schema.String,
    message: Schema.String,
  },
) {}

/** Two contributed catalogs registered the same object-type id. */
export class DuplicateCatalogObjectTypeError extends Schema.TaggedErrorClass<DuplicateCatalogObjectTypeError>()(
  "DuplicateCatalogObjectTypeError",
  {
    id: Schema.String,
    message: Schema.String,
  },
) {}

/** A contributed catalog failed catalog-level validation. */
export class CatalogContributionValidationError extends Schema.TaggedErrorClass<CatalogContributionValidationError>()(
  "CatalogContributionValidationError",
  {
    contributionId: Schema.String,
    issues: Schema.Array(Schema.String),
  },
) {}

export type CatalogRegistryError =
  | InvalidCatalogContributionError
  | DuplicateCatalogObjectTypeError
  | CatalogContributionValidationError;

/** A single contributed catalog tagged with the contribution that supplied it. */
export interface CatalogContributionInput {
  readonly contributionId: string;
  readonly catalog: GameObjectCatalog;
}

/** The merged, resolved catalog registry across all contributions. */
export interface MergedGameObjectCatalog {
  readonly objectTypes: readonly GameObjectType[];
  readonly lootTables: readonly LootTable[];
  readonly items: readonly ItemDefinition[];
  /** Object-type lookup by id (post-merge). */
  readonly byId: ReadonlyMap<GameObjectTypeId, GameObjectType>;
}

/** Decode raw contribution `data` into a `GameObjectCatalog`. */
export const decodeGameObjectCatalog = (
  contributionId: string,
  data: unknown,
): Result.Result<GameObjectCatalog, InvalidCatalogContributionError> => {
  const decoded = Schema.decodeUnknownOption(GameObjectCatalog)(data);
  return Option.match(decoded, {
    onNone: () =>
      Result.fail(
        new InvalidCatalogContributionError({
          contributionId,
          message: `contribution ${contributionId} is not a valid GameObjectCatalog`,
        }),
      ),
    onSome: (catalog) => Result.succeed(catalog),
  });
};

/** Cross-pack resolvers injected into the merge (ADR-0028 weapon-ref refs). */
export interface MergeGameObjectCatalogsDeps {
  /**
   * Returns true when a `weapon-ref.weaponId` resolves. Weapon definitions are
   * never declared in object catalogs (ADR-0018 owns weapon content), so this
   * comes from the weapon-catalog registry of the composing app.
   */
  readonly resolveWeapon?: (id: string) => boolean;
}

/**
 * Merge contributed catalogs into a single resolved registry. Each pack is
 * validated independently; object-type ids must be unique across all packs
 * (plugin-neutral, ADR-0019 duplicate detection). Loot-table references and
 * `weapon-ref` companion entity references are resolved against the union of
 * all packs (ADR-0028 §4a).
 */
export const mergeGameObjectCatalogs = (
  contributions: readonly CatalogContributionInput[],
  deps: MergeGameObjectCatalogsDeps = {},
): Result.Result<MergedGameObjectCatalog, CatalogRegistryError> => {
  const allLootTableIds = new Set<string>();
  const allObjectTypeIds = new Set<string>();
  for (const { catalog } of contributions) {
    for (const table of Option.getOrElse(catalog.lootTables, () => [])) {
      allLootTableIds.add(table.id);
    }
    for (const objectType of catalog.objectTypes) {
      allObjectTypeIds.add(objectType.id);
    }
  }

  const byId = new Map<GameObjectTypeId, GameObjectType>();
  const objectTypes: GameObjectType[] = [];
  const lootTables: LootTable[] = [];
  const items: ItemDefinition[] = [];

  for (const { contributionId, catalog } of contributions) {
    const validated = validateCatalog(catalog, {
      resolveLootTable: (id) => allLootTableIds.has(id),
      resolveObjectType: (id) => allObjectTypeIds.has(id),
      ...(deps.resolveWeapon === undefined ? {} : { resolveWeapon: deps.resolveWeapon }),
    });
    if (Result.isFailure(validated)) {
      return Result.fail(
        new CatalogContributionValidationError({
          contributionId,
          issues: validated.failure.issues,
        }),
      );
    }
    for (const objectType of catalog.objectTypes) {
      if (byId.has(objectType.id)) {
        return Result.fail(
          new DuplicateCatalogObjectTypeError({
            id: objectType.id,
            message: `object type ${objectType.id} is registered by more than one catalog`,
          }),
        );
      }
      byId.set(objectType.id, objectType);
      objectTypes.push(objectType);
    }
    lootTables.push(...Option.getOrElse(catalog.lootTables, () => []));
    items.push(...Option.getOrElse(catalog.items, () => []));
  }

  return Result.succeed({ objectTypes, lootTables, items, byId });
};
