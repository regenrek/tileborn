import { Option, Result, Schema } from "effect";

import type { ItemDefinitionId, LootTableId, WeaponDefinitionId } from "../ids.js";
import { CatalogId, GameObjectTypeId } from "../ids.js";
import type { GameObjectCatalog, GameObjectType, ItemDefinition } from "./object-type.js";

/** Two object types in a catalog share the same id. */
export class DuplicateObjectTypeError extends Schema.TaggedErrorClass<DuplicateObjectTypeError>()(
  "DuplicateObjectTypeError",
  {
    id: GameObjectTypeId,
    message: Schema.String,
  },
) {}

/**
 * A reference (loot table, asset, granted item/weapon id, …) points at an id
 * absent from the pack and from every injected resolver. `from` is the id of the
 * referencing definition — a {@link GameObjectTypeId} for component refs, or an
 * `ItemDefinitionId` for `ItemDefinition.grants` — held as a plain string so a
 * single error type covers both sources.
 */
export class UnknownReferenceError extends Schema.TaggedErrorClass<UnknownReferenceError>()(
  "UnknownReferenceError",
  {
    from: Schema.String,
    refKind: Schema.String,
    missingId: Schema.String,
    message: Schema.String,
  },
) {}

/** Aggregated catalog validation failure. */
export class CatalogValidationError extends Schema.TaggedErrorClass<CatalogValidationError>()(
  "CatalogValidationError",
  {
    catalogId: CatalogId,
    issues: Schema.Array(Schema.String),
  },
) {}

/** Optional cross-pack reference resolvers (e.g. assets resolved elsewhere). */
export interface ValidateCatalogDeps {
  /** Returns true when the loot-table id resolves outside this pack. */
  readonly resolveLootTable?: (id: LootTableId) => boolean;
  /** Returns true when the asset id resolves outside this pack. */
  readonly resolveAsset?: (id: string) => boolean;
  /**
   * Returns true when a granted {@link ItemDefinitionId} resolves outside this
   * pack (e.g. in another contributed catalog). In-pack `items` always resolve
   * without this resolver.
   */
  readonly resolveItem?: (id: ItemDefinitionId) => boolean;
  /**
   * Returns true when a granted {@link WeaponDefinitionId} resolves. Weapons are
   * never declared in the catalog (ADR-0018 owns weapon content), so a weapon
   * grant only resolves through this injected resolver.
   */
  readonly resolveWeapon?: (id: WeaponDefinitionId) => boolean;
}

/** A normalized, typed view of one "pickup grants `<id>`" reference. */
type GrantReference =
  | { readonly refKind: string; readonly kind: "item"; readonly id: ItemDefinitionId }
  | { readonly refKind: string; readonly kind: "weapon"; readonly id: WeaponDefinitionId };

const grantRefsFor = (objectType: GameObjectType): readonly GrantReference[] => {
  const refs: GrantReference[] = [];
  for (const component of objectType.components) {
    if (component._tag !== "loot-source" || component.grantRefs === undefined) {
      continue;
    }
    for (const grant of component.grantRefs) {
      if (grant._tag === "item-grant") {
        refs.push({ refKind: "loot-source.grantRefs.item", kind: "item", id: grant.itemId });
      } else {
        refs.push({ refKind: "loot-source.grantRefs.weapon", kind: "weapon", id: grant.weaponId });
      }
    }
  }
  return refs;
};

const itemGrantRefFor = (item: ItemDefinition): GrantReference | undefined => {
  if (item.grants === undefined) {
    return undefined;
  }
  if (item.grants._tag === "item-grant") {
    return { refKind: "item.grants.item", kind: "item", id: item.grants.itemId };
  }
  return { refKind: "item.grants.weapon", kind: "weapon", id: item.grants.weaponId };
};

const lootTableRefsFor = (
  objectType: GameObjectType,
): readonly { readonly refKind: string; readonly id: LootTableId }[] => {
  const refs: { readonly refKind: string; readonly id: LootTableId }[] = [];
  for (const component of objectType.components) {
    if (component._tag === "loot-source" && Option.isSome(component.lootTableId)) {
      refs.push({ refKind: "loot-source.lootTableId", id: component.lootTableId.value });
    }
    if (component._tag === "breakable" && Option.isSome(component.dropTableId)) {
      refs.push({ refKind: "breakable.dropTableId", id: component.dropTableId.value });
    }
  }
  return refs;
};

const assetRefsFor = (
  objectType: GameObjectType,
): readonly { readonly refKind: string; readonly id: string }[] => {
  const refs: { readonly refKind: string; readonly id: string }[] = [];
  for (const component of objectType.components) {
    if (component._tag === "visual-ref" && Option.isSome(component.assetId)) {
      refs.push({ refKind: "visual-ref.assetId", id: component.assetId.value });
    }
  }
  return refs;
};

/**
 * Pure, worker-safe validator for a single catalog pack.
 *
 * Checks:
 * - object-type id uniqueness within the pack,
 * - that `loot-source`/`breakable` table refs resolve in-pack (or via
 *   `deps.resolveLootTable`),
 * - that `visual-ref` asset refs resolve via `deps.resolveAsset` when provided,
 * - that pickup → grant refs (`loot-source.grantRefs`, `ItemDefinition.grants`)
 *   resolve: item grants in-pack `items` or via `deps.resolveItem`; weapon
 *   grants via `deps.resolveWeapon` (ADR-0023 section C, structure only),
 * - per-type component coherence (no duplicate component tags).
 */
export const validateCatalog = (
  catalog: GameObjectCatalog,
  deps: ValidateCatalogDeps = {},
): Result.Result<GameObjectCatalog, CatalogValidationError> => {
  const issues: string[] = [];

  const seen = new Set<string>();
  for (const objectType of catalog.objectTypes) {
    if (seen.has(objectType.id)) {
      issues.push(
        new DuplicateObjectTypeError({
          id: objectType.id,
          message: `duplicate object type id: ${objectType.id}`,
        }).message,
      );
    }
    seen.add(objectType.id);
  }

  const localLootTableIds = new Set<string>(
    Option.getOrElse(catalog.lootTables, () => []).map((table) => table.id),
  );

  const items = Option.getOrElse(catalog.items, () => []);
  const localItemIds = new Set<string>(items.map((item) => item.id));

  const grantUnresolved = (from: string, ref: GrantReference): string | undefined => {
    if (ref.kind === "item") {
      const resolved = localItemIds.has(ref.id) || (deps.resolveItem?.(ref.id) ?? false);
      if (resolved) {
        return undefined;
      }
      return new UnknownReferenceError({
        from,
        refKind: ref.refKind,
        missingId: ref.id,
        message: `${from}: ${ref.refKind} references unknown item ${ref.id}`,
      }).message;
    }
    if (deps.resolveWeapon?.(ref.id) ?? false) {
      return undefined;
    }
    return new UnknownReferenceError({
      from,
      refKind: ref.refKind,
      missingId: ref.id,
      message: `${from}: ${ref.refKind} references unknown weapon ${ref.id}`,
    }).message;
  };

  for (const objectType of catalog.objectTypes) {
    const tags = new Set<string>();
    for (const component of objectType.components) {
      if (tags.has(component._tag)) {
        issues.push(
          `object type ${objectType.id} has duplicate component "${component._tag}"`,
        );
      }
      tags.add(component._tag);
    }

    for (const ref of lootTableRefsFor(objectType)) {
      const resolved =
        localLootTableIds.has(ref.id) || (deps.resolveLootTable?.(ref.id) ?? false);
      if (!resolved) {
        issues.push(
          new UnknownReferenceError({
            from: objectType.id,
            refKind: ref.refKind,
            missingId: ref.id,
            message: `${objectType.id}: ${ref.refKind} references unknown loot table ${ref.id}`,
          }).message,
        );
      }
    }

    if (deps.resolveAsset !== undefined) {
      for (const ref of assetRefsFor(objectType)) {
        if (!deps.resolveAsset(ref.id)) {
          issues.push(
            new UnknownReferenceError({
              from: objectType.id,
              refKind: ref.refKind,
              missingId: ref.id,
              message: `${objectType.id}: ${ref.refKind} references unknown asset ${ref.id}`,
            }).message,
          );
        }
      }
    }

    for (const ref of grantRefsFor(objectType)) {
      const issue = grantUnresolved(objectType.id, ref);
      if (issue !== undefined) {
        issues.push(issue);
      }
    }
  }

  for (const item of items) {
    const ref = itemGrantRefFor(item);
    if (ref === undefined) {
      continue;
    }
    const issue = grantUnresolved(item.id, ref);
    if (issue !== undefined) {
      issues.push(issue);
    }
  }

  if (issues.length > 0) {
    return Result.fail(new CatalogValidationError({ catalogId: catalog.id, issues }));
  }
  return Result.succeed(catalog);
};
