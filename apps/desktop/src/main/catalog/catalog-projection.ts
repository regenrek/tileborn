import {
  GameObjectCatalog,
  type GameObjectType,
  type GameObjectTypeId,
  type ItemDefinition,
  type LootTable,
  type LootTableId,
  type PluginId,
} from '@tileborne/core';
import {
  type CatalogContributionInput,
  mergeGameObjectCatalogs,
} from '@tileborne/plugin-api';
import { Option, Result } from 'effect';

/**
 * A single resolved catalog tagged with where it came from. The main catalog
 * app service builds these from the per-plugin {@link GameObjectCatalog}s
 * materialized by `PluginLoaderService` plus the project-authored fragment, then
 * the pure helpers below project + validate them. Keeping these functions pure
 * (no Effect, no `services-plugin`) makes the merge/validation logic directly
 * unit-testable.
 */
export interface CatalogContributionSource {
  readonly contributionId: string;
  readonly catalog: GameObjectCatalog;
  readonly origin: 'plugin' | 'project';
  /** Present when `origin === "plugin"`. */
  readonly sourcePluginId?: PluginId;
}

/** Browse/inspect projection of one merged catalog entry (mirrors the IPC DTO). */
export interface GameObjectCatalogEntryProjection {
  readonly objectType: GameObjectType;
  readonly origin: 'plugin' | 'project';
  readonly sourcePluginId?: PluginId;
}

export interface CatalogResolveProjection {
  readonly objectTypes: readonly GameObjectCatalogEntryProjection[];
  readonly lootTables: readonly LootTable[];
  readonly items: readonly ItemDefinition[];
}

/** Structured, navigable validation issue (mirrors the IPC DTO). */
export interface CatalogValidationIssueProjection {
  readonly kind: 'duplicate-type' | 'unknown-reference' | 'coherence';
  readonly objectTypeId?: GameObjectTypeId;
  readonly refKind?: string;
  readonly missingId?: string;
  readonly message: string;
}

export interface CatalogValidationReportProjection {
  readonly ok: boolean;
  readonly issues: readonly CatalogValidationIssueProjection[];
}

const toContributionInputs = (
  sources: readonly CatalogContributionSource[],
): readonly CatalogContributionInput[] =>
  sources.map((source) => ({ contributionId: source.contributionId, catalog: source.catalog }));

const lootTableUnion = (sources: readonly CatalogContributionSource[]): ReadonlySet<string> => {
  const ids = new Set<string>();
  for (const source of sources) {
    for (const table of Option.getOrElse(source.catalog.lootTables, () => [])) {
      ids.add(table.id);
    }
  }
  return ids;
};

/**
 * Loot-table references carried by an object type's components. Mirrors the
 * private `lootTableRefsFor` in `@tileborne/core`'s `validateCatalog`; kept here
 * (rather than importing) only so the editor report can surface the *structured*
 * `refKind`/`missingId` that the core validator collapses into message strings.
 */
const lootTableRefs = (
  objectType: GameObjectType,
): readonly { readonly refKind: string; readonly id: LootTableId }[] => {
  const refs: { readonly refKind: string; readonly id: LootTableId }[] = [];
  for (const component of objectType.components) {
    if (component._tag === 'loot-source' && Option.isSome(component.lootTableId)) {
      refs.push({ refKind: 'loot-source.lootTableId', id: component.lootTableId.value });
    }
    if (component._tag === 'breakable' && Option.isSome(component.dropTableId)) {
      refs.push({ refKind: 'breakable.dropTableId', id: component.dropTableId.value });
    }
  }
  return refs;
};

const originIndex = (
  sources: readonly CatalogContributionSource[],
): ReadonlyMap<GameObjectTypeId, { origin: 'plugin' | 'project'; sourcePluginId?: PluginId }> => {
  const index = new Map<
    GameObjectTypeId,
    { origin: 'plugin' | 'project'; sourcePluginId?: PluginId }
  >();
  for (const source of sources) {
    for (const objectType of source.catalog.objectTypes) {
      if (!index.has(objectType.id)) {
        index.set(objectType.id, {
          origin: source.origin,
          ...(source.sourcePluginId === undefined ? {} : { sourcePluginId: source.sourcePluginId }),
        });
      }
    }
  }
  return index;
};

const dedupeObjectTypes = (
  sources: readonly CatalogContributionSource[],
): readonly GameObjectType[] => {
  const seen = new Set<GameObjectTypeId>();
  const objectTypes: GameObjectType[] = [];
  for (const source of sources) {
    for (const objectType of source.catalog.objectTypes) {
      if (seen.has(objectType.id)) {
        continue;
      }
      seen.add(objectType.id);
      objectTypes.push(objectType);
    }
  }
  return objectTypes;
};

const collectFor = <T>(
  sources: readonly CatalogContributionSource[],
  pick: (catalog: GameObjectCatalog) => Option.Option<readonly T[]>,
): readonly T[] => sources.flatMap((source) => Option.getOrElse(pick(source.catalog), () => []));

/**
 * Project the plugin + project catalog contributions into the resolve view
 * (ADR-0025 D2/D3). Runs the shared {@link mergeGameObjectCatalogs} for the
 * canonical (deduped, validated) merged set; if the merge fails (e.g. a
 * cross-source duplicate id that `validate` will report) the browse view still
 * degrades gracefully to a first-wins dedupe so the author can keep browsing.
 * Origin/`sourcePluginId` attribution is preserved out-of-band since the merge
 * helper intentionally drops it.
 */
export const buildResolveProjection = (
  sources: readonly CatalogContributionSource[],
): CatalogResolveProjection => {
  const origins = originIndex(sources);
  const merged = mergeGameObjectCatalogs(toContributionInputs(sources));

  const objectTypes = Result.isSuccess(merged)
    ? merged.success.objectTypes
    : dedupeObjectTypes(sources);
  const lootTables = Result.isSuccess(merged)
    ? merged.success.lootTables
    : collectFor(sources, (catalog) => catalog.lootTables);
  const items = Result.isSuccess(merged)
    ? merged.success.items
    : collectFor(sources, (catalog) => catalog.items);

  const entries: GameObjectCatalogEntryProjection[] = objectTypes.map((objectType) => {
    const origin = origins.get(objectType.id);
    if (origin?.origin === 'plugin' && origin.sourcePluginId !== undefined) {
      return { objectType, origin: 'plugin', sourcePluginId: origin.sourcePluginId };
    }
    return { objectType, origin: origin?.origin ?? 'project' };
  });

  return { objectTypes: entries, lootTables, items };
};

/**
 * Build the navigable validation report over the plugin + project catalogs
 * (ADR-0025 D7). Pass/fail (`ok`) is delegated to the shared
 * {@link mergeGameObjectCatalogs} (which runs `validateCatalog` per pack plus
 * cross-pack duplicate detection) so the editor never diverges from the runtime
 * merge gate; the structured `issues` are a presentation projection enumerating
 * every offending type/reference for click-to-navigate. A fallback issue keeps
 * the report coherent if the gate fails for a reason the projection did not
 * enumerate.
 */
export const buildValidationReport = (
  sources: readonly CatalogContributionSource[],
): CatalogValidationReportProjection => {
  const issues: CatalogValidationIssueProjection[] = [];

  const seenTypeIds = new Set<GameObjectTypeId>();
  for (const source of sources) {
    for (const objectType of source.catalog.objectTypes) {
      if (seenTypeIds.has(objectType.id)) {
        issues.push({
          kind: 'duplicate-type',
          objectTypeId: objectType.id,
          message: `duplicate object type id: ${objectType.id}`,
        });
      }
      seenTypeIds.add(objectType.id);
    }
  }

  const lootIds = lootTableUnion(sources);
  for (const source of sources) {
    for (const objectType of source.catalog.objectTypes) {
      const tags = new Set<string>();
      for (const component of objectType.components) {
        if (tags.has(component._tag)) {
          issues.push({
            kind: 'coherence',
            objectTypeId: objectType.id,
            message: `object type ${objectType.id} has duplicate component "${component._tag}"`,
          });
        }
        tags.add(component._tag);
      }
      for (const ref of lootTableRefs(objectType)) {
        if (!lootIds.has(ref.id)) {
          issues.push({
            kind: 'unknown-reference',
            objectTypeId: objectType.id,
            refKind: ref.refKind,
            missingId: ref.id,
            message: `${objectType.id}: ${ref.refKind} references unknown loot table ${ref.id}`,
          });
        }
      }
    }
  }

  const merged = mergeGameObjectCatalogs(toContributionInputs(sources));
  const ok = Result.isSuccess(merged);
  if (!ok && issues.length === 0) {
    const failure = merged.failure;
    const message =
      failure._tag === 'CatalogContributionValidationError'
        ? failure.issues.join('; ')
        : failure.message;
    issues.push({ kind: 'coherence', message });
  }

  return { ok, issues };
};
