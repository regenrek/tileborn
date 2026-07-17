import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeProjectId, ProjectManifest } from '@tileborne/core';

import {
  MainIpcContracts,
  MainIpcRegistry,
  AssetLibraryGetPackUseSitesContract,
  MapsSetMapTilesetPackContract,
  PluginsListContributionsContract,
  ProjectsCreateContract,
  ProjectsCreateGameContract,
  ProjectsGetContract,
  ReadinessCheckContract,
  ShipStartContract,
  ShipGameArtifact,
  SystemPingContract,
} from './contracts/index.js';

const UUID = '550e8400-e29b-41d4-a716-446655440000';
const projectId = makeProjectId(UUID);

const roundTrip = <A, I>(schema: Schema.Top, value: I) => {
  const codec = schema as Schema.Codec<A, I, never, never>;
  const decoded = Schema.decodeUnknownSync(codec)(value);
  expect(Schema.encodeSync(codec)(decoded)).toEqual(value);
};

describe('main IPC contracts', () => {
  it('exports the main IPC registry', () => {
    expect(MainIpcContracts).toHaveLength(116);
    expect(MainIpcRegistry.byChannel['tileborne:asset-library:getPackUseSites']).toBe(
      AssetLibraryGetPackUseSitesContract,
    );
    expect(MainIpcRegistry.byChannel['tileborne:projects:get']).toBe(ProjectsGetContract);
    expect(MainIpcRegistry.byChannel['tileborne:maps:setMapTilesetPack']).toBe(
      MapsSetMapTilesetPackContract,
    );
    expect(MainIpcRegistry.byChannel['tileborne:system:ping']).toBe(SystemPingContract);
    expect(MainIpcRegistry.byChannel['tileborne:plugins:listContributions']).toBe(
      PluginsListContributionsContract,
    );
    expect(MainIpcRegistry.byChannel['tileborne:readiness:check']).toBe(ReadinessCheckContract);
    expect(MainIpcRegistry.byChannel['tileborne:ship:start']).toBe(ShipStartContract);
  });

  it('round-trips the guided ship request and canonical artifact', () => {
    const startupMapId = 'map:550e8400-e29b-41d4-a716-446655440001';
    roundTrip(ShipStartContract.request, { projectId, startupMapId, target: 'local' });
    roundTrip(ShipGameArtifact, {
      projectId,
      startupMapId,
      pluginId: 'tileborne.battle-royale',
      target: 'local',
      directory: '/tmp/game',
      manifestPath: '/tmp/game/manifest.json',
      bundlePath: '/tmp/game/worker.js',
      buildId: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      runtimeBuildId: 'sha256:3333333333333333333333333333333333333333333333333333333333333333',
      integrityHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      createdAt: '2026-07-14T00:00:00.000Z',
      files: ['worker.js'],
      fileHashes: {
        'worker.js': 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      },
      previewCommand: 'tileborne game serve --dir "/tmp/game"',
    });
  });

  it('round-trips projects.get request and response', () => {
    const manifest = new ProjectManifest({
      id: projectId,
      name: 'Example',
      schemaVersion: 1,
      engineVersion: '0.1.0',
      plugins: [],
      assetPacks: [],
      maps: [],
    });

    roundTrip(ProjectsGetContract.request, { projectId });
    roundTrip(ProjectsGetContract.response, { project: manifest });
  });

  it('round-trips projects.create request without optional engineVersion', () => {
    roundTrip(ProjectsCreateContract.request, { name: 'Example' });
    roundTrip(ProjectsCreateContract.request, { name: 'Example', engineVersion: '0.1.0' });
  });

  it('round-trips idempotent Battle Royale game creation', () => {
    roundTrip(ProjectsCreateGameContract.request, {
      name: 'Petwars',
      gameType: 'battle-royale',
      idempotencyKey: 'wizard-request-1',
    });
    roundTrip(ProjectsCreateGameContract.response, {
      projectId,
      mapId: 'map:550e8400-e29b-41d4-a716-446655440001',
      resumed: false,
    });
  });

  it('round-trips system.ping response', () => {
    roundTrip(SystemPingContract.response, {
      pong: true,
      ts: 1_714_000_000_000,
    });
  });

  it('round-trips plugin contribution listing response', () => {
    roundTrip(PluginsListContributionsContract.response, {
      panels: [
        {
          pluginId: '@tileborne-plugins/battle-royale',
          pluginName: 'Battle Royale',
          id: 'battle-royale-settings',
          zone: 'plugins',
          title: 'Battle Royale Settings',
          description: 'Configure battle royale gameplay.',
          group: 'gameplay',
          order: 10,
          capabilities: ['settings'],
          data: { indexPath: './panels/index.json' },
        },
      ],
      tools: [
        {
          pluginId: '@tileborne-plugins/battle-royale',
          pluginName: 'Battle Royale',
          id: 'battle-royale-spawn-tools',
          zone: 'working-palette',
          title: 'Battle Royale Spawn Tools',
          capabilities: ['spawn'],
        },
      ],
      gameModes: [
        {
          modeId: '@tileborne-plugins/battle-royale',
          pluginId: '@tileborne-plugins/battle-royale',
          label: 'Battle Royale Settings',
          runtimeSystemId: 'battle-royale-runtime',
          authoringSettingsPanelId: 'battle-royale-settings',
          gameSettingsFormId: 'battle-royale-settings-form',
          gameSettingsForm: {
            scope: 'map',
            invalidMessage: 'Battle Royale settings must be positive numbers.',
            fields: [
              {
                key: 'maxPlayers',
                label: 'Max players',
                min: 1,
                max: undefined,
                step: 1,
                default: 32,
              },
            ],
          },
          hudLayoutContributionId: 'br-hud-layout',
          hudLayout: {
            id: 'br-default-hud',
            widgets: [
              {
                id: 'minimap',
                kind: 'core.Minimap',
                anchor: 'top-right',
                order: 0,
                enabled: true,
              },
              {
                id: 'weapon-panel',
                kind: 'core.WeaponPanel',
                anchor: 'bottom-center',
                order: 1,
                enabled: true,
                offset: { x: 0, y: -8 },
              },
            ],
          },
          hasAuthoringPanel: true,
          creatorChecklistFacts: [],
        },
      ],
    });
  });
});
