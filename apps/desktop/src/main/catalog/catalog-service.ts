import {
  GameObjectCatalog,
  GameObjectType,
  ItemDefinition,
  LootTable,
  type GameObjectTypeId,
  type JsonValue,
  PROJECT_CATALOG_FRAGMENT_SETTINGS_KEY,
  ProjectManifest,
  type ProjectId,
  makeCatalogId,
  makeGameObjectTypeId,
  makeItemDefinitionId,
  makeLootTableId,
  makeWeaponDefinitionId,
  type Uuid,
} from '@tileborne/core';
import {
  CatalogValidationIssue,
  CatalogValidationReport,
  type ProjectDefinitionKind,
} from '@tileborne/ipc-contracts';
import {
  decodeProjectContentDocument,
  buildProjectContentReferenceGraph,
  PluginTemplateProvenance,
  ProjectAuthoredProvenance,
  ProjectContentDocument,
  resolveEffectiveProjectContent,
  runtimeProjectContentFromDocument,
  RuntimeProjectContent,
  WeaponCatalog,
  WeaponCatalogEntry,
  type EffectivePluginContentSource,
  type EffectiveWeaponEntry,
  type WeaponCatalogRegistryError,
} from '@tileborne/plugin-api';
import {
  MapService,
  type MapServiceError,
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
import { randomUUID } from 'node:crypto';

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
  | MapServiceError
  | CatalogFragmentDecodeError;

export type CatalogResolveResult = CatalogResolveProjection & {
  readonly weapons: readonly EffectiveWeaponEntry[];
  readonly definitionProvenance: ProjectContentDocument['provenance'];
};

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

export interface CatalogDuplicateDefinitionResult {
  readonly duplicated: boolean;
  readonly definitionId?: string;
  readonly report: CatalogValidationReport;
}

export interface CatalogRemoveDefinitionResult {
  readonly removed: boolean;
  readonly blockedBy: readonly string[];
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
  readonly projectWeapons: readonly WeaponCatalogEntry[];
  readonly projectItems: readonly ItemDefinition[];
  readonly projectLootTables: readonly LootTable[];
  readonly projectContent: RuntimeProjectContent;
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
  readonly upsertDefinition: (
    projectId: ProjectId,
    kind: ProjectDefinitionKind,
    definitionJson: unknown,
    label?: string,
  ) => Effect.Effect<CatalogUpsertTypeResult, CatalogServiceError>;
  readonly duplicateDefinition: (
    projectId: ProjectId,
    kind: ProjectDefinitionKind,
    definitionId: string,
    label?: string,
  ) => Effect.Effect<CatalogDuplicateDefinitionResult, CatalogServiceError>;
  readonly removeDefinition: (
    projectId: ProjectId,
    kind: ProjectDefinitionKind,
    definitionId: string,
  ) => Effect.Effect<CatalogRemoveDefinitionResult, CatalogServiceError>;
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

const emptyDocument = (projectId: ProjectId): ProjectContentDocument =>
  new ProjectContentDocument({
    schemaVersion: 1,
    catalog: emptyFragment(projectId),
    weapons: new WeaponCatalog({ schemaVersion: 1, weapons: [] }),
    weaponLabels: {},
    provenance: {},
  });

const documentWith = (
  document: ProjectContentDocument,
  patch: Partial<Pick<ProjectContentDocument, 'catalog' | 'weapons' | 'weaponLabels' | 'provenance'>>,
): ProjectContentDocument =>
  new ProjectContentDocument({
    schemaVersion: 1,
    catalog: patch.catalog ?? document.catalog,
    weapons: patch.weapons ?? document.weapons,
    weaponLabels: patch.weaponLabels ?? document.weaponLabels,
    provenance: patch.provenance ?? document.provenance,
  });

/** Strip `undefined` (e.g. encoded `Option.none`) so the value is a clean JSON value. */
const toJsonValue = (value: unknown): JsonValue =>
  JSON.parse(JSON.stringify(value ?? null)) as JsonValue;

const weaponRegistryErrorMessage = (error: WeaponCatalogRegistryError): string =>
  error._tag === 'WeaponCatalogContributionValidationError'
    ? error.issues.join('; ')
    : error.message;

export const CatalogServiceLive = Layer.effect(
  CatalogService,
  Effect.gen(function* () {
    const loader = yield* PluginLoaderService;
    const registry = yield* PluginRegistryService;
    const projects = yield* ProjectService;
    const maps = yield* MapService;

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
      return loaded;
    });

    const loadPluginSources = Effect.fn('CatalogService.loadPluginSources')(function* () {
      const loaded = yield* loadEnabledDeclarative();
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
      return sources;
    });

    const readDocument = Effect.fn('CatalogService.readDocument')(function* (projectId: ProjectId) {
      const project = yield* projects.open(projectId);
      const raw = project.settings?.[PROJECT_CATALOG_FRAGMENT_SETTINGS_KEY];
      if (raw === undefined) {
        return emptyDocument(projectId);
      }
      const decoded = decodeProjectContentDocument(raw);
      if (Result.isFailure(decoded)) {
        return yield* new CatalogFragmentDecodeError({
          projectId,
          message: decoded.failure.message,
        });
      }
      return decoded.success;
    });

    const writeDocument = Effect.fn('CatalogService.writeDocument')(function* (
      projectId: ProjectId,
      document: ProjectContentDocument,
    ) {
      const project = yield* projects.open(projectId);
      const encoded = toJsonValue(Schema.encodeUnknownSync(ProjectContentDocument)(document));
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

    const effectiveContent = Effect.fn('CatalogService.effectiveContent')(function* (
      projectId: ProjectId,
    ) {
      const loaded = yield* loadEnabledDeclarative();
      const document = yield* readDocument(projectId);
      const pluginContent: readonly EffectivePluginContentSource[] = loaded.map((plugin) => ({
        pluginId: plugin.pluginId,
        gameObjectCatalogs: plugin.gameObjectCatalogs.map(({ contributionId, catalog }) => ({
          contributionId,
          catalog,
        })),
        weaponCatalogs: plugin.weaponCatalogs.map(({ contributionId, catalog }) => ({
          contributionId,
          catalog,
        })),
      }));
      const pluginSources = loaded.flatMap((plugin) =>
        plugin.gameObjectCatalogs.map(
          (materialized): CatalogContributionSource => ({
            contributionId: `${plugin.pluginId}#${materialized.contributionId}`,
            catalog: materialized.catalog,
            origin: 'plugin',
            sourcePluginId: plugin.pluginId,
          }),
        ),
      );
      const resolved = resolveEffectiveProjectContent(pluginContent, document);
      if (Result.isFailure(resolved)) {
        return yield* new CatalogFragmentDecodeError({
          projectId,
          message: weaponRegistryErrorMessage(resolved.failure),
        });
      }
      return { loaded, document, pluginContent, pluginSources, resolved: resolved.success };
    });

    const resolve = Effect.fn('CatalogService.resolve')(function* (projectId: ProjectId) {
      const { document, pluginSources, resolved } = yield* effectiveContent(projectId);
      const sources = [...pluginSources, ...projectFragmentSources(Option.some(document.catalog))];
      return {
        ...buildResolveProjection(sources, { weaponIds: resolved.weaponIds }),
        weapons: resolved.weapons,
        definitionProvenance: document.provenance,
      };
    });

    const runtimeSources = Effect.fn('CatalogService.runtimeSources')(function* (
      projectId: ProjectId,
    ) {
      const { loaded, document, resolved } = yield* effectiveContent(projectId);
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
        projectObjectTypes: resolved.projectObjectTypes,
        projectWeapons: resolved.projectWeapons,
        projectItems: resolved.projectItems,
        projectLootTables: resolved.projectLootTables,
        projectContent: runtimeProjectContentFromDocument(document),
        weaponIds: resolved.weaponIds,
      } satisfies CatalogRuntimeSources;
    });

    const validate = Effect.fn('CatalogService.validate')(function* (projectId: ProjectId) {
      const { document, pluginSources, resolved } = yield* effectiveContent(projectId);
      const sources = [...pluginSources, ...projectFragmentSources(Option.some(document.catalog))];
      return { report: toValidationReport(buildValidationReport(sources, { weaponIds: resolved.weaponIds })) };
    });

    const importCatalog = Effect.fn('CatalogService.importCatalog')(function* (
      projectId: ProjectId,
      catalogJson: unknown,
    ) {
      const decoded = decodeProjectContentDocument(catalogJson);
      if (Result.isFailure(decoded)) {
        return {
          imported: false,
          report: toValidationReport({
            ok: false,
            issues: [{ kind: 'coherence', message: decoded.failure.message }],
          }),
        };
      }
      const document = decoded.success;
      const loaded = yield* loadEnabledDeclarative();
      const pluginSources = yield* loadPluginSources();
      const pluginContent: readonly EffectivePluginContentSource[] = loaded.map((plugin) => ({
        pluginId: plugin.pluginId,
        gameObjectCatalogs: plugin.gameObjectCatalogs,
        weaponCatalogs: plugin.weaponCatalogs,
      }));
      const effective = resolveEffectiveProjectContent(pluginContent, document);
      if (Result.isFailure(effective)) {
        return {
          imported: false,
          report: toValidationReport({ ok: false, issues: [{ kind: 'coherence', message: weaponRegistryErrorMessage(effective.failure) }] }),
        };
      }
      const sources: readonly CatalogContributionSource[] = [
        ...pluginSources,
        {
          contributionId: PROJECT_CATALOG_FRAGMENT_CONTRIBUTION_ID,
          catalog: document.catalog,
          origin: 'project',
        },
      ];
      const projection = buildValidationReport(sources, { weaponIds: effective.success.weaponIds });
      const report = toValidationReport(projection);
      if (projection.ok) {
        yield* writeDocument(projectId, document);
        return { imported: true, report };
      }
      return { imported: false, report };
    });

    const exportCatalog = Effect.fn('CatalogService.exportCatalog')(function* (projectId: ProjectId) {
      const document = yield* readDocument(projectId);
      return { catalogJson: toJsonValue(Schema.encodeUnknownSync(ProjectContentDocument)(document)) };
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

    const catalogWith = (
      catalog: GameObjectCatalog,
      patch: {
        readonly objectTypes?: readonly GameObjectType[];
        readonly items?: readonly ItemDefinition[];
        readonly lootTables?: readonly LootTable[];
      },
    ): GameObjectCatalog =>
      new GameObjectCatalog({
        id: catalog.id,
        schemaVersion: catalog.schemaVersion,
        objectTypes: [...(patch.objectTypes ?? catalog.objectTypes)],
        items: Option.some([...(patch.items ?? Option.getOrElse(catalog.items, () => []))]),
        lootTables: Option.some([...(patch.lootTables ?? Option.getOrElse(catalog.lootTables, () => []))]),
      });

    const invalidMutation = (message: string): CatalogUpsertTypeResult => ({
      saved: false,
      report: toValidationReport({ ok: false, issues: [{ kind: 'coherence', message }] }),
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
      creationProvenance?: ProjectContentDocument['provenance'][string],
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
      const { document, pluginSources, resolved } = yield* effectiveContent(projectId);
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
      const fragment = document.catalog;
      const nextTypes = [
        ...fragment.objectTypes.filter((existing) => existing.id !== objectType.id),
        objectType,
      ];
      const nextFragment = fragmentWithTypes(fragment, nextTypes);
      yield* writeDocument(projectId, documentWith(document, {
        catalog: nextFragment,
        provenance: {
          ...document.provenance,
          [objectType.id]: document.provenance[objectType.id] ?? creationProvenance ?? new ProjectAuthoredProvenance({}),
        },
      }));
      const sources: readonly CatalogContributionSource[] = [
        ...pluginSources,
        {
          contributionId: PROJECT_CATALOG_FRAGMENT_CONTRIBUTION_ID,
          catalog: nextFragment,
          origin: 'project',
        },
      ];
      return { saved: true, report: toValidationReport(buildValidationReport(sources, { weaponIds: resolved.weaponIds })) };
    });

    const upsertDefinition = Effect.fn('CatalogService.upsertDefinition')(function* (
      projectId: ProjectId,
      kind: ProjectDefinitionKind,
      definitionJson: unknown,
      label?: string,
      creationProvenance?: ProjectContentDocument['provenance'][string],
    ) {
      if (kind === 'object-type') return yield* upsertType(projectId, definitionJson, creationProvenance);

      const schema = kind === 'weapon'
        ? WeaponCatalogEntry
        : kind === 'item'
          ? ItemDefinition
          : LootTable;
      const decoded = Schema.decodeUnknownResult(schema)(definitionJson);
      if (Result.isFailure(decoded)) return invalidMutation(String(decoded.failure));

      const { document, pluginContent, pluginSources, resolved } = yield* effectiveContent(projectId);
      let nextDocument: ProjectContentDocument;
      let definitionId: string;
      if (kind === 'weapon') {
        const entry = decoded.success as WeaponCatalogEntry;
        definitionId = String(entry.weapon.id);
        if (resolved.weapons.some((candidate) =>
          candidate.origin === 'plugin' && candidate.entry.weapon.id === entry.weapon.id,
        )) {
          return invalidMutation(`weapon id ${definitionId} is owned by a plugin; duplicate it first`);
        }
        nextDocument = documentWith(document, {
          weapons: new WeaponCatalog({
            schemaVersion: 1,
            weapons: [
              ...document.weapons.weapons.filter((existing) => existing.weapon.id !== entry.weapon.id),
              entry,
            ],
          }),
          weaponLabels: { ...document.weaponLabels, [definitionId]: label ?? document.weaponLabels[definitionId] ?? definitionId },
          provenance: { ...document.provenance, [definitionId]: document.provenance[definitionId] ?? creationProvenance ?? new ProjectAuthoredProvenance({}) },
        });
      } else if (kind === 'item') {
        const item = decoded.success as ItemDefinition;
        definitionId = String(item.id);
        const pluginOwned = pluginSources.some((source) =>
          Option.getOrElse(source.catalog.items, () => []).some((existing) => existing.id === item.id),
        );
        if (pluginOwned) return invalidMutation(`item id ${definitionId} is owned by a plugin; duplicate it first`);
        nextDocument = documentWith(document, {
          catalog: catalogWith(document.catalog, {
            items: [...resolved.projectItems.filter((existing) => existing.id !== item.id), item],
          }),
          provenance: { ...document.provenance, [definitionId]: document.provenance[definitionId] ?? creationProvenance ?? new ProjectAuthoredProvenance({}) },
        });
      } else {
        const table = decoded.success as LootTable;
        definitionId = String(table.id);
        const pluginOwned = pluginSources.some((source) =>
          Option.getOrElse(source.catalog.lootTables, () => []).some((existing) => existing.id === table.id),
        );
        if (pluginOwned) return invalidMutation(`loot table id ${definitionId} is owned by a plugin; duplicate it first`);
        nextDocument = documentWith(document, {
          catalog: catalogWith(document.catalog, {
            lootTables: [...resolved.projectLootTables.filter((existing) => existing.id !== table.id), table],
          }),
          provenance: { ...document.provenance, [definitionId]: document.provenance[definitionId] ?? creationProvenance ?? new ProjectAuthoredProvenance({}) },
        });
      }

      const nextEffective = resolveEffectiveProjectContent(pluginContent, nextDocument);
      if (Result.isFailure(nextEffective)) {
        return invalidMutation(weaponRegistryErrorMessage(nextEffective.failure));
      }
      yield* writeDocument(projectId, nextDocument);
      const sources = [...pluginSources, ...projectFragmentSources(Option.some(nextDocument.catalog))];
      return {
        saved: true,
        report: toValidationReport(buildValidationReport(sources, { weaponIds: nextEffective.success.weaponIds })),
      };
    });

    const duplicateDefinition = Effect.fn('CatalogService.duplicateDefinition')(function* (
      projectId: ProjectId,
      kind: ProjectDefinitionKind,
      definitionId: string,
      label?: string,
    ) {
      const { document, pluginSources, resolved } = yield* effectiveContent(projectId);
      let source: unknown;
      let sourcePluginId: string | undefined;
      if (kind === 'object-type') {
        for (const candidate of [...pluginSources, ...projectFragmentSources(Option.some(document.catalog))]) {
          const found = candidate.catalog.objectTypes.find((entry) => entry.id === definitionId);
          if (found !== undefined) {
            source = Schema.encodeUnknownSync(GameObjectType)(found);
            sourcePluginId = candidate.sourcePluginId;
            break;
          }
        }
      } else if (kind === 'weapon') {
        const found = resolved.weapons.find((entry) => entry.entry.weapon.id === definitionId);
        if (found !== undefined) {
          source = Schema.encodeUnknownSync(WeaponCatalogEntry)(found.entry);
          sourcePluginId = found.sourcePluginId;
        }
      } else {
        const candidates = [...pluginSources.map((entry) => entry.catalog), document.catalog];
        for (const candidate of candidates) {
          const found = kind === 'item'
            ? Option.getOrElse(candidate.items, () => []).find((entry) => entry.id === definitionId)
            : Option.getOrElse(candidate.lootTables, () => []).find((entry) => entry.id === definitionId);
          if (found !== undefined) {
            source = kind === 'item'
              ? Schema.encodeUnknownSync(ItemDefinition)(found as ItemDefinition)
              : Schema.encodeUnknownSync(LootTable)(found as LootTable);
            const owner = pluginSources.find((entry) => entry.catalog === candidate);
            sourcePluginId = owner?.sourcePluginId;
            break;
          }
        }
      }
      if (source === undefined || typeof source !== 'object' || source === null) {
        return { duplicated: false, report: invalidMutation(`${kind} ${definitionId} was not found`).report };
      }
      const uuid = randomUUID() as Uuid;
      const nextId = kind === 'object-type' ? makeGameObjectTypeId(uuid)
        : kind === 'weapon' ? makeWeaponDefinitionId(uuid)
          : kind === 'item' ? makeItemDefinitionId(uuid)
            : makeLootTableId(uuid);
      const clone = structuredClone(source) as Record<string, unknown>;
      if (kind === 'weapon') {
        clone.weapon = { ...(clone.weapon as Record<string, unknown>), id: nextId };
      } else {
        clone.id = nextId;
        if (label !== undefined) clone.label = label;
      }
      const creationProvenance = sourcePluginId === undefined
        ? new ProjectAuthoredProvenance({})
        : new PluginTemplateProvenance({
            pluginId: sourcePluginId as never,
            templateId: definitionId,
          });
      const mutation = yield* upsertDefinition(projectId, kind, clone, label, creationProvenance);
      if (!mutation.saved) return { duplicated: false, report: mutation.report };
      return { duplicated: true, definitionId: String(nextId), report: mutation.report };
    });

    const removeDefinition = Effect.fn('CatalogService.removeDefinition')(function* (
      projectId: ProjectId,
      kind: ProjectDefinitionKind,
      definitionId: string,
    ) {
      const document = yield* readDocument(projectId);
      const exists = kind === 'object-type'
        ? document.catalog.objectTypes.some((entry) => entry.id === definitionId)
        : kind === 'item'
          ? Option.getOrElse(document.catalog.items, () => []).some((entry) => entry.id === definitionId)
          : kind === 'loot-table'
            ? Option.getOrElse(document.catalog.lootTables, () => []).some((entry) => entry.id === definitionId)
            : document.weapons.weapons.some((entry) => entry.weapon.id === definitionId);
      // The kind/id pair is the identity. A wrong kind must never delete a
      // definition merely because another family happens to contain the id.
      if (!exists) return { removed: false, blockedBy: [] };

      const mapSummaries = yield* maps.list(projectId);
      const projectMaps = yield* Effect.forEach(mapSummaries, (summary) => maps.load(projectId, summary.id));
      const graph = buildProjectContentReferenceGraph(document, projectMaps);
      const blockedBy = graph.inbound(kind, definitionId).map((reference) => reference.sourceId);
      if (blockedBy.length > 0) return { removed: false, blockedBy };

      const provenance = Object.fromEntries(
        Object.entries(document.provenance).filter(([id]) => id !== definitionId),
      );
      const next = kind === 'object-type'
        ? documentWith(document, { catalog: catalogWith(document.catalog, { objectTypes: document.catalog.objectTypes.filter((entry) => entry.id !== definitionId) }), provenance })
        : kind === 'item'
          ? documentWith(document, { catalog: catalogWith(document.catalog, { items: Option.getOrElse(document.catalog.items, () => []).filter((entry) => entry.id !== definitionId) }), provenance })
          : kind === 'loot-table'
            ? documentWith(document, { catalog: catalogWith(document.catalog, { lootTables: Option.getOrElse(document.catalog.lootTables, () => []).filter((entry) => entry.id !== definitionId) }), provenance })
            : documentWith(document, {
              weapons: new WeaponCatalog({ schemaVersion: 1, weapons: document.weapons.weapons.filter((entry) => entry.weapon.id !== definitionId) }),
              weaponLabels: Object.fromEntries(Object.entries(document.weaponLabels).filter(([id]) => id !== definitionId)),
              provenance,
            });
      yield* writeDocument(projectId, next);
      return { removed: true, blockedBy: [] };
    });

    const removeType = Effect.fn('CatalogService.removeType')(function* (
      projectId: ProjectId,
      objectTypeId: GameObjectTypeId,
    ) {
      const result = yield* removeDefinition(projectId, 'object-type', objectTypeId);
      return { removed: result.removed };
    });

    return {
      resolve,
      validate,
      importCatalog,
      exportCatalog,
      upsertType,
      removeType,
      upsertDefinition,
      duplicateDefinition,
      removeDefinition,
      runtimeSources,
    };
  }),
);
