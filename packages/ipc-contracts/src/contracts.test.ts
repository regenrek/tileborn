import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeProjectId, ProjectManifest } from '@tileborne/core';

import {
  MainIpcContracts,
  MainIpcRegistry,
  MapsSetMapTilesetPackContract,
  PluginsListContributionsContract,
  ProjectsCreateContract,
  ProjectsGetContract,
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
    expect(MainIpcContracts).toHaveLength(93);
    expect(MainIpcRegistry.byChannel['tileborne:projects:get']).toBe(ProjectsGetContract);
    expect(MainIpcRegistry.byChannel['tileborne:maps:setMapTilesetPack']).toBe(
      MapsSetMapTilesetPackContract,
    );
    expect(MainIpcRegistry.byChannel['tileborne:system:ping']).toBe(SystemPingContract);
    expect(MainIpcRegistry.byChannel['tileborne:plugins:listContributions']).toBe(
      PluginsListContributionsContract,
    );
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
          hasAuthoringPanel: true,
        },
      ],
    });
  });

});
