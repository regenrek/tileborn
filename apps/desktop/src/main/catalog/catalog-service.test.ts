import {
  type CategoryTag,
  GameObjectCatalog,
  GameObjectType,
  type JsonValue,
  LootSourceComponent,
  ProjectManifest,
  type PluginId,
  type ProjectId,
  makeCatalogId,
  makeGameObjectTypeId,
  makeLootTableId,
  makeProjectId,
  type Uuid,
} from '@tileborne/core';
import {
  MaterializedGameObjectCatalog,
  PluginLoaderService,
  PluginRegistryService,
  type InstalledPlugin,
  type LoadedDeclarativePlugin,
} from '@tileborne/services-plugin';
import { ProjectService } from '@tileborne/services-app';
import { Effect, Layer, Option, Schema, Stream } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  CatalogService,
  CatalogServiceLive,
  PROJECT_CATALOG_FRAGMENT_SETTINGS_KEY,
} from './catalog-service.js';

const UUID = (suffix: string): Uuid =>
  `550e8400-e29b-41d4-a716-${suffix.padStart(12, '0')}` as Uuid;

const asJson = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;

const PROJECT_ID = makeProjectId(UUID('1')) as ProjectId;
const PLUGIN_ID = '@tileborne/plugin-test' as unknown as PluginId;

const unimplemented = (name: string) => () => Effect.die(`not implemented in fake: ${name}`);

// Realistic fixtures: a JSON-importable catalog always carries concrete
// `category`/`layerHint`/`lootTables`/`items` values (the schema requires the
// keys present), which is what makes the settings-bag JSON round-trip lossless.
const objectType = (uuid: string, components: GameObjectType['components'] = []): GameObjectType =>
  new GameObjectType({
    id: makeGameObjectTypeId(UUID(uuid)),
    schemaVersion: 1,
    label: `type-${uuid}`,
    family: 'obstacle' as GameObjectType['family'],
    category: Option.some('gameplay' as CategoryTag),
    layerHint: Option.some('objects'),
    components,
    instanceDefaults: {},
  });

const fragment = (uuid: string, objectTypes: readonly GameObjectType[]): GameObjectCatalog =>
  new GameObjectCatalog({
    id: makeCatalogId(UUID(uuid)),
    schemaVersion: 1,
    objectTypes: [...objectTypes],
    lootTables: Option.some([]),
    items: Option.some([]),
  });

interface FakeProjectState {
  manifest: ProjectManifest;
  saved: ProjectManifest[];
}

const fakeProjectLayer = (state: FakeProjectState) =>
  Layer.succeed(ProjectService, {
    open: () => Effect.succeed(state.manifest),
    save: (project: ProjectManifest) =>
      Effect.sync(() => {
        state.manifest = project;
        state.saved.push(project);
      }),
    create: unimplemented('create'),
    list: unimplemented('list'),
    subscribe: Stream.empty,
    importFromDirectory: unimplemented('importFromDirectory'),
    exportArchive: unimplemented('exportArchive'),
    init: unimplemented('init'),
    info: unimplemented('info'),
    upgrade: unimplemented('upgrade'),
    clean: unimplemented('clean'),
  });

const fakeRegistryLayer = (plugins: readonly InstalledPlugin[]) =>
  Layer.succeed(PluginRegistryService, {
    list: () => Effect.succeed(plugins),
    discover: () => Effect.succeed(plugins),
    enable: unimplemented('enable'),
    disable: unimplemented('disable'),
    getManifest: unimplemented('getManifest'),
    verify: unimplemented('verify'),
    subscribe: Stream.empty,
  });

const fakeLoaderLayer = (loaded: readonly LoadedDeclarativePlugin[]) =>
  Layer.succeed(PluginLoaderService, {
    loadDeclarative: (pluginId: PluginId) => {
      const match = loaded.find((plugin) => plugin.pluginId === pluginId) ?? loaded[0];
      return match === undefined ? Effect.die('no fake plugin') : Effect.succeed(match);
    },
    listDeclarative: () => Effect.succeed(loaded),
    loadExecutable: unimplemented('loadExecutable'),
  });

const installedPlugin = { id: PLUGIN_ID, enabled: true } as unknown as InstalledPlugin;

const loadedPlugin = (objectTypes: readonly GameObjectType[]): LoadedDeclarativePlugin =>
  ({
    pluginId: PLUGIN_ID,
    gameObjectCatalogs: [
      new MaterializedGameObjectCatalog({
        contributionId: 'plugin-catalog',
        catalog: fragment('a', objectTypes),
      }),
    ],
    weaponCatalogs: [],
  }) as unknown as LoadedDeclarativePlugin;

const makeLayer = (state: FakeProjectState, plugins: readonly GameObjectType[]) =>
  CatalogServiceLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        fakeProjectLayer(state),
        fakeRegistryLayer([installedPlugin]),
        fakeLoaderLayer([loadedPlugin(plugins)]),
      ),
    ),
  );

const baseManifest = (settings?: ProjectManifest['settings']): ProjectManifest =>
  new ProjectManifest({
    id: PROJECT_ID,
    name: 'fixture',
    schemaVersion: 1,
    engineVersion: '0.1.0',
    plugins: [],
    assetPacks: [],
    maps: [],
    ...(settings === undefined ? {} : { settings }),
  });

describe('CatalogService', () => {
  it('resolve merges plugin catalogs with the project fragment', async () => {
    const projectFragment = fragment('b', [objectType('11')]);
    const encoded = asJson(Schema.encodeUnknownSync(GameObjectCatalog)(projectFragment));
    const state: FakeProjectState = {
      manifest: baseManifest({ [PROJECT_CATALOG_FRAGMENT_SETTINGS_KEY]: encoded }),
      saved: [],
    };

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const catalog = yield* CatalogService;
        return yield* catalog.resolve(PROJECT_ID);
      }).pipe(Effect.provide(makeLayer(state, [objectType('10')]))),
    );

    const origins = new Map(result.objectTypes.map((entry) => [entry.objectType.id, entry.origin]));
    expect(origins.get(makeGameObjectTypeId(UUID('10')))).toBe('plugin');
    expect(origins.get(makeGameObjectTypeId(UUID('11')))).toBe('project');
  });

  it('import decodes, validates, and persists a valid fragment', async () => {
    const state: FakeProjectState = { manifest: baseManifest(), saved: [] };
    const pack = fragment('c', [objectType('20')]);
    const catalogJson = Schema.encodeUnknownSync(GameObjectCatalog)(pack);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const catalog = yield* CatalogService;
        return yield* catalog.importCatalog(PROJECT_ID, catalogJson);
      }).pipe(Effect.provide(makeLayer(state, [objectType('10')]))),
    );

    expect(result.imported).toBe(true);
    expect(result.report.ok).toBe(true);
    expect(state.saved).toHaveLength(1);
    expect(state.saved[0]?.settings?.[PROJECT_CATALOG_FRAGMENT_SETTINGS_KEY]).toBeDefined();
  });

  it('import does NOT persist an undecodable pack', async () => {
    const state: FakeProjectState = { manifest: baseManifest(), saved: [] };

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const catalog = yield* CatalogService;
        return yield* catalog.importCatalog(PROJECT_ID, { not: 'a catalog' });
      }).pipe(Effect.provide(makeLayer(state, [objectType('10')]))),
    );

    expect(result.imported).toBe(false);
    expect(result.report.ok).toBe(false);
    expect(state.saved).toHaveLength(0);
  });

  it('import does NOT persist a pack that fails validation', async () => {
    const state: FakeProjectState = { manifest: baseManifest(), saved: [] };
    const danglingLoot = makeLootTableId(UUID('99'));
    const pack = fragment('d', [
      objectType('21', [
        new LootSourceComponent({
          lootTableId: Option.some(danglingLoot),
          interactionMode: 'tap',
          grants: {},
        }),
      ]),
    ]);
    const catalogJson = Schema.encodeUnknownSync(GameObjectCatalog)(pack);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const catalog = yield* CatalogService;
        return yield* catalog.importCatalog(PROJECT_ID, catalogJson);
      }).pipe(Effect.provide(makeLayer(state, [objectType('10')]))),
    );

    expect(result.imported).toBe(false);
    expect(result.report.ok).toBe(false);
    expect(result.report.issues.some((issue) => issue.kind === 'unknown-reference')).toBe(true);
    expect(state.saved).toHaveLength(0);
  });

  it('upsertType persists a work-in-progress entity even when the report has issues', async () => {
    const state: FakeProjectState = { manifest: baseManifest(), saved: [] };
    const danglingLoot = makeLootTableId(UUID('98'));
    const draft = objectType('40', [
      new LootSourceComponent({
        lootTableId: Option.some(danglingLoot),
        interactionMode: 'tap',
        grants: {},
      }),
    ]);
    const objectTypeJson = Schema.encodeUnknownSync(GameObjectType)(draft);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const catalog = yield* CatalogService;
        return yield* catalog.upsertType(PROJECT_ID, objectTypeJson);
      }).pipe(Effect.provide(makeLayer(state, [objectType('10')]))),
    );

    expect(result.saved).toBe(true);
    expect(result.report.ok).toBe(false);
    expect(result.report.issues.some((issue) => issue.kind === 'unknown-reference')).toBe(true);
    expect(state.saved).toHaveLength(1);
  });

  it('upsertType replaces an existing project entity by id', async () => {
    const original = objectType('41');
    const encoded = asJson(
      Schema.encodeUnknownSync(GameObjectCatalog)(fragment('f', [original])),
    );
    const state: FakeProjectState = {
      manifest: baseManifest({ [PROJECT_CATALOG_FRAGMENT_SETTINGS_KEY]: encoded }),
      saved: [],
    };
    const renamed = new GameObjectType({ ...original, label: 'renamed' });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const catalog = yield* CatalogService;
        yield* catalog.upsertType(PROJECT_ID, Schema.encodeUnknownSync(GameObjectType)(renamed));
        return yield* catalog.resolve(PROJECT_ID);
      }).pipe(Effect.provide(makeLayer(state, [objectType('10')]))),
    );

    const entry = result.objectTypes.find((item) => item.objectType.id === original.id);
    expect(entry?.objectType.label).toBe('renamed');
    expect(
      result.objectTypes.filter((item) => item.objectType.id === original.id),
    ).toHaveLength(1);
  });

  it('upsertType rejects a plugin-owned id and an undecodable payload', async () => {
    const state: FakeProjectState = { manifest: baseManifest(), saved: [] };
    const pluginType = objectType('10');

    const { collision, undecodable } = await Effect.runPromise(
      Effect.gen(function* () {
        const catalog = yield* CatalogService;
        const collision = yield* catalog.upsertType(
          PROJECT_ID,
          Schema.encodeUnknownSync(GameObjectType)(pluginType),
        );
        const undecodable = yield* catalog.upsertType(PROJECT_ID, { not: 'a type' });
        return { collision, undecodable };
      }).pipe(Effect.provide(makeLayer(state, [pluginType]))),
    );

    expect(collision.saved).toBe(false);
    expect(collision.report.issues[0]?.kind).toBe('duplicate-type');
    expect(undecodable.saved).toBe(false);
    expect(undecodable.report.issues[0]?.kind).toBe('coherence');
    expect(state.saved).toHaveLength(0);
  });

  it('removeType deletes a project entity and reports a missing one', async () => {
    const victim = objectType('42');
    const encoded = asJson(
      Schema.encodeUnknownSync(GameObjectCatalog)(fragment('9f', [victim])),
    );
    const state: FakeProjectState = {
      manifest: baseManifest({ [PROJECT_CATALOG_FRAGMENT_SETTINGS_KEY]: encoded }),
      saved: [],
    };

    const { removed, again, resolved } = await Effect.runPromise(
      Effect.gen(function* () {
        const catalog = yield* CatalogService;
        const removed = yield* catalog.removeType(PROJECT_ID, victim.id);
        const again = yield* catalog.removeType(PROJECT_ID, victim.id);
        const resolved = yield* catalog.resolve(PROJECT_ID);
        return { removed, again, resolved };
      }).pipe(Effect.provide(makeLayer(state, [objectType('10')]))),
    );

    expect(removed.removed).toBe(true);
    expect(again.removed).toBe(false);
    expect(resolved.objectTypes.some((entry) => entry.objectType.id === victim.id)).toBe(false);
  });

  it('export round-trips the persisted project fragment', async () => {
    const projectFragment = fragment('e', [objectType('30')]);
    const encoded = asJson(Schema.encodeUnknownSync(GameObjectCatalog)(projectFragment));
    const state: FakeProjectState = {
      manifest: baseManifest({ [PROJECT_CATALOG_FRAGMENT_SETTINGS_KEY]: encoded }),
      saved: [],
    };

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const catalog = yield* CatalogService;
        return yield* catalog.exportCatalog(PROJECT_ID);
      }).pipe(Effect.provide(makeLayer(state, [objectType('10')]))),
    );

    expect(result.catalogJson).toEqual(encoded);
  });
});
