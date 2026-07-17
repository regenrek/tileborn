import { PluginId } from '@tileborne/core';
import { Option, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  DuplicateContributionError,
  ExportArtifact,
  FilesystemRead,
  FilesystemWrite,
  GenerateMap,
  ImportAsset,
  IncompatibleEngineVersionError,
  InvalidPluginManifestError,
  MissingPermissionError,
  NetworkAccess,
  PluginApiError,
  PluginContributions,
  PluginManifest,
  PluginPermission,
  PostProcessAssetPack,
  ReadAssetPack,
  RegisterEditorTool,
  RegisterRuntimeSystem,
  RegisterServerRule,
  SemverRangeString,
  SemverString,
  UnresolvedPluginDependencyError,
  ValidateMap,
  MigrationConflictError,
  PluginRef,
  validatePluginContributions,
} from './index.js';

const pluginId = '@tileborne-plugins/battle-royale';
const decodedPluginId = Schema.decodeUnknownSync(PluginId)(pluginId);
const decodedPluginRef = Schema.decodeUnknownSync(PluginRef)('@tileborne-plugins/rpg');
const decodedEngineRange = Schema.decodeUnknownSync(SemverRangeString)('^0.2.0');

const display = {
  label: 'Battle Royale',
  description: 'Battle royale tools',
  icon: 'lucide:swords',
  order: 10,
};

const declarativeContribution = (tag: string, id: string, data = {}) => ({
  _tag: tag,
  id,
  kind: 'declarative',
  display,
  data,
});

const executableContribution = (tag: string, id: string, entry: string) => ({
  _tag: tag,
  id,
  kind: 'executable',
  display,
  entry,
});

const minimalContributions = {
  panels: undefined,
  tools: undefined,
  assetPacks: undefined,
  tilesetPacks: undefined,
  tiledImportProfiles: undefined,
  editor: {
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
    validators: undefined,
    exporters: undefined,
    generators: undefined,
    assetMetadata: undefined,
    playerModelPolicies: undefined,
    gameSettingsForms: undefined,
  },
  runtime: {
    systems: undefined,
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
  server: {
    rules: undefined,
    scoring: undefined,
    lootTables: undefined,
    matchmaking: undefined,
    serverSystems: undefined,
    roomRules: undefined,
    mapValidators: undefined,
    matchPhases: undefined,
    replayWriters: undefined,
  },
};

const minimalManifest = {
  schemaVersion: 1 as const,
  id: pluginId,
  name: '@tileborne-plugins/battle-royale',
  version: '0.1.0',
  displayName: 'Battle Royale',
  description: 'Battle royale map validation and runtime rules.',
  author: 'Tileborne',
  license: 'MIT',
  engines: { tileborne: '^0.1.0' },
  repository: undefined,
  homepage: undefined,
  entry: undefined,
  contributes: minimalContributions,
  permissions: [],
  dependsOn: [],
  migrations: undefined,
};

const roundTrip = <A, I>(schema: Schema.Codec<A, I, never, never>, value: I) => {
  const decoded = Schema.decodeUnknownSync(schema)(value);
  expect(Schema.encodeSync(schema)(decoded)).toEqual(value);
};

describe('PluginManifest', () => {
  it('round-trips a minimal manifest', () => {
    roundTrip(PluginManifest, minimalManifest);
  });

  it('round-trips a manifest with every contribution bucket populated', () => {
    roundTrip(PluginManifest, {
      ...minimalManifest,
      repository: 'https://example.invalid/tileborne-plugins/battle-royale',
      homepage: 'https://example.invalid/battle-royale',
      entry: {
        editor: './dist/editor.js',
        runtime: './dist/runtime.js',
        server: './dist/server.js',
      },
      permissions: [
        { _tag: 'ReadAssetPack', packId: 'sample/meadow' },
        { _tag: 'RegisterEditorTool', toolId: 'br.validate' },
        { _tag: 'RegisterRuntimeSystem', systemId: 'safe-zone-visuals' },
        { _tag: 'RegisterServerRule', ruleId: 'room-rules' },
      ],
      dependsOn: ['@tileborne-plugins/rpg'],
      contributes: {
        ...minimalContributions,
        panels: [
          {
            id: 'battle-royale-settings',
            zone: 'plugins',
            title: 'Battle Royale Settings',
            description: 'Configure battle royale gameplay.',
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
            description: 'Place player and loot spawn objects.',
            group: 'gameplay',
            order: 20,
            commandId: undefined,
            capabilities: ['spawn'],
            data: { gameObjectCatalogId: 'br-game-object-catalog' },
          },
        ],
        assetPacks: [
          {
            _tag: 'AssetPackContribution',
            id: 'meadow',
            name: 'Meadow',
            path: './assets/meadow/tileborne-asset-pack.json',
            license: { spdxId: 'CC0-1.0', sourceUrl: 'https://example.invalid/meadow' },
          },
        ],
        tiledImportProfiles: [
          {
            id: 'rpg-maker',
            displayName: 'RPG Maker conventions',
            transformPlan: 'editor.tiledImportProfiles.rpgMaker',
          },
        ],
        editor: {
          ...minimalContributions.editor,
          tabs: [
            declarativeContribution('DeclarativeEditorTabContribution', 'gameplay'),
            executableContribution(
              'ExecutableEditorTabContribution',
              'br.panel',
              'editor.tabs.setupBattleRoyale',
            ),
          ],
          tools: [
            declarativeContribution('DeclarativeEditorToolContribution', 'safe-zone', {
              radius: 128,
            }),
            executableContribution(
              'ExecutableEditorToolContribution',
              'br.validate',
              'editor.tools.validate',
            ),
          ],
          inspectors: [
            declarativeContribution('DeclarativeEditorInspectorContribution', 'br.rules'),
            executableContribution(
              'ExecutableEditorInspectorContribution',
              'br.advanced',
              'editor.inspectors.advanced',
            ),
          ],
          commands: [
            declarativeContribution('DeclarativeEditorCommandContribution', 'br.validate', {
              keybinding: 'Ctrl+Shift+V',
              action: { channel: 'tileborne.maps.validate' },
            }),
            executableContribution(
              'ExecutableEditorCommandContribution',
              'br.export',
              'editor.commands.export',
            ),
          ],
          menus: [
            declarativeContribution('DeclarativeEditorMenuContribution', 'br.menu.validate', {
              location: 'Run',
              commandId: 'br.validate',
            }),
            executableContribution(
              'ExecutableEditorMenuContribution',
              'br.menu.export',
              'editor.menus.export',
            ),
          ],
          settings: [
            declarativeContribution('DeclarativeEditorSettingsContribution', 'br.settings', {
              schema: { type: 'object' },
              defaults: { requiredPlayers: 16 },
            }),
            executableContribution(
              'ExecutableEditorSettingsContribution',
              'br.settings.advanced',
              'editor.settings.advanced',
            ),
          ],
          paletteCategories: [
            declarativeContribution('DeclarativeEditorPaletteCategoryContribution', 'gameplay'),
          ],
          paletteSubFilters: [
            declarativeContribution(
              'DeclarativeEditorPaletteSubFilterContribution',
              'spawn-filters',
            ),
          ],
          paletteItemActions: [
            declarativeContribution('DeclarativeEditorPaletteItemActionContribution', 'open-atlas'),
          ],
          viewportActions: [
            declarativeContribution('DeclarativeEditorViewportActionContribution', 'set-safe-zone'),
          ],
          toolDock: [
            declarativeContribution('DeclarativeEditorToolDockContribution', 'validate-dock'),
          ],
          overlays: [declarativeContribution('DeclarativeEditorOverlayContribution', 'safe-zone')],
          inspectorPanels: [
            declarativeContribution('DeclarativeEditorInspectorPanelContribution', 'br-rules'),
          ],
          settingsPanels: [
            declarativeContribution('DeclarativeEditorSettingsPanelContribution', 'br-settings'),
          ],
          mapKinds: [declarativeContribution('DeclarativeEditorMapKindContribution', 'br-arena')],
          presets: [declarativeContribution('DeclarativeEditorPresetContribution', 'meadow')],
          panels: [declarativeContribution('DeclarativeEditorPanelContribution', 'gameplay-panel')],
          validators: [
            executableContribution(
              'ExecutableEditorValidatorContribution',
              'strict-br',
              'editor.validators.strict',
            ),
          ],
          exporters: [
            executableContribution(
              'ExecutableEditorExporterContribution',
              'brmap',
              'editor.exporters.brmap',
            ),
          ],
          generators: [
            executableContribution(
              'ExecutableEditorGeneratorContribution',
              'br-generator',
              'editor.generators.br',
            ),
          ],
          assetMetadata: [
            declarativeContribution('DeclarativeEditorAssetMetadataContribution', 'license-badges'),
          ],
          playerModelPolicies: [
            declarativeContribution('DeclarativeEditorPlayerModelPolicyContribution', 'br-models'),
          ],
          gameSettingsForms: [
            declarativeContribution(
              'DeclarativeEditorGameSettingsFormContribution',
              'br-settings-form',
            ),
          ],
        },
        runtime: {
          ...minimalContributions.runtime,
          systems: [
            executableContribution(
              'ExecutableRuntimeSystemContribution',
              'safe-zone-visuals',
              'runtime.systems.safeZoneVisual',
            ),
          ],
          components: [
            declarativeContribution('DeclarativeRuntimeComponentContribution', 'health'),
          ],
          events: [declarativeContribution('DeclarativeRuntimeEventContribution', 'storm-closing')],
          assetLoaders: [
            executableContribution(
              'ExecutableRuntimeAssetLoaderContribution',
              'br-loader',
              'runtime.assets.loadBattleRoyale',
            ),
          ],
          clientSystems: [
            executableContribution(
              'ExecutableRuntimeClientSystemContribution',
              'safe-zone-visual',
              'runtime.systems.safeZoneVisual',
            ),
          ],
          hudWidgets: [
            executableContribution(
              'ExecutableRuntimeHudWidgetContribution',
              'safe-zone-timer',
              'runtime.hud.safeZoneTimer',
            ),
          ],
          lobbyPanels: [
            executableContribution(
              'ExecutableRuntimeLobbyPanelContribution',
              'loadout',
              'runtime.lobby.loadout',
            ),
          ],
          inputMaps: [
            declarativeContribution('DeclarativeRuntimeInputMapContribution', 'br-inputs'),
          ],
          audioBuses: [
            declarativeContribution('DeclarativeRuntimeAudioBusContribution', 'gunfire'),
          ],
          cameras: [
            executableContribution(
              'ExecutableRuntimeCameraContribution',
              'killcam',
              'runtime.cameras.killcam',
            ),
          ],
          interpolators: [
            executableContribution(
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
              license: { spdxId: 'CC0-1.0' },
            },
          ],
          errorMappers: [
            declarativeContribution('DeclarativeRuntimeErrorMapperContribution', 'build-mismatch'),
          ],
          weaponCatalogs: [
            declarativeContribution('DeclarativeRuntimeWeaponCatalogContribution', 'weapons'),
          ],
        },
        server: {
          ...minimalContributions.server,
          rules: [declarativeContribution('DeclarativeServerRuleContribution', 'room-rules')],
          scoring: [declarativeContribution('DeclarativeServerScoringContribution', 'kill-score')],
          lootTables: [
            declarativeContribution('DeclarativeServerLootTableContribution', 'meadow-default'),
          ],
          matchmaking: [
            executableContribution(
              'ExecutableServerMatchmakingContribution',
              'public-br',
              'server.matchmaking',
            ),
          ],
          serverSystems: [
            executableContribution(
              'ExecutableServerSystemContribution',
              'safe-zone-damage',
              'server.systems.safeZoneDamage',
            ),
          ],
          roomRules: [declarativeContribution('DeclarativeServerRoomRuleContribution', 'br-room')],
          mapValidators: [
            executableContribution(
              'ExecutableServerMapValidatorContribution',
              'spawn-count',
              'server.validators.spawnCount',
            ),
          ],
          matchPhases: [
            declarativeContribution('DeclarativeServerMatchPhaseContribution', 'countdown'),
          ],
          replayWriters: [
            executableContribution(
              'ExecutableServerReplayWriterContribution',
              'binary-log',
              'server.replays.binaryLog',
            ),
          ],
        },
      },
      migrations: {
        entries: {
          map: {
            _tag: 'ExecutableSchemaMigrationChain',
            kind: 'executable',
            latestVersion: 2,
            chainEntry: './migrations/map.js',
          },
        },
      },
    });
  });

  it('rejects an unknown contribution kind', () => {
    expect(() =>
      Schema.decodeUnknownSync(PluginContributions)({
        ...minimalContributions,
        editor: {
          ...minimalContributions.editor,
          tabs: [{ _tag: 'UnknownContribution', id: 'x' }],
        },
      }),
    ).toThrow();
  });

  it('rejects invalid semver package versions', () => {
    expect(() => Schema.decodeUnknownSync(SemverString)('latest')).toThrow();
    expect(Schema.decodeUnknownSync(SemverString)('1.2.3')).toBe('1.2.3');
  });

  it('rejects invalid Tileborne engine ranges', () => {
    expect(() => Schema.decodeUnknownSync(SemverRangeString)('workspace:*')).toThrow();
    expect(Schema.decodeUnknownSync(SemverRangeString)('>=0.1.0 <1.0.0')).toBe('>=0.1.0 <1.0.0');
  });

  it('validates tiled import profile ids and duplicates', () => {
    expect(() =>
      Schema.decodeUnknownSync(PluginContributions)({
        ...minimalContributions,
        tiledImportProfiles: [{ id: 'Bad Id', displayName: 'Bad', transformPlan: 'x' }],
      }),
    ).toThrow();

    const contributions = Schema.decodeUnknownSync(PluginContributions)({
      ...minimalContributions,
      tiledImportProfiles: [
        { id: 'rpg-maker', displayName: 'RPG Maker', transformPlan: 'x' },
        { id: 'rpg-maker', displayName: 'RPG Maker 2', transformPlan: 'y' },
      ],
    });
    expect(() => validatePluginContributions(decodedPluginId, contributions)).toThrow(
      DuplicateContributionError,
    );
  });
});

describe('PluginPermission', () => {
  const permissions = [
    { _tag: 'ReadAssetPack', packId: undefined },
    { _tag: 'RegisterRuntimeSystem', systemId: undefined },
    { _tag: 'RegisterEditorTool', toolId: undefined },
    { _tag: 'RegisterServerRule', ruleId: undefined },
    { _tag: 'NetworkAccess', hosts: ['api.example.invalid'] },
    { _tag: 'FilesystemRead', paths: ['assets/**'] },
    { _tag: 'FilesystemWrite', paths: ['exports/**'] },
    { _tag: 'ValidateMap', profile: undefined },
    { _tag: 'ExportArtifact', formats: ['tileborne-json'] },
    { _tag: 'GenerateMap', generatorId: undefined },
    { _tag: 'ImportAsset', kinds: ['tileset'] },
    { _tag: 'PostProcessAssetPack', processorId: undefined },
  ] as const;

  it.each(permissions)('accepts %s', (permission) => {
    expect(Schema.decodeUnknownSync(PluginPermission)(permission)._tag).toBe(permission._tag);
  });

  it('rejects an unknown permission', () => {
    expect(() => Schema.decodeUnknownSync(PluginPermission)({ _tag: 'ShellAccess' })).toThrow();
  });

  it('exports concrete permission classes', () => {
    expect(ReadAssetPack.ast).toBeDefined();
    expect(RegisterRuntimeSystem.ast).toBeDefined();
    expect(RegisterEditorTool.ast).toBeDefined();
    expect(RegisterServerRule.ast).toBeDefined();
    expect(NetworkAccess.ast).toBeDefined();
    expect(FilesystemRead.ast).toBeDefined();
    expect(FilesystemWrite.ast).toBeDefined();
    expect(ValidateMap.ast).toBeDefined();
    expect(ExportArtifact.ast).toBeDefined();
    expect(GenerateMap.ast).toBeDefined();
    expect(ImportAsset.ast).toBeDefined();
    expect(PostProcessAssetPack.ast).toBeDefined();
  });
});

describe('Plugin API errors', () => {
  it('instantiates and decodes every tagged error', () => {
    const errors = [
      [
        InvalidPluginManifestError,
        new InvalidPluginManifestError({
          pluginId: Option.none(),
          message: 'invalid manifest',
        }),
      ],
      [
        MissingPermissionError,
        new MissingPermissionError({
          pluginId: decodedPluginId,
          permission: 'FilesystemRead',
          message: 'missing',
        }),
      ],
      [
        UnresolvedPluginDependencyError,
        new UnresolvedPluginDependencyError({
          pluginId: decodedPluginId,
          dependency: decodedPluginRef,
          message: 'dependency missing',
        }),
      ],
      [
        IncompatibleEngineVersionError,
        new IncompatibleEngineVersionError({
          pluginId: decodedPluginId,
          required: decodedEngineRange,
          actual: '0.1.0',
          message: 'incompatible',
        }),
      ],
      [
        DuplicateContributionError,
        new DuplicateContributionError({
          pluginId: decodedPluginId,
          contributionId: 'br.validate',
          message: 'duplicate contribution',
        }),
      ],
      [
        MigrationConflictError,
        new MigrationConflictError({
          pluginId: decodedPluginId,
          entity: 'map',
          fromVersion: 1,
          toVersion: 2,
          message: 'migration already registered',
        }),
      ],
    ] as const;

    for (const [schema, error] of errors) {
      const encoded = Schema.encodeSync(schema)(error);
      expect(Schema.decodeUnknownSync(PluginApiError)(encoded)._tag).toBe(error._tag);
    }
  });
});
