import { describe, expect, it } from 'vitest';
import { makeProjectId, ProjectManifest, ProjectPluginRef, type MapId } from '@tileborne/core';

import { PLUGIN_ID } from './constants.js';
import {
  applyBattleRoyaleStarterProject,
  BATTLE_ROYALE_STARTER_TEMPLATE_ID,
  createBattleRoyaleStarterMap,
  readBattleRoyaleStarterMetadata,
} from './starter.js';

const project = () =>
  new ProjectManifest({
    id: makeProjectId('550e8400-e29b-41d4-a716-446655440000'),
    name: 'Starter',
    schemaVersion: 1,
    engineVersion: '0.1.0',
    plugins: [new ProjectPluginRef({ id: PLUGIN_ID, version: '*' })],
    assetPacks: [],
    maps: [],
  });

describe('Battle Royale starter template', () => {
  it('applies attributable player, HUD, input and content defaults idempotently', () => {
    const once = applyBattleRoyaleStarterProject(project(), {
      idempotencyKey: 'request-1',
      starterMapId: 'map:550e8400-e29b-41d4-a716-446655440001',
    });
    const twice = applyBattleRoyaleStarterProject(once, {
      idempotencyKey: 'request-1',
      starterMapId: 'map:550e8400-e29b-41d4-a716-446655440001',
    });
    expect(twice).toEqual(once);
    expect(twice.settings?.activeGameMode).toBe(PLUGIN_ID);
    expect(twice.settings?.startupMapId).toBe('map:550e8400-e29b-41d4-a716-446655440001');
    expect(twice.settings?.shipTarget).toBe('local');
    expect(readBattleRoyaleStarterMetadata(twice)).toMatchObject({
      idempotencyKey: 'request-1',
      templateId: BATTLE_ROYALE_STARTER_TEMPLATE_ID,
      completed: true,
    });
  });

  it('builds a valid editable arena with spawns, shrink anchor and loot', () => {
    const map = createBattleRoyaleStarterMap(
      'map:550e8400-e29b-41d4-a716-446655440001' as MapId,
      'request-1',
    );
    expect(map.properties.starterTemplateId).toBe(BATTLE_ROYALE_STARTER_TEMPLATE_ID);
    expect(map.objects.length).toBeGreaterThan(10);
    expect(new Set(map.objects.map((object) => object.kind)).size).toBeGreaterThan(3);
  });
});
