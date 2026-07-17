import {
  type GameObjectCatalog,
  type GameObjectType,
  type GameObjectTypeId,
  type PluginId,
  RuntimeCatalogEntry,
} from '@tileborne/core';
import {
  DuplicateCatalogObjectTypeError,
  mergeGameObjectCatalogs,
  type CatalogRegistryError,
  type MergeGameObjectCatalogsDeps,
} from '@tileborne/plugin-api';
import { Result } from 'effect';

/**
 * Runtime game-object catalog registry (ADR-0030).
 *
 * The single engine owner of the cross-plugin catalog MERGE: it consumes the
 * ALREADY-MATERIALIZED per-plugin catalogs (`LoadedDeclarativePlugin.
 * gameObjectCatalogs`, decoded+validated on plugin load per ADR-0019 — hosts
 * adapt that to {@link RuntimeCatalogPluginSource}; this module never
 * re-resolves a `data.indexPath`), merges them with the ADR-0019 duplicate
 * detection (`mergeGameObjectCatalogs`), tags every entry with its origin, and
 * appends project-authored entries under the NO-SHADOWING rule (decided at
 * the M2 review): a project entry colliding with a plugin-owned id is a merge
 * FAILURE, mirroring the editor's `upsertType` rejection. The result is the
 * one runtime catalog consumer surface — hosts and plugins look up by id,
 * component tag, or family instead of re-merging.
 */

/** One plugin's materialized catalogs, tagged with the owning plugin id. */
export interface RuntimeCatalogPluginSource {
  readonly pluginId: PluginId;
  readonly catalogs: readonly {
    readonly contributionId: string;
    readonly catalog: GameObjectCatalog;
  }[];
}

/** The merged, origin-tagged, precedence-resolved runtime catalog. */
export interface RuntimeCatalogRegistry {
  /** All entries post-merge (plugin entries first, project additions last). */
  readonly entries: readonly RuntimeCatalogEntry[];
  readonly byId: (id: GameObjectTypeId) => RuntimeCatalogEntry | undefined;
  /** Entries whose object type carries a component with the given `_tag`. */
  readonly byComponentTag: (tag: string) => readonly RuntimeCatalogEntry[];
  readonly byFamily: (family: string) => readonly RuntimeCatalogEntry[];
}

const entryHasComponentTag = (entry: RuntimeCatalogEntry, tag: string): boolean =>
  entry.objectType.components.some((component) => component._tag === tag);

const toRegistry = (entries: readonly RuntimeCatalogEntry[]): RuntimeCatalogRegistry => {
  const byId = new Map<GameObjectTypeId, RuntimeCatalogEntry>(
    entries.map((entry) => [entry.objectType.id, entry]),
  );
  return {
    entries,
    byId: (id) => byId.get(id),
    byComponentTag: (tag) => entries.filter((entry) => entryHasComponentTag(entry, tag)),
    byFamily: (family) => entries.filter((entry) => String(entry.objectType.family) === family),
  };
};

/**
 * Merge plugin catalogs + project-authored object types into the runtime
 * registry. Plugin packs go through the canonical ADR-0019 merge (validation +
 * cross-pack duplicate detection); project entities append as new entries.
 * A project entity reusing a plugin-owned id FAILS the merge (no-shadowing
 * rule) — authors duplicate the type as a project entity with its own id
 * instead, exactly as the editor's `upsertType` already enforces.
 */
export const buildRuntimeCatalogRegistry = (
  plugins: readonly RuntimeCatalogPluginSource[],
  projectObjectTypes: readonly GameObjectType[] = [],
  deps: MergeGameObjectCatalogsDeps = {},
): Result.Result<RuntimeCatalogRegistry, CatalogRegistryError> => {
  const contributions = plugins.flatMap((source) =>
    source.catalogs.map(({ contributionId, catalog }) => ({ contributionId, catalog })),
  );
  const merged = mergeGameObjectCatalogs(contributions, deps);
  if (Result.isFailure(merged)) {
    return Result.fail(merged.failure);
  }

  const originByTypeId = new Map<GameObjectTypeId, PluginId>();
  for (const source of plugins) {
    for (const { catalog } of source.catalogs) {
      for (const objectType of catalog.objectTypes) {
        originByTypeId.set(objectType.id, source.pluginId);
      }
    }
  }

  const entries: RuntimeCatalogEntry[] = merged.success.objectTypes.map((objectType) => {
    const pluginId = originByTypeId.get(objectType.id);
    return new RuntimeCatalogEntry({
      origin:
        pluginId === undefined
          ? { _tag: 'project' as const }
          : { _tag: 'plugin' as const, pluginId },
      objectType,
    });
  });

  const seenIds = new Set<GameObjectTypeId>(entries.map((entry) => entry.objectType.id));
  for (const objectType of projectObjectTypes) {
    if (seenIds.has(objectType.id)) {
      const owner = originByTypeId.get(objectType.id);
      return Result.fail(
        new DuplicateCatalogObjectTypeError({
          id: objectType.id,
          message:
            owner === undefined
              ? `project object type ${objectType.id} is registered more than once`
              : `project object type ${objectType.id} shadows the same id owned by plugin ${owner}; duplicate it as a project entity with its own id instead`,
        }),
      );
    }
    seenIds.add(objectType.id);
    entries.push(
      new RuntimeCatalogEntry({
        origin: { _tag: 'project' as const },
        objectType,
      }),
    );
  }

  return Result.succeed(toRegistry(entries));
};
