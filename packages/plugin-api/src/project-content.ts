import {
  GameObjectCatalog,
  ItemDefinition,
  LootTable,
  PERSISTED_SCHEMA_VERSIONS,
  PluginId,
  type GameObjectType,
  type TileborneMap,
  type WeaponDefinitionId,
} from '@tileborne/core';
import { Option, Result, Schema } from 'effect';

import {
  mergeWeaponCatalogs,
  WeaponCatalog,
  WeaponCatalogEntry,
  type WeaponCatalogRegistryError,
} from './weapon-catalog-registry.js';

export const PROJECT_CONTENT_SCHEMA_VERSION = PERSISTED_SCHEMA_VERSIONS.projectContent;
export const RUNTIME_PROJECT_CONTENT_SCHEMA_VERSION =
  PERSISTED_SCHEMA_VERSIONS.runtimeProjectContent;

export class ProjectAuthoredProvenance extends Schema.TaggedClass<ProjectAuthoredProvenance>()(
  'project',
  {},
) {}

export class PluginTemplateProvenance extends Schema.TaggedClass<PluginTemplateProvenance>()(
  'plugin-template',
  {
    pluginId: PluginId,
    templateId: Schema.String,
  },
) {}

/** Immutable creation provenance for a project-owned definition. */
export const ProjectDefinitionProvenance = Schema.Union([
  ProjectAuthoredProvenance,
  PluginTemplateProvenance,
]);
export type ProjectDefinitionProvenance = typeof ProjectDefinitionProvenance.Type;

/**
 * Versioned project-owned content document. The existing GameObjectCatalog
 * remains the sole owner of object/item/loot definitions; WeaponCatalog remains
 * the sole owner of weapon runtime data. This document only composes them with
 * immutable provenance instead of introducing parallel definition schemas.
 */
export class ProjectContentDocument extends Schema.Class<ProjectContentDocument>(
  'ProjectContentDocument',
)({
  schemaVersion: Schema.Literal(PROJECT_CONTENT_SCHEMA_VERSION),
  catalog: GameObjectCatalog,
  weapons: WeaponCatalog,
  weaponLabels: Schema.Record(Schema.String, Schema.String),
  provenance: Schema.Record(Schema.String, ProjectDefinitionProvenance),
}) {}

export class InvalidProjectContentDocumentError extends Schema.TaggedErrorClass<InvalidProjectContentDocumentError>()(
  'InvalidProjectContentDocumentError',
  { message: Schema.String },
) {}

/**
 * Project-owned runtime definitions carried as the first-class `content`
 * section of a RuntimeMapPackage. Object types already live in the package's
 * merged catalog with origin attribution, so this section carries the other
 * canonical definition families exactly once rather than hiding them in a
 * game-mode payload.
 */
export class RuntimeProjectContent extends Schema.Class<RuntimeProjectContent>(
  'RuntimeProjectContent',
)({
  schemaVersion: Schema.Literal(RUNTIME_PROJECT_CONTENT_SCHEMA_VERSION),
  items: Schema.Array(ItemDefinition),
  lootTables: Schema.Array(LootTable),
  weapons: Schema.Array(WeaponCatalogEntry),
  provenance: Schema.Record(Schema.String, ProjectDefinitionProvenance),
}) {}

const projectDefinitionIds = (document: ProjectContentDocument): readonly string[] => [
  ...document.catalog.objectTypes.map((definition) => String(definition.id)),
  ...Option.getOrElse(document.catalog.items, () => []).map((definition) => String(definition.id)),
  ...Option.getOrElse(document.catalog.lootTables, () => []).map((definition) =>
    String(definition.id),
  ),
  ...document.weapons.weapons.map((definition) => String(definition.weapon.id)),
];

/**
 * Provenance is an invariant of the current document format, not best-effort
 * metadata: every project definition has exactly one immutable provenance
 * entry and stale entries are rejected as incoherent imports.
 */
export const validateProjectContentProvenance = (
  document: ProjectContentDocument,
): Result.Result<ProjectContentDocument, InvalidProjectContentDocumentError> => {
  const ids = projectDefinitionIds(document);
  const expected = new Set(ids);
  const missing = ids.filter((id) => document.provenance[id] === undefined);
  const stale = Object.keys(document.provenance).filter((id) => !expected.has(id));
  if (missing.length === 0 && stale.length === 0) return Result.succeed(document);
  return Result.fail(
    new InvalidProjectContentDocumentError({
      message: [
        missing.length === 0 ? undefined : `missing provenance for ${missing.join(', ')}`,
        stale.length === 0 ? undefined : `stale provenance for ${stale.join(', ')}`,
      ]
        .filter((part): part is string => part !== undefined)
        .join('; '),
    }),
  );
};

export const runtimeProjectContentFromDocument = (
  document: ProjectContentDocument,
): RuntimeProjectContent =>
  new RuntimeProjectContent({
    schemaVersion: RUNTIME_PROJECT_CONTENT_SCHEMA_VERSION,
    items: [...Option.getOrElse(document.catalog.items, () => [])],
    lootTables: [...Option.getOrElse(document.catalog.lootTables, () => [])],
    weapons: [...document.weapons.weapons],
    provenance: { ...document.provenance },
  });

/**
 * Decode current project content or migrate the legacy v1 GameObjectCatalog
 * fragment in memory. The application persistence owner writes the migrated
 * document on its next mutation; wire contracts remain strict/current-only.
 */
export const decodeProjectContentDocument = (
  value: unknown,
): Result.Result<ProjectContentDocument, InvalidProjectContentDocumentError> => {
  const current = Schema.decodeUnknownOption(ProjectContentDocument)(value);
  if (Option.isSome(current)) return validateProjectContentProvenance(current.value);
  const legacy = Schema.decodeUnknownOption(GameObjectCatalog)(value);
  if (Option.isSome(legacy)) {
    return Result.succeed(
      new ProjectContentDocument({
        schemaVersion: PROJECT_CONTENT_SCHEMA_VERSION,
        catalog: legacy.value,
        weapons: new WeaponCatalog({
          schemaVersion: PERSISTED_SCHEMA_VERSIONS.weaponCatalog,
          weapons: [],
        }),
        weaponLabels: {},
        provenance: Object.fromEntries(
          [
            ...legacy.value.objectTypes.map((definition) => definition.id),
            ...Option.getOrElse(legacy.value.items, () => []).map((definition) => definition.id),
            ...Option.getOrElse(legacy.value.lootTables, () => []).map(
              (definition) => definition.id,
            ),
          ].map((id) => [id, new ProjectAuthoredProvenance({})]),
        ),
      }),
    );
  }
  return Result.fail(
    new InvalidProjectContentDocumentError({
      message: 'project content is neither a ProjectContentDocument nor a legacy GameObjectCatalog',
    }),
  );
};

export interface EffectivePluginContentSource {
  readonly pluginId: PluginId;
  readonly gameObjectCatalogs: readonly {
    readonly contributionId: string;
    readonly catalog: GameObjectCatalog;
  }[];
  readonly weaponCatalogs: readonly {
    readonly contributionId: string;
    readonly catalog: WeaponCatalog;
  }[];
}

export interface EffectiveWeaponEntry {
  readonly entry: WeaponCatalogEntry;
  readonly label: string;
  readonly origin: 'plugin' | 'project';
  readonly sourcePluginId?: PluginId;
  readonly provenance?: ProjectDefinitionProvenance;
}

export interface EffectiveProjectContentRegistry {
  readonly pluginCatalogs: readonly EffectivePluginContentSource[];
  readonly projectObjectTypes: readonly GameObjectType[];
  readonly projectItems: readonly ItemDefinition[];
  readonly projectLootTables: readonly LootTable[];
  readonly projectWeapons: readonly WeaponCatalogEntry[];
  readonly weaponIds: ReadonlySet<string>;
  readonly weapons: readonly EffectiveWeaponEntry[];
}

export type ProjectContentDefinitionKind = 'object-type' | 'weapon' | 'item' | 'loot-table';

export interface ProjectContentReference {
  readonly targetKind: ProjectContentDefinitionKind;
  readonly targetId: string;
  /** Stable definition id or placed-object id suitable for delete diagnostics. */
  readonly sourceId: string;
  readonly sourceKind: 'definition' | 'map-object';
}

export interface ProjectContentReferenceGraph {
  readonly references: readonly ProjectContentReference[];
  readonly inbound: (
    kind: ProjectContentDefinitionKind,
    id: string,
  ) => readonly ProjectContentReference[];
}

const definitionTargets = (
  document: ProjectContentDocument,
): ReadonlyMap<string, ProjectContentDefinitionKind> =>
  new Map([
    ...document.catalog.objectTypes.map((entry) => [String(entry.id), 'object-type'] as const),
    ...Option.getOrElse(document.catalog.items, () => []).map(
      (entry) => [String(entry.id), 'item'] as const,
    ),
    ...Option.getOrElse(document.catalog.lootTables, () => []).map(
      (entry) => [String(entry.id), 'loot-table'] as const,
    ),
    ...document.weapons.weapons.map((entry) => [String(entry.weapon.id), 'weapon'] as const),
  ]);

const collectKnownReferences = (
  value: unknown,
  targets: ReadonlyMap<string, ProjectContentDefinitionKind>,
  add: (kind: ProjectContentDefinitionKind, id: string) => void,
): void => {
  if (typeof value === 'string') {
    const kind = targets.get(value);
    if (kind !== undefined) add(kind, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectKnownReferences(entry, targets, add);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const entry of Object.values(value)) collectKnownReferences(entry, targets, add);
  }
};

/**
 * Canonical project-content reference graph. References are keyed by the
 * definition kind/id pair, and placed MapObject.kind edges are included as
 * first-class object-type references instead of being invisible to deletes.
 */
export const buildProjectContentReferenceGraph = (
  document: ProjectContentDocument,
  maps: readonly TileborneMap[],
): ProjectContentReferenceGraph => {
  const targets = definitionTargets(document);
  const references: ProjectContentReference[] = [];
  const seen = new Set<string>();
  const add = (
    targetKind: ProjectContentDefinitionKind,
    targetId: string,
    sourceId: string,
    sourceKind: ProjectContentReference['sourceKind'],
  ) => {
    const key = `${targetKind}\u0000${targetId}\u0000${sourceKind}\u0000${sourceId}`;
    if (seen.has(key)) return;
    seen.add(key);
    references.push({ targetKind, targetId, sourceId, sourceKind });
  };

  const definitions: readonly { readonly id: string; readonly value: unknown }[] = [
    ...document.catalog.objectTypes.map((value) => ({ id: String(value.id), value })),
    ...Option.getOrElse(document.catalog.items, () => []).map((value) => ({
      id: String(value.id),
      value,
    })),
    ...Option.getOrElse(document.catalog.lootTables, () => []).map((value) => ({
      id: String(value.id),
      value,
    })),
    ...document.weapons.weapons.map((value) => ({ id: String(value.weapon.id), value })),
  ];
  for (const definition of definitions) {
    collectKnownReferences(definition.value, targets, (kind, id) => {
      if (id !== definition.id) add(kind, id, definition.id, 'definition');
    });
  }
  for (const map of maps) {
    for (const object of map.objects) {
      const sourceId = String(object.id);
      const objectTypeId = String(object.kind);
      if (targets.get(objectTypeId) === 'object-type') {
        add('object-type', objectTypeId, sourceId, 'map-object');
      }
      collectKnownReferences(object.properties, targets, (kind, id) =>
        add(kind, id, sourceId, 'map-object'),
      );
    }
  }

  return {
    references,
    inbound: (kind, id) =>
      references.filter((reference) => reference.targetKind === kind && reference.targetId === id),
  };
};

const weaponLabelFromCatalogs = (
  sources: readonly EffectivePluginContentSource[],
  weaponId: WeaponDefinitionId,
): string => {
  for (const source of sources) {
    for (const contribution of source.gameObjectCatalogs) {
      const owner = contribution.catalog.objectTypes.find((objectType) =>
        objectType.components.some(
          (component) => component._tag === 'weapon-ref' && component.weaponId === weaponId,
        ),
      );
      if (owner !== undefined) return owner.label;
    }
  }
  return String(weaponId);
};

/**
 * Canonical plugin+project weapon/content resolution used by editor, playtest
 * and ship build. Plugin templates are inputs only; project additions never
 * mutate or shadow their ids.
 */
export const resolveEffectiveProjectContent = (
  plugins: readonly EffectivePluginContentSource[],
  project: ProjectContentDocument,
): Result.Result<EffectiveProjectContentRegistry, WeaponCatalogRegistryError> => {
  const contributions = plugins.flatMap((source) =>
    source.weaponCatalogs.map(({ contributionId, catalog }) => ({
      contributionId: `${source.pluginId}#${contributionId}`,
      catalog,
    })),
  );
  contributions.push({ contributionId: 'project-content', catalog: project.weapons });
  const merged = mergeWeaponCatalogs(contributions);
  if (Result.isFailure(merged)) return Result.fail(merged.failure);

  const pluginOwner = new Map<string, PluginId>();
  for (const source of plugins) {
    for (const contribution of source.weaponCatalogs) {
      for (const entry of contribution.catalog.weapons) {
        pluginOwner.set(entry.weapon.id, source.pluginId);
      }
    }
  }
  const weapons = merged.success.weapons.map((entry): EffectiveWeaponEntry => {
    const sourcePluginId = pluginOwner.get(entry.weapon.id);
    if (sourcePluginId !== undefined) {
      return {
        entry,
        label: weaponLabelFromCatalogs(plugins, entry.weapon.id),
        origin: 'plugin',
        sourcePluginId,
      };
    }
    const provenance = project.provenance[entry.weapon.id];
    return {
      entry,
      label: project.weaponLabels[entry.weapon.id] ?? String(entry.weapon.id),
      origin: 'project',
      ...(provenance === undefined ? {} : { provenance }),
    };
  });
  return Result.succeed({
    pluginCatalogs: plugins,
    projectObjectTypes: project.catalog.objectTypes,
    projectItems: Option.getOrElse(project.catalog.items, () => []),
    projectLootTables: Option.getOrElse(project.catalog.lootTables, () => []),
    projectWeapons: project.weapons.weapons,
    weaponIds: new Set(merged.success.weapons.map((entry) => String(entry.weapon.id))),
    weapons,
  });
};
