import {
  GameObjectCatalog,
  GameObjectType,
  type GameObjectTypeId,
  type JsonValue,
  PROJECT_CATALOG_FRAGMENT_SETTINGS_KEY,
  ProjectManifest,
  type ProjectId,
  makeCatalogId,
  type Uuid,
} from '@tileborne/core';
import {
  CatalogValidationIssue,
  CatalogValidationReport,
} from '@tileborne/ipc-contracts';
import { decodeGameObjectCatalog } from '@tileborne/plugin-api';
import {
  ProjectService,
  type ProjectServiceError,
} from '@tileborne/services-app';
import { type RuntimeCatalogPluginSource } from '@tileborne/runtime/map-package';
import {
  PluginLoaderService,
  PluginRegistryService,
  type PluginRegistryServiceError,
} from '@tileborne/services-plugin';
import { Context, Effect, Layer, Option, Result, Schema } from 'effect';

import {
  buildResolveProjection,
  buildValidationReport,
  type CatalogContributionSource,
  type CatalogResolveProjection,
  type CatalogValidationReportProjection,
} from './catalog-projection.js';

const toValidationReport = (
  projection: CatalogValidationReportProjection,
): CatalogValidationReport =>
  new CatalogValidationReport({
    ok: projection.ok,
    issues: projection.issues.map(
      (issue) =>
        new CatalogValidationIssue({
          kind: issue.kind,
          ...(issue.objectTypeId === undefined ? {} : { objectTypeId: issue.objectTypeId }),
          ...(issue.refKind === undefined ? {} : { refKind: issue.refKind }),
          ...(issue.missingId === undefined ? {} : { missingId: issue.missingId }),
          message: issue.message,
        }),
    ),
  });

// Re-exported for existing desktop consumers; @tileborne/core owns the key
// (ADR-0025 D4) so the ship-build assembly reads the SAME project fragment.
export { PROJECT_CATALOG_FRAGMENT_SETTINGS_KEY };

/** Contribution id used for the project-authored fragment in the editor merge. */
export const PROJECT_CATALOG_FRAGMENT_CONTRIBUTION_ID = 'project-catalog-fragment';

export class CatalogFragmentDecodeError extends Schema.TaggedErrorClass<CatalogFragmentDecodeError>()(
  'CatalogFragmentDecodeError',
  {
    projectId: Schema.String,
    message: Schema.String,
  },
) {}

export type CatalogServiceError =
  | PluginRegistryServiceError
  | ProjectServiceError
  | CatalogFragmentDecodeError;

export type CatalogResolveResult = CatalogResolveProjection;

export interface CatalogValidateResult {
  readonly report: CatalogValidationReport;
}

export interface CatalogImportResult {
  readonly imported: boolean;
  readonly report: CatalogValidationReport;
}

export interface CatalogExportResult {
  readonly catalogJson: JsonValue;
}

export interface CatalogUpsertTypeResult {
  readonly saved: boolean;
  readonly report: CatalogValidationReport;
}

export interface CatalogRemoveTypeResult {
  readonly removed: boolean;
}

/**
 * The raw merge inputs for runtime map-package assembly (ADR-0030): the
 * materialized per-plugin catalogs, the project-authored entities, and the
 * contributed weapon ids the canonical `buildRuntimeCatalogRegistry` merge
 * needs to resolve `weapon-ref` references. The editor projection (`resolve`)
 * and the package share these EXACT sources, so both surfaces always agree.
 */
export interface CatalogRuntimeSources {
  readonly pluginCatalogs: readonly RuntimeCatalogPluginSource[];
  readonly projectObjectTypes: readonly GameObjectType[];
  readonly weaponIds: ReadonlySet<string>;
}

/**
 * The sole `apps/desktop/src/main` consumer of `@tileborne/services-plugin` for
 * the editor catalog surface (ADR-0025): it lists declarative plugins, collects
 * their materialized `GameObjectCatalog`s plus the project-authored fragment,
 * runs the shared merge/validation, and projects to the IPC DTO shapes. The
 * renderer never touches `services-plugin`; it consumes only the `catalog:*`
 * IPC DTOs.
 */
export class CatalogService extends Context.Service<CatalogService, {
  readonly resolve: (projectId: ProjectId) => Effect.Effect<CatalogResolveResult, CatalogServiceError>;
  readonly validate: (projectId: ProjectId) => Effect.Effect<CatalogValidateResult, CatalogServiceError>;
  readonly importCatalog: (
    projectId: ProjectId,
    catalogJson: unknown,
  ) => Effect.Effect<CatalogImportResult, CatalogServiceError>;
  readonly exportCatalog: (projectId: ProjectId) => Effect.Effect<CatalogExportResult, CatalogServiceError>;
  readonly upsertType: (
    projectId: ProjectId,
    objectTypeJson: unknown,
  ) => Effect.Effect<CatalogUpsertTypeResult, CatalogServiceError>;
  readonly removeType: (
    projectId: ProjectId,
    objectTypeId: GameObjectTypeId,
  ) => Effect.Effect<CatalogRemoveTypeResult, CatalogServiceError>;
  readonly runtimeSources: (
    projectId: ProjectId,
  ) => Effect.Effect<CatalogRuntimeSources, CatalogServiceError>;
}>()('@tileborne/desktop/CatalogService') {}

const projectFragmentSources = (
  fragment: Option.Option<GameObjectCatalog>,
): readonly CatalogContributionSource[] =>
  Option.match(fragment, {
    onNone: () => [],
    onSome: (catalog) => [
      {
        contributionId: PROJECT_CATALOG_FRAGMENT_CONTRIBUTION_ID,
        catalog,
        origin: 'project' as const,
      },
    ],
  });

const emptyFragment = (projectId: ProjectId): GameObjectCatalog => {
  const uuid = projectId.slice('project:'.length) as Uuid;
  // Explicit empty arrays so the exported pack keeps the `lootTables`/`items`
  // keys visible (the schema also tolerates omitted keys via OptionFromOptional).
  return new GameObjectCatalog({
    id: makeCatalogId(uuid),
    schemaVersion: 1,
    objectTypes: [],
    lootTables: Option.some([]),
    items: Option.some([]),
  });
};

/** Strip `undefined` (e.g. encoded `Option.none`) so the value is a clean JSON value. */
const toJsonValue = (value: unknown): JsonValue =>
  JSON.parse(JSON.stringify(value ?? null)) as JsonValue;

export const CatalogServiceLive = Layer.effect(
  CatalogService,
  Effect.gen(function* () {
    const loader = yield* PluginLoaderService;
    const registry = yield* PluginRegistryService;
    const projects = yield* ProjectService;

    /**
     * Materialize every enabled declarative plugin's catalogs. `loadDeclarative`
     * populates the loader's declarative cache; a broken/integrity-failing plugin
     * is skipped rather than failing the whole catalog so authoring stays usable.
     * Also collects the union of contributed weapon ids (ADR-0018) so
     * `weapon-ref.weaponId` references can resolve in the merge (ADR-0028 §4a).
     */
    const loadEnabledDeclarative = Effect.fn('CatalogService.loadEnabledDeclarative')(function* () {
      const plugins = yield* registry.list();
      const enabledIds = plugins.filter((plugin) => plugin.enabled).map((plugin) => plugin.id);
      const enabled = new Set(enabledIds);
      yield* Effect.forEach(
        enabledIds,
        (pluginId) => loader.loadDeclarative(pluginId).pipe(Effect.catch(() => Effect.void)),
        { discard: true },
      );
      const loaded = (yield* loader.listDeclarative()).filter((plugin) =>
        enabled.has(plugin.pluginId),
      );
      const weaponIds = new Set<string>(
        loaded.flatMap((plugin) =>
          plugin.weaponCatalogs.flatMap((materialized) =>
            materialized.catalog.weapons.map((entry) => String(entry.weapon.id)),
          ),
        ),
      );
      return { loaded, weaponIds };
    });

    const loadPluginSources = Effect.fn('CatalogService.loadPluginSources')(function* () {
      const { loaded, weaponIds } = yield* loadEnabledDeclarative();
      const sources = loaded.flatMap((plugin) =>
        plugin.gameObjectCatalogs.map(
          (materialized): CatalogContributionSource => ({
            contributionId: `${plugin.pluginId}#${materialized.contributionId}`,
            catalog: materialized.catalog,
            origin: 'plugin',
            sourcePluginId: plugin.pluginId,
          }),
        ),
      );
      return { sources, weaponIds };
    });

    const readFragment = Effect.fn('CatalogService.readFragment')(function* (projectId: ProjectId) {
      const project = yield* projects.open(projectId);
      const raw = project.settings?.[PROJECT_CATALOG_FRAGMENT_SETTINGS_KEY];
      if (raw === undefined) {
        return Option.none<GameObjectCatalog>();
      }
      const decoded = yield* Schema.decodeUnknownEffect(GameObjectCatalog)(raw).pipe(
        Effect.mapError(
          (cause) =>
            new CatalogFragmentDecodeError({
              projectId,
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        ),
      );
      return Option.some(decoded);
    });

    const writeFragment = Effect.fn('CatalogService.writeFragment')(function* (
      projectId: ProjectId,
      fragment: GameObjectCatalog,
    ) {
      const project = yield* projects.open(projectId);
      const encoded = toJsonValue(Schema.encodeUnknownSync(GameObjectCatalog)(fragment));
      const settings = {
        ...(project.settings ?? {}),
        [PROJECT_CATALOG_FRAGMENT_SETTINGS_KEY]: encoded,
      };
      const updated = new ProjectManifest({
        id: project.id,
        name: project.name,
        schemaVersion: 1,
        engineVersion: project.engineVersion,
        plugins: [...project.plugins],
        assetPacks: [...project.assetPacks],
        maps: [...project.maps],
        settings,
      });
      yield* projects.save(updated);
    });

    const resolve = Effect.fn('CatalogService.resolve')(function* (projectId: ProjectId) {
      const { sources: pluginSources, weaponIds } = yield* loadPluginSources();
      const fragment = yield* readFragment(projectId);
      const sources = [...pluginSources, ...projectFragmentSources(fragment)];
      return buildResolveProjection(sources, { weaponIds });
    });

    const runtimeSources = Effect.fn('CatalogService.runtimeSources')(function* (
      projectId: ProjectId,
    ) {
      const { loaded, weaponIds } = yield* loadEnabledDeclarative();
      const fragment = yield* readFragment(projectId);
      return {
        pluginCatalogs: loaded
          .filter((plugin) => plugin.gameObjectCatalogs.length > 0)
          .map(
            (plugin): RuntimeCatalogPluginSource => ({
              pluginId: plugin.pluginId,
              catalogs: plugin.gameObjectCatalogs.map(({ contributionId, catalog }) => ({
                contributionId: `${plugin.pluginId}#${contributionId}`,
                catalog,
              })),
            }),
          ),
        projectObjectTypes: Option.match(fragment, {
          onNone: () => [] as readonly GameObjectType[],
          onSome: (catalog) => catalog.objectTypes,
        }),
        weaponIds,
      } satisfies CatalogRuntimeSources;
    });

    const validate = Effect.fn('CatalogService.validate')(function* (projectId: ProjectId) {
      const { sources: pluginSources, weaponIds } = yield* loadPluginSources();
      const fragment = yield* readFragment(projectId);
      const sources = [...pluginSources, ...projectFragmentSources(fragment)];
      return { report: toValidationReport(buildValidationReport(sources, { weaponIds })) };
    });

    const importCatalog = Effect.fn('CatalogService.importCatalog')(function* (
      projectId: ProjectId,
      catalogJson: unknown,
    ) {
      const decoded = decodeGameObjectCatalog(PROJECT_CATALOG_FRAGMENT_CONTRIBUTION_ID, catalogJson);
      if (Result.isFailure(decoded)) {
        return {
          imported: false,
          report: toValidationReport({
            ok: false,
            issues: [{ kind: 'coherence', message: decoded.failure.message }],
          }),
        };
      }
      const fragment = decoded.success;
      const { sources: pluginSources, weaponIds } = yield* loadPluginSources();
      const sources: readonly CatalogContributionSource[] = [
        ...pluginSources,
        {
          contributionId: PROJECT_CATALOG_FRAGMENT_CONTRIBUTION_ID,
          catalog: fragment,
          origin: 'project',
        },
      ];
      const projection = buildValidationReport(sources, { weaponIds });
      const report = toValidationReport(projection);
      if (projection.ok) {
        yield* writeFragment(projectId, fragment);
        return { imported: true, report };
      }
      return { imported: false, report };
    });

    const exportCatalog = Effect.fn('CatalogService.exportCatalog')(function* (projectId: ProjectId) {
      const fragment = yield* readFragment(projectId);
      const catalog = Option.getOrElse(fragment, () => emptyFragment(projectId));
      return { catalogJson: toJsonValue(Schema.encodeUnknownSync(GameObjectCatalog)(catalog)) };
    });

    const fragmentWithTypes = (
      fragment: GameObjectCatalog,
      objectTypes: readonly GameObjectType[],
    ): GameObjectCatalog =>
      new GameObjectCatalog({
        id: fragment.id,
        schemaVersion: fragment.schemaVersion,
        objectTypes: [...objectTypes],
        lootTables: fragment.lootTables,
        items: fragment.items,
      });

    /**
     * Entity-editor authoring write (ADR-0028): create or replace one
     * project-authored type in the fragment. Unlike `importCatalog`, saving is
     * NOT gated on a clean merged report — authors persist work-in-progress
     * entities and the returned report carries the open issues. Rejected only
     * when the payload doesn't decode or the id collides with a plugin-owned
     * type (which the project fragment must never shadow).
     */
    const upsertType = Effect.fn('CatalogService.upsertType')(function* (
      projectId: ProjectId,
      objectTypeJson: unknown,
    ) {
      const decoded = Schema.decodeUnknownResult(GameObjectType)(objectTypeJson);
      if (Result.isFailure(decoded)) {
        return {
          saved: false,
          report: toValidationReport({
            ok: false,
            issues: [{ kind: 'coherence', message: String(decoded.failure) }],
          }),
        };
      }
      const objectType = decoded.success;
      const { sources: pluginSources, weaponIds } = yield* loadPluginSources();
      const pluginOwned = pluginSources.some((source) =>
        source.catalog.objectTypes.some((existing) => existing.id === objectType.id),
      );
      if (pluginOwned) {
        return {
          saved: false,
          report: toValidationReport({
            ok: false,
            issues: [
              {
                kind: 'duplicate-type',
                objectTypeId: objectType.id,
                message: `object type id ${objectType.id} is owned by a plugin catalog; duplicate it as a project entity instead`,
              },
            ],
          }),
        };
      }
      const fragment = Option.getOrElse(yield* readFragment(projectId), () =>
        emptyFragment(projectId),
      );
      const nextTypes = [
        ...fragment.objectTypes.filter((existing) => existing.id !== objectType.id),
        objectType,
      ];
      const nextFragment = fragmentWithTypes(fragment, nextTypes);
      yield* writeFragment(projectId, nextFragment);
      const sources: readonly CatalogContributionSource[] = [
        ...pluginSources,
        {
          contributionId: PROJECT_CATALOG_FRAGMENT_CONTRIBUTION_ID,
          catalog: nextFragment,
          origin: 'project',
        },
      ];
      return { saved: true, report: toValidationReport(buildValidationReport(sources, { weaponIds })) };
    });

    const removeType = Effect.fn('CatalogService.removeType')(function* (
      projectId: ProjectId,
      objectTypeId: GameObjectTypeId,
    ) {
      const fragment = yield* readFragment(projectId);
      if (Option.isNone(fragment)) {
        return { removed: false };
      }
      const nextTypes = fragment.value.objectTypes.filter(
        (existing) => existing.id !== objectTypeId,
      );
      if (nextTypes.length === fragment.value.objectTypes.length) {
        return { removed: false };
      }
      yield* writeFragment(projectId, fragmentWithTypes(fragment.value, nextTypes));
      return { removed: true };
    });

    return { resolve, validate, importCatalog, exportCatalog, upsertType, removeType, runtimeSources };
  }),
);
