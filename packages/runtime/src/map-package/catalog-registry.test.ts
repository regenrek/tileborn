import { GameObjectCatalog, GameObjectType, PluginId } from '@tileborne/core';
import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { buildRuntimeCatalogRegistry } from './catalog-registry.js';

const UUID = '12345678-1234-4234-8234-123456789abc';
const SPAWN_TYPE_ID = `gobj:${UUID}`;
const LOOT_TYPE_ID = `gobj:${UUID.replace('1234567', 'aaaaaaa')}`;

const pluginId = Schema.decodeUnknownSync(PluginId)('@tileborne-plugins/example-mode');
const otherPluginId = Schema.decodeUnknownSync(PluginId)('@tileborne-plugins/other-mode');

const objectTypeJson = (id: string, family: string, components: unknown[] = []) => ({
  id,
  schemaVersion: 1,
  label: `Type ${id}`,
  family,
  components,
  instanceDefaults: {},
});

const catalogOf = (catalogUuid: string, objectTypes: unknown[]): GameObjectCatalog =>
  Schema.decodeUnknownSync(GameObjectCatalog)({
    id: `catalog:${catalogUuid}`,
    schemaVersion: 1,
    objectTypes,
  });

const spawnCatalog = catalogOf(UUID, [
  objectTypeJson(SPAWN_TYPE_ID, 'spawn', [{ _tag: 'spawn-point', data: {} }]),
  objectTypeJson(LOOT_TYPE_ID, 'loot'),
]);

describe('buildRuntimeCatalogRegistry (ADR-0030)', () => {
  it('merges plugin catalogs and tags every entry with its plugin origin', () => {
    const result = buildRuntimeCatalogRegistry([
      { pluginId, catalogs: [{ contributionId: 'example/catalog', catalog: spawnCatalog }] },
    ]);
    expect(Result.isSuccess(result)).toBe(true);
    const registry = Result.getOrThrow(result);
    expect(registry.entries).toHaveLength(2);
    expect(registry.entries.map((entry) => entry.origin)).toEqual([
      { _tag: 'plugin', pluginId },
      { _tag: 'plugin', pluginId },
    ]);
  });

  it('appends project entries with project origin (new ids only)', () => {
    const projectNew = Schema.decodeUnknownSync(GameObjectType)(
      objectTypeJson(`gobj:${UUID.replace('1234567', 'bbbbbbb')}`, 'decor'),
    );
    const registry = Result.getOrThrow(
      buildRuntimeCatalogRegistry(
        [{ pluginId, catalogs: [{ contributionId: 'example/catalog', catalog: spawnCatalog }] }],
        [projectNew],
      ),
    );

    expect(registry.entries).toHaveLength(3);
    expect(registry.byId(projectNew.id)?.origin).toEqual({ _tag: 'project' });
    expect(registry.entries.find((entry) => entry.objectType.id === SPAWN_TYPE_ID)?.origin).toEqual(
      { _tag: 'plugin', pluginId },
    );
  });

  it('fails when a project entry shadows a plugin-owned id (no-shadowing rule)', () => {
    const shadowing = Schema.decodeUnknownSync(GameObjectType)(
      objectTypeJson(SPAWN_TYPE_ID, 'spawn', [{ _tag: 'spawn-point', data: { team: 'alpha' } }]),
    );
    const result = buildRuntimeCatalogRegistry(
      [{ pluginId, catalogs: [{ contributionId: 'example/catalog', catalog: spawnCatalog }] }],
      [shadowing],
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe('DuplicateCatalogObjectTypeError');
      expect(result.failure.message).toContain(SPAWN_TYPE_ID);
      expect(result.failure.message).toContain(pluginId);
    }
  });

  it('fails when two project entries reuse the same id', () => {
    const projectType = Schema.decodeUnknownSync(GameObjectType)(
      objectTypeJson(`gobj:${UUID.replace('1234567', 'bbbbbbb')}`, 'decor'),
    );
    const result = buildRuntimeCatalogRegistry(
      [{ pluginId, catalogs: [{ contributionId: 'example/catalog', catalog: spawnCatalog }] }],
      [projectType, projectType],
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe('DuplicateCatalogObjectTypeError');
      expect(result.failure.message).toContain('registered more than once');
    }
  });

  it('indexes entries by component tag and by family', () => {
    const registry = Result.getOrThrow(
      buildRuntimeCatalogRegistry([
        { pluginId, catalogs: [{ contributionId: 'example/catalog', catalog: spawnCatalog }] },
      ]),
    );
    expect(registry.byComponentTag('spawn-point').map((entry) => entry.objectType.id)).toEqual([
      SPAWN_TYPE_ID,
    ]);
    expect(registry.byFamily('loot').map((entry) => entry.objectType.id)).toEqual([LOOT_TYPE_ID]);
    expect(registry.byComponentTag('hazard')).toEqual([]);
  });

  it('fails when two plugins register the same object-type id (ADR-0019)', () => {
    const duplicate = catalogOf(UUID.replace('1234567', 'ccccccc'), [
      objectTypeJson(SPAWN_TYPE_ID, 'spawn'),
    ]);
    const result = buildRuntimeCatalogRegistry([
      { pluginId, catalogs: [{ contributionId: 'example/catalog', catalog: spawnCatalog }] },
      {
        pluginId: otherPluginId,
        catalogs: [{ contributionId: 'other/catalog', catalog: duplicate }],
      },
    ]);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe('DuplicateCatalogObjectTypeError');
    }
  });
});
