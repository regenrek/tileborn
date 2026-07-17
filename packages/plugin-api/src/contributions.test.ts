import { defineMigrationChain, PluginId } from '@tileborne/core';
import { Option, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  AssetPackContribution,
  MigrationsTable,
  PluginContributionZone,
  PluginContributions,
  PluginPanelContribution,
  PluginToolContribution,
  RUNTIME_MENU_SLOTS,
  RuntimeMenuSectionContribution,
  RuntimeMenuSlot,
  type InlineSchemaMigrationChainEntry,
  validatePluginContributions,
} from './contributions.js';
import { DuplicateContributionError } from './errors.js';
import { PluginManifest } from './manifest.js';

const display = {
  label: 'Battle Royale',
  description: undefined,
  icon: undefined,
  order: undefined,
};
const data = { label: 'Battle Royale', icon: 'lucide:swords' };
const license = {
  spdxId: 'CC0-1.0',
  attribution: 'Kenney',
  sourceUrl: 'https://example.invalid/assets',
};

const declarative = (tag: string, id: string, extraData = data) => ({
  _tag: tag,
  id,
  kind: 'declarative',
  display,
  data: extraData,
});

const executable = (tag: string, id: string, entry: string) => ({
  _tag: tag,
  id,
  kind: 'executable',
  display,
  entry,
});

const linkedModeContributions = (input: {
  readonly modeCount?: number;
  readonly serverValidatorId?: string;
  readonly editorValidatorId?: string;
  readonly linkedValidatorId?: string;
}): PluginContributions => {
  const mode = (index: number) => ({
    _tag: 'GameModeContribution',
    id: index === 0 ? 'mode' : `mode-${index + 1}`,
    kind: 'declarative',
    display,
    runtimeSystemId: 'mode-runtime',
    settingsPanelId: undefined,
    settingsFormId: undefined,
    mapValidatorId: input.linkedValidatorId,
    hudLayoutId: undefined,
    starter: undefined,
    checklistFacts: undefined,
    capabilities: undefined,
  });
  return Schema.decodeUnknownSync(PluginContributions)({
    gameModes: Array.from({ length: input.modeCount ?? 1 }, (_, index) => mode(index)),
    panels: undefined,
    tools: undefined,
    assetPacks: undefined,
    tilesetPacks: undefined,
    editor:
      input.editorValidatorId === undefined
        ? undefined
        : {
            tabs: undefined,
            tools: undefined,
            inspectors: undefined,
            commands: undefined,
            menus: undefined,
            settings: undefined,
            paletteCategories: undefined,
            paletteSubFilters: undefined,
            paletteItemActions: undefined,
            viewportActions: undefined,
            toolDock: undefined,
            overlays: undefined,
            inspectorPanels: undefined,
            settingsPanels: undefined,
            mapKinds: undefined,
            presets: undefined,
            panels: undefined,
            validators: [
              executable(
                'ExecutableEditorValidatorContribution',
                input.editorValidatorId,
                './editor-validator.js',
              ),
            ],
            exporters: undefined,
            generators: undefined,
            assetMetadata: undefined,
            playerModelPolicies: undefined,
            gameSettingsForms: undefined,
          },
    runtime: {
      systems: [executable('ExecutableRuntimeSystemContribution', 'mode-runtime', './runtime.js')],
      components: undefined,
      events: undefined,
      assetLoaders: undefined,
      clientSystems: undefined,
      hudWidgets: undefined,
      hudLayouts: undefined,
      lobbyPanels: undefined,
      menuSections: undefined,
      inputMaps: undefined,
      audioBuses: undefined,
      cameras: undefined,
      interpolators: undefined,
      assetPacks: undefined,
      errorMappers: undefined,
      gameObjectCatalogs: undefined,
      weaponCatalogs: undefined,
    },
    server:
      input.serverValidatorId === undefined
        ? undefined
        : {
            rules: undefined,
            scoring: undefined,
            lootTables: undefined,
            matchmaking: undefined,
            serverSystems: undefined,
            roomRules: undefined,
            mapValidators: [
              executable(
                'ExecutableServerMapValidatorContribution',
                input.serverValidatorId,
                './server-validator.js',
              ),
            ],
            matchPhases: undefined,
            replayWriters: undefined,
          },
  });
};

describe('PluginContributions', () => {
  it('accepts the spec-defined editor, runtime, and server contribution slots', () => {
    const decoded = Schema.decodeUnknownSync(PluginContributions)({
      panels: undefined,
      tools: undefined,
      assetPacks: [
        {
          _tag: 'AssetPackContribution',
          id: 'meadow',
          name: 'Meadow',
          path: './assets/meadow',
          license,
        },
      ],
      tilesetPacks: undefined,
      editor: {
        tabs: [declarative('DeclarativeEditorTabContribution', 'gameplay')],
        tools: [
          executable('ExecutableEditorToolContribution', 'safe-zone-tool', 'editor.tools.safeZone'),
        ],
        inspectors: [declarative('DeclarativeEditorInspectorContribution', 'selection')],
        commands: [declarative('DeclarativeEditorCommandContribution', 'validate-br')],
        menus: [declarative('DeclarativeEditorMenuContribution', 'export-menu')],
        settings: [declarative('DeclarativeEditorSettingsContribution', 'editor-defaults')],
        paletteCategories: [
          declarative('DeclarativeEditorPaletteCategoryContribution', 'gameplay'),
        ],
        paletteSubFilters: [
          declarative('DeclarativeEditorPaletteSubFilterContribution', 'spawn-filters'),
        ],
        paletteItemActions: [
          declarative('DeclarativeEditorPaletteItemActionContribution', 'open-atlas'),
        ],
        viewportActions: [
          declarative('DeclarativeEditorViewportActionContribution', 'set-safe-zone'),
        ],
        toolDock: [declarative('DeclarativeEditorToolDockContribution', 'validate-dock')],
        overlays: [declarative('DeclarativeEditorOverlayContribution', 'safe-zone')],
        inspectorPanels: [declarative('DeclarativeEditorInspectorPanelContribution', 'br-rules')],
        settingsPanels: [declarative('DeclarativeEditorSettingsPanelContribution', 'br-settings')],
        mapKinds: [declarative('DeclarativeEditorMapKindContribution', 'br-arena')],
        presets: [declarative('DeclarativeEditorPresetContribution', 'meadow')],
        panels: [declarative('DeclarativeEditorPanelContribution', 'gameplay-panel')],
        validators: [
          executable(
            'ExecutableEditorValidatorContribution',
            'strict-br',
            'editor.validators.strictBr',
          ),
        ],
        exporters: [
          executable('ExecutableEditorExporterContribution', 'brmap', 'editor.exporters.brmap'),
        ],
        generators: [
          executable(
            'ExecutableEditorGeneratorContribution',
            'br-generator',
            'editor.generators.br',
          ),
        ],
        assetMetadata: [
          declarative('DeclarativeEditorAssetMetadataContribution', 'license-badges'),
        ],
        playerModelPolicies: [
          declarative('DeclarativeEditorPlayerModelPolicyContribution', 'br-models'),
        ],
        gameSettingsForms: [
          declarative('DeclarativeEditorGameSettingsFormContribution', 'br-settings-form'),
        ],
      },
      runtime: {
        systems: [
          executable(
            'ExecutableRuntimeSystemContribution',
            'legacy-system',
            'runtime.systems.legacy',
          ),
        ],
        components: [declarative('DeclarativeRuntimeComponentContribution', 'health')],
        events: [declarative('DeclarativeRuntimeEventContribution', 'safe-zone-tick')],
        assetLoaders: [
          executable('ExecutableRuntimeAssetLoaderContribution', 'r2-loader', 'runtime.assets.r2'),
        ],
        clientSystems: [
          executable(
            'ExecutableRuntimeClientSystemContribution',
            'safe-zone-visual',
            'runtime.systems.safeZoneVisual',
          ),
        ],
        hudWidgets: [
          executable(
            'ExecutableRuntimeHudWidgetContribution',
            'safe-zone-timer',
            'runtime.hud.safeZoneTimer',
          ),
        ],
        hudLayouts: [declarative('DeclarativeRuntimeHudLayoutContribution', 'br-hud-layout')],
        lobbyPanels: [
          executable('ExecutableRuntimeLobbyPanelContribution', 'loadout', 'runtime.lobby.loadout'),
        ],
        menuSections: [
          {
            _tag: 'RuntimeMenuSectionContribution',
            id: 'lobby-section',
            kind: 'executable',
            slot: 'main.primaryActions',
            display,
            entry: 'runtime.menu.lobby',
            order: 10,
          },
        ],
        inputMaps: [declarative('DeclarativeRuntimeInputMapContribution', 'br-inputs')],
        audioBuses: [declarative('DeclarativeRuntimeAudioBusContribution', 'gunfire')],
        cameras: [
          executable('ExecutableRuntimeCameraContribution', 'killcam', 'runtime.cameras.killcam'),
        ],
        interpolators: [
          executable(
            'ExecutableRuntimeInterpolatorContribution',
            'health-tween',
            'runtime.interpolators.health',
          ),
        ],
        assetPacks: [
          {
            _tag: 'AssetPackContribution',
            id: 'sample-meadow',
            name: 'Sample Meadow',
            path: 'r2://sample/meadow',
            license,
          },
        ],
        errorMappers: [declarative('DeclarativeRuntimeErrorMapperContribution', 'build-mismatch')],
        gameObjectCatalogs: [
          declarative('DeclarativeRuntimeGameObjectCatalogContribution', 'br-catalog'),
        ],
        weaponCatalogs: [declarative('DeclarativeRuntimeWeaponCatalogContribution', 'weapons')],
      },
      server: {
        rules: [declarative('DeclarativeServerRuleContribution', 'legacy-rules')],
        scoring: [declarative('DeclarativeServerScoringContribution', 'br-scoring')],
        lootTables: [declarative('DeclarativeServerLootTableContribution', 'meadow-default')],
        matchmaking: [
          executable(
            'ExecutableServerMatchmakingContribution',
            'matchmaker',
            'server.matchmaking.br',
          ),
        ],
        serverSystems: [
          executable(
            'ExecutableServerSystemContribution',
            'safe-zone-damage',
            'server.systems.safeZoneDamage',
          ),
        ],
        roomRules: [declarative('DeclarativeServerRoomRuleContribution', 'br-room')],
        mapValidators: [
          executable(
            'ExecutableServerMapValidatorContribution',
            'spawn-count',
            'server.validators.spawnCount',
          ),
        ],
        matchPhases: [declarative('DeclarativeServerMatchPhaseContribution', 'countdown')],
        replayWriters: [
          executable(
            'ExecutableServerReplayWriterContribution',
            'binary-log',
            'server.replays.binaryLog',
          ),
        ],
      },
    });

    expect(Option.isSome(decoded.editor)).toBe(true);
    expect(Option.isSome(decoded.runtime)).toBe(true);
    expect(Option.isSome(decoded.server)).toBe(true);
    if (
      Option.isSome(decoded.editor) &&
      Option.isSome(decoded.runtime) &&
      Option.isSome(decoded.server)
    ) {
      expect(Option.isSome(decoded.editor.value.paletteCategories)).toBe(true);
      expect(Option.isSome(decoded.runtime.value.clientSystems)).toBe(true);
      expect(Option.isSome(decoded.server.value.serverSystems)).toBe(true);
      if (
        Option.isSome(decoded.editor.value.paletteCategories) &&
        Option.isSome(decoded.runtime.value.clientSystems) &&
        Option.isSome(decoded.server.value.serverSystems)
      ) {
        expect(decoded.editor.value.paletteCategories.value[0]?.id).toBe('gameplay');
        expect(decoded.runtime.value.clientSystems.value[0]?.kind).toBe('executable');
        expect(decoded.server.value.serverSystems.value[0]?.entry).toBe(
          'server.systems.safeZoneDamage',
        );
      }
    }
  });

  it('accepts canonical sidebar panel and tool contribution zones', () => {
    const decoded = Schema.decodeUnknownSync(PluginContributions)({
      panels: [
        {
          id: 'battle-royale-settings',
          zone: 'plugins',
          title: 'Battle Royale Settings',
          description: 'Configure Battle Royale gameplay.',
          group: 'gameplay',
          order: 10,
          capabilities: ['settings'],
          data: { indexPath: './panels/index.json' },
        },
        {
          id: 'match-rules',
          zone: 'project',
          title: 'Match Rules',
          description: undefined,
          group: undefined,
          order: undefined,
          capabilities: undefined,
          data: undefined,
        },
      ],
      tools: [
        {
          id: 'spawn-tools',
          zone: 'working-palette',
          title: 'Spawn Tools',
          description: 'Place gameplay spawn objects.',
          group: 'spawns',
          order: 20,
          commandId: undefined,
          capabilities: ['paint', 'spawn'],
          data: { objectType: 'br-spawn' },
        },
      ],
      assetPacks: undefined,
      tilesetPacks: undefined,
      editor: undefined,
      runtime: undefined,
      server: undefined,
    });

    const panels = Option.getOrElse(decoded.panels, () => []);
    const tools = Option.getOrElse(decoded.tools, () => []);
    expect(panels.map((panel) => panel.zone)).toEqual(['plugins', 'project']);
    expect(tools[0]?.zone).toBe('working-palette');
  });

  it('rejects sidebar contributions outside the canonical zones', () => {
    expect(() => Schema.decodeUnknownSync(PluginContributionZone)('activity-bar')).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(PluginPanelContribution)({
        id: 'bad-zone',
        zone: 'activity-bar',
        title: 'Bad Zone',
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(PluginToolContribution)({
        id: 'bad-tool-zone',
        zone: 'activity-bar',
        title: 'Bad Tool Zone',
      }),
    ).toThrow();
  });

  it('rejects duplicate sidebar panel and tool ids within a plugin manifest', () => {
    const pluginId = Schema.decodeUnknownSync(PluginId)('@tileborne-plugins/battle-royale');
    const contributions = Schema.decodeUnknownSync(PluginContributions)({
      panels: [
        {
          id: 'battle-royale-settings',
          zone: 'plugins',
          title: 'Settings',
          description: undefined,
          group: undefined,
          order: undefined,
          capabilities: undefined,
          data: undefined,
        },
        {
          id: 'battle-royale-settings',
          zone: 'project',
          title: 'Settings Copy',
          description: undefined,
          group: undefined,
          order: undefined,
          capabilities: undefined,
          data: undefined,
        },
      ],
      tools: [
        {
          id: 'spawn-tools',
          zone: 'working-palette',
          title: 'Spawn Tools',
          description: undefined,
          group: undefined,
          order: undefined,
          commandId: undefined,
          capabilities: undefined,
          data: undefined,
        },
        {
          id: 'spawn-tools',
          zone: 'working-palette',
          title: 'Spawn Tools Copy',
          description: undefined,
          group: undefined,
          order: undefined,
          commandId: undefined,
          capabilities: undefined,
          data: undefined,
        },
      ],
      assetPacks: undefined,
      tilesetPacks: undefined,
      editor: undefined,
      runtime: undefined,
      server: undefined,
    });

    expect(() => validatePluginContributions(pluginId, contributions)).toThrow(
      DuplicateContributionError,
    );
  });

  it('accepts a mapValidatorId only when it exactly links a server contribution', () => {
    const pluginId = Schema.decodeUnknownSync(PluginId)('@tileborne-plugins/example-arena');
    expect(() =>
      validatePluginContributions(
        pluginId,
        linkedModeContributions({
          linkedValidatorId: 'arena-validator',
          serverValidatorId: 'arena-validator',
        }),
      ),
    ).not.toThrow();
  });

  it('rejects editor-only and misspelled map-validator links', () => {
    const pluginId = Schema.decodeUnknownSync(PluginId)('@tileborne-plugins/example-arena');
    expect(() =>
      validatePluginContributions(
        pluginId,
        linkedModeContributions({
          linkedValidatorId: 'arena-validator',
          editorValidatorId: 'arena-validator',
        }),
      ),
    ).toThrow(/missing map validator contribution: arena-validator/);
    expect(() =>
      validatePluginContributions(
        pluginId,
        linkedModeContributions({
          linkedValidatorId: 'arena-validtor',
          serverValidatorId: 'arena-validator',
        }),
      ),
    ).toThrow(/missing map validator contribution: arena-validtor/);
  });

  it('rejects multiple game-mode registrations at the manifest boundary', () => {
    const pluginId = Schema.decodeUnknownSync(PluginId)('@tileborne-plugins/ambiguous');
    expect(() =>
      validatePluginContributions(pluginId, linkedModeContributions({ modeCount: 2 })),
    ).toThrow(/exactly one gameModes registration/);
  });
});

describe('RuntimeMenuSectionContribution', () => {
  it('exposes the canonical brand-neutral menu slot ids', () => {
    expect([...RUNTIME_MENU_SLOTS]).toEqual([
      'main.primaryActions',
      'main.secondaryActions',
      'main.tabs',
      'settings.tabs',
      'pause.actions',
      'results.actions',
    ]);
  });

  it('decodes an executable menu section targeting a named slot', () => {
    const section = Schema.decodeUnknownSync(RuntimeMenuSectionContribution)({
      _tag: 'RuntimeMenuSectionContribution',
      id: 'lobby',
      kind: 'executable',
      slot: 'main.primaryActions',
      display: { label: 'Lobby', description: undefined, icon: undefined, order: undefined },
      entry: 'runtime.menu.lobby',
      order: 10,
    });
    expect(section.slot).toBe('main.primaryActions');
    expect(section.entry).toBe('runtime.menu.lobby');
    expect(Option.isSome(section.order)).toBe(true);
  });

  it('rejects an unknown menu slot id', () => {
    expect(() => Schema.decodeUnknownSync(RuntimeMenuSlot)('main.unknown')).toThrow();
  });

  it('threads menu sections through RuntimeContributions', () => {
    const decoded = Schema.decodeUnknownSync(PluginContributions)({
      panels: undefined,
      tools: undefined,
      assetPacks: undefined,
      tilesetPacks: undefined,
      editor: undefined,
      runtime: {
        systems: undefined,
        components: undefined,
        events: undefined,
        assetLoaders: undefined,
        clientSystems: undefined,
        hudWidgets: undefined,
        hudLayouts: undefined,
        lobbyPanels: undefined,
        menuSections: [
          {
            _tag: 'RuntimeMenuSectionContribution',
            id: 'match-rules',
            kind: 'executable',
            slot: 'settings.tabs',
            display: undefined,
            entry: 'runtime.menu.matchRules',
            order: undefined,
          },
        ],
        inputMaps: undefined,
        audioBuses: undefined,
        cameras: undefined,
        interpolators: undefined,
        assetPacks: undefined,
        errorMappers: undefined,
        gameObjectCatalogs: undefined,
        weaponCatalogs: undefined,
      },
      server: undefined,
    });
    expect(Option.isSome(decoded.runtime)).toBe(true);
    if (Option.isSome(decoded.runtime)) {
      expect(Option.isSome(decoded.runtime.value.menuSections)).toBe(true);
      if (Option.isSome(decoded.runtime.value.menuSections)) {
        expect(decoded.runtime.value.menuSections.value[0]?.slot).toBe('settings.tabs');
      }
    }
  });
});

describe('AssetPackContribution license', () => {
  it('requires the structured asset-pipeline License shape', () => {
    const decoded = Schema.decodeUnknownSync(AssetPackContribution)({
      _tag: 'AssetPackContribution',
      id: 'meadow',
      name: 'Meadow',
      path: './assets/meadow',
      license,
    });

    expect(decoded.license.spdxId).toBe('CC0-1.0');
    expect(Option.isSome(decoded.license.attribution)).toBe(true);
    if (Option.isSome(decoded.license.attribution)) {
      expect(decoded.license.attribution.value).toBe('Kenney');
    }
  });

  it('rejects asset packs without a license', () => {
    expect(() =>
      Schema.decodeUnknownSync(AssetPackContribution)({
        _tag: 'AssetPackContribution',
        id: 'meadow',
        name: 'Meadow',
        path: './assets/meadow',
      }),
    ).toThrow();
  });

  it('rejects unparseable license metadata', () => {
    expect(() =>
      Schema.decodeUnknownSync(AssetPackContribution)({
        _tag: 'AssetPackContribution',
        id: 'meadow',
        name: 'Meadow',
        path: './assets/meadow',
        license: { spdxId: '../../bad' },
      }),
    ).toThrow();
  });
});

describe('manifest migrations', () => {
  const chain = defineMigrationChain<{ readonly schemaVersion: number }>({
    entity: 'map',
    latestVersion: 2,
    migrators: [
      {
        entity: 'map',
        fromVersion: 1,
        toVersion: 2,
        migrate: () => ({ schemaVersion: 2 }),
      },
    ],
  });

  it('round-trips top-level migration tables', () => {
    const inline: InlineSchemaMigrationChainEntry = {
      kind: 'inline',
      latestVersion: 2,
      chain,
    };
    const decoded = Schema.decodeUnknownSync(MigrationsTable)({
      entries: {
        map: {
          _tag: 'InlineSchemaMigrationChain',
          ...inline,
        },
        assetPackManifest: {
          _tag: 'ExecutableSchemaMigrationChain',
          kind: 'executable',
          latestVersion: 1,
          chainEntry: 'server.migrations.assetPackManifest',
        },
      },
    });

    expect(decoded.entries.map?.latestVersion).toBe(2);
    expect(decoded.entries.assetPackManifest?.latestVersion).toBe(1);
  });

  it('keeps migrations at the top-level manifest path', () => {
    const manifest = Schema.decodeUnknownSync(PluginManifest)({
      schemaVersion: 1,
      id: '@tileborne-plugins/battle-royale',
      name: '@tileborne-plugins/battle-royale',
      version: '0.1.0',
      displayName: 'Battle Royale',
      description: 'Battle royale rules and editor contributions.',
      author: 'Tileborne',
      license: 'MIT',
      engines: { tileborne: '^0.1.0' },
      repository: undefined,
      homepage: undefined,
      entry: undefined,
      contributes: {
        panels: undefined,
        tools: undefined,
        assetPacks: undefined,
        tilesetPacks: undefined,
        editor: undefined,
        runtime: undefined,
        server: undefined,
      },
      permissions: [],
      dependsOn: [],
      migrations: {
        entries: {
          map: {
            _tag: 'ExecutableSchemaMigrationChain',
            kind: 'executable',
            latestVersion: 2,
            chainEntry: 'server.migrations.map',
          },
        },
      },
    });

    expect(Option.isSome(manifest.migrations)).toBe(true);
    if (Option.isSome(manifest.migrations)) {
      expect(manifest.migrations.value.entries.map?.latestVersion).toBe(2);
    }
  });

  it('rejects migration entries with conflicting chain paths', () => {
    expect(() =>
      Schema.decodeUnknownSync(MigrationsTable)({
        entries: {
          map: {
            _tag: 'InlineSchemaMigrationChain',
            kind: 'inline',
            latestVersion: 2,
            chainEntry: 'server.migrations.map',
          },
        },
      }),
    ).toThrow();
  });

  it('rejects migration entries without latestVersion', () => {
    expect(() =>
      Schema.decodeUnknownSync(MigrationsTable)({
        entries: {
          map: {
            _tag: 'ExecutableSchemaMigrationChain',
            kind: 'executable',
            chainEntry: 'server.migrations.map',
          },
        },
      }),
    ).toThrow();
  });
});
