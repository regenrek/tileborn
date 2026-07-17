import {
  PROJECT_STARTUP_MAP_SETTINGS_KEY,
  ProjectManifest,
  makeMapId,
  makeProjectId,
  type Uuid,
} from '@tileborne/core';
import { describe, expect, it } from 'vitest';

import {
  defaultGameModeStarterRegistration,
  resolveGameModeStarterRegistration,
} from './game-mode-starter-registrations.js';

const project = new ProjectManifest({
  id: makeProjectId('550e8400-e29b-41d4-a716-446655440010' as Uuid),
  name: 'Starter proof',
  schemaVersion: 1,
  engineVersion: '0.1.0',
  plugins: [],
  assetPacks: [],
  maps: [],
});
const mapId = makeMapId('550e8400-e29b-41d4-a716-446655440011' as Uuid);

describe('bundled game-mode starter registrations', () => {
  it('preserves Battle Royale as the New Game default without exposing it to orchestration', () => {
    const registration = defaultGameModeStarterRegistration();
    expect(registration.capabilityId).toBe('battle-royale.starter');
    expect(registration.assetPacks).toHaveLength(1);
  });

  it('creates a complete Example Arena starter through the same contract', () => {
    const registration = resolveGameModeStarterRegistration('example-arena.starter');
    expect(registration).toBeDefined();
    if (registration === undefined) return;

    const authored = registration.applyProject(project, {
      idempotencyKey: 'arena-proof',
      starterMapId: String(mapId),
    });
    const map = registration.createMap(mapId, 'arena-proof');
    expect(authored.settings?.activeGameMode).toBe('@tileborne-plugins/example-arena');
    expect(authored.settings?.[PROJECT_STARTUP_MAP_SETTINGS_KEY]).toBe(String(mapId));
    expect(registration.readIdempotencyKey(authored)).toBe('arena-proof');
    expect(map.properties.starterTemplateId).toBe('example-arena-starter-v1');
    expect(map.properties['@tileborne-plugins/example-arena']).toEqual({
      arenaRadius: 32,
      enemyCount: 8,
    });
  });
});
