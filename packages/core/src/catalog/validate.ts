import { Option, Result, Schema } from "effect";

import { CatalogId, GameObjectTypeId, LootTableId } from "../ids.js";
import type { GameObjectCatalog, GameObjectType } from "./object-type.js";

/** Two object types in a catalog share the same id. */
export class DuplicateObjectTypeError extends Schema.TaggedErrorClass<DuplicateObjectTypeError>()(
  "DuplicateObjectTypeError",
  {
    id: GameObjectTypeId,
    message: Schema.String,
  },
) {}

/** A component references an id (loot table, asset, …) absent from the pack. */
export class UnknownReferenceError extends Schema.TaggedErrorClass<UnknownReferenceError>()(
  "UnknownReferenceError",
  {
    from: GameObjectTypeId,
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
}

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
  }

  if (issues.length > 0) {
    return Result.fail(new CatalogValidationError({ catalogId: catalog.id, issues }));
  }
  return Result.succeed(catalog);
};
