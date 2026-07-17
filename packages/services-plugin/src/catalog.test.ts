import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { gameObjectTypeIdForKey } from '@tileborne/core';
import {
  mergeGameObjectCatalogs,
  mergeWeaponCatalogs,
  PluginManifest,
} from '@tileborne/plugin-api';
import { Effect, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { resolvePluginGameObjectCatalogs, resolvePluginWeaponCatalogs } from './catalog.js';
import { materializePluginManifestInput } from './filesystem.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const battleRoyaleRoot = path.join(repoRoot, 'packages/plugin-battle-royale');
const expectedBattleRoyaleObjectTypes = [
  { family: 'spawn', label: 'Spawn Point' },
  { family: 'zone', label: 'Shrink Zone Anchor' },
  { family: 'loot', label: 'Loot Crate' },
  { family: 'hazard', label: 'Trap' },
  { family: 'prop', label: 'Decoy' },
  { family: 'obstacle', label: 'Barrier' },
  { family: 'weapon', label: 'Pulse Carbine' },
  { family: 'projectile', label: 'Projectile Bolt' },
  { family: 'vfx', label: 'Muzzle Flash' },
  { family: 'vfx', label: 'Impact Burst' },
  { family: 'vfx', label: 'Shield Bubble' },
  { family: 'vfx', label: 'Player Shadow' },
  { family: 'vfx', label: 'Hazard Flame' },
];

/** Decode the shipped Battle Royale manifest the same way the registry does. */
const battleRoyaleManifest = (): PluginManifest => {
  const raw: unknown = JSON.parse(
    readFileSync(path.join(battleRoyaleRoot, 'tileborne-plugin.json'), 'utf8'),
  );
  return Schema.decodeUnknownSync(PluginManifest)(materializePluginManifestInput(raw));
};

describe('resolvePluginGameObjectCatalogs (real Battle Royale manifest)', () => {
  it("resolves the contribution's `data.indexPath` into a decoded catalog", async () => {
    const manifest = battleRoyaleManifest();

    const contributions = await Effect.runPromise(
      resolvePluginGameObjectCatalogs(battleRoyaleRoot, manifest),
    );

    expect(contributions).toHaveLength(1);
    expect(contributions[0]?.contributionId).toBe('br-game-object-catalog');
    expect(
      contributions[0]?.catalog.objectTypes.map(({ family, label }) => ({ family, label })),
    ).toEqual(expectedBattleRoyaleObjectTypes);
  });

  it('merges the resolved catalog with the expected object-type ids', async () => {
    const manifest = battleRoyaleManifest();
    const contributions = await Effect.runPromise(
      resolvePluginGameObjectCatalogs(battleRoyaleRoot, manifest),
    );

    const merged = mergeGameObjectCatalogs(contributions);
    expect(Result.isSuccess(merged)).toBe(true);
    if (Result.isSuccess(merged)) {
      expect(merged.success.byId.has(gameObjectTypeIdForKey('spawn-point'))).toBe(true);
      expect(merged.success.byId.has(gameObjectTypeIdForKey('shrink-zone-anchor'))).toBe(true);
      expect(merged.success.byId.has(gameObjectTypeIdForKey('loot-crate'))).toBe(true);
    }
  });
});

describe('resolvePluginWeaponCatalogs (real Battle Royale manifest)', () => {
  it("resolves the contribution's inline `data` into a decoded weapon catalog", async () => {
    const manifest = battleRoyaleManifest();

    const contributions = await Effect.runPromise(
      resolvePluginWeaponCatalogs(battleRoyaleRoot, manifest),
    );

    expect(contributions).toHaveLength(1);
    expect(contributions[0]?.contributionId).toBe('br-weapon-catalog');
    expect(contributions[0]?.catalog.weapons).toHaveLength(1);
  });

  it('merges the resolved weapon catalog with the expected weapon-definition id', async () => {
    const manifest = battleRoyaleManifest();
    const contributions = await Effect.runPromise(
      resolvePluginWeaponCatalogs(battleRoyaleRoot, manifest),
    );

    const merged = mergeWeaponCatalogs(contributions);
    expect(Result.isSuccess(merged)).toBe(true);
    if (Result.isSuccess(merged)) {
      expect(merged.success.weapons).toHaveLength(1);
      expect(merged.success.byId.has('weapon:00000000-0000-4000-8000-000000000001')).toBe(true);
    }
  });

  it('returns an empty list when the plugin contributes no weapon catalogs', async () => {
    const manifest = Schema.decodeUnknownSync(PluginManifest)(
      materializePluginManifestInput({
        schemaVersion: 1,
        id: '@tileborne-plugins/no-weapons',
        name: '@tileborne-plugins/no-weapons',
        version: '0.1.0',
        displayName: 'No Weapons',
        description: 'Plugin without weapon catalogs.',
        author: 'Tileborne',
        license: 'MIT',
        engines: { tileborne: '^0.1.0' },
        contributes: {},
        permissions: [],
        dependsOn: [],
      }),
    );

    const contributions = await Effect.runPromise(
      resolvePluginWeaponCatalogs(battleRoyaleRoot, manifest),
    );

    expect(contributions).toHaveLength(0);
  });
});
