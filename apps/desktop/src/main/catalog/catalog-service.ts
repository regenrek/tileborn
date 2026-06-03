import {
  GameObjectCatalog,
  type JsonValue,
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

/**
 * Project manifest `settings` key under which the project-authored catalog
 * fragment is persisted (ADR-0025 D4). A fragment is a serialized
 * `GameObjectCatalog` pack, stored alongside other project-scoped editor data
 * (e.g. the per-project player-model roster) in the brand/mode-neutral settings
 * bag — distinct from the read-only plugin-shipped catalogs, which import/export
 * never mutate. The key is namespaced + neutral (no game-mode/brand literal).
 */
export const PROJECT_CATALOG_FRAGMENT_SETTINGS_KEY = 'tileborne:catalogFragment';

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
  // Explicit empty arrays (not `Option.none`) so the exported pack keeps the
  // `lootTables`/`items` keys and stays re-importable through JSON (the schema's
  // `OptionFromUndefinedOr` fields require the key to be present).
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
     */
    const loadPluginSources = Effect.fn('CatalogService.loadPluginSources')(function* () {
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
      return loaded.flatMap((plugin) =>
        plugin.gameObjectCatalogs.map(
          (materialized): CatalogContributionSource => ({
            contributionId: `${plugin.pluginId}#${materialized.contributionId}`,
            catalog: materialized.catalog,
            origin: 'plugin',
            sourcePluginId: plugin.pluginId,
          }),
        ),
      );
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
      const pluginSources = yield* loadPluginSources();
      const fragment = yield* readFragment(projectId);
      const sources = [...pluginSources, ...projectFragmentSources(fragment)];
      return buildResolveProjection(sources);
    });

    const validate = Effect.fn('CatalogService.validate')(function* (projectId: ProjectId) {
      const pluginSources = yield* loadPluginSources();
      const fragment = yield* readFragment(projectId);
      const sources = [...pluginSources, ...projectFragmentSources(fragment)];
      return { report: toValidationReport(buildValidationReport(sources)) };
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
      const pluginSources = yield* loadPluginSources();
      const sources: readonly CatalogContributionSource[] = [
        ...pluginSources,
        {
          contributionId: PROJECT_CATALOG_FRAGMENT_CONTRIBUTION_ID,
          catalog: fragment,
          origin: 'project',
        },
      ];
      const projection = buildValidationReport(sources);
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

    return { resolve, validate, importCatalog, exportCatalog };
  }),
);
