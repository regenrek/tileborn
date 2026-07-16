import { RUNTIME_MAP_PACKAGE_SCHEMA_VERSION } from '@tileborne/core';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  RUNTIME_MAP_PACKAGE_ENTRY_FILES,
  RUNTIME_MAP_PACKAGE_MANIFEST_FILE,
  hashRuntimeMapPackageEntry,
  loadRuntimeMapPackage,
  type RuntimeMapPackageEntryReader,
} from './loader.js';

const UUID = '12345678-1234-4234-8234-123456789abc';
const HASH = `sha256:${'a'.repeat(64)}`;
const PLUGIN = '@tileborne-plugins/example-mode';

const mapJson = {
  id: `map:${UUID}`,
  schemaVersion: 1,
  size: { width: 8, height: 8 },
  tileSize: { width: 32, height: 32 },
  layers: [],
  objects: [],
  properties: { [PLUGIN]: { maxPlayers: 4 } },
};

const catalogJson = [
  {
    origin: { _tag: 'plugin', pluginId: PLUGIN },
    objectType: {
      id: `gobj:${UUID}`,
      schemaVersion: 1,
      label: 'Spawn Pad',
      family: 'spawn',
      components: [{ _tag: 'spawn-point', data: {} }],
      instanceDefaults: {},
    },
  },
];

const placementsJson = [{ objectId: `object:${UUID}`, typeId: `gobj:${UUID}`, x: 3, y: 4 }];

const entryJson: Record<keyof typeof RUNTIME_MAP_PACKAGE_ENTRY_FILES, unknown> = {
  map: mapJson,
  catalog: catalogJson,
  placements: placementsJson,
  settings: { [PLUGIN]: { maxPlayers: 4 } },
  content: { schemaVersion: 1, items: [], lootTables: [], weapons: [], provenance: {} },
  behaviors: { schemaVersion: 1, manifests: [], visualDefinitions: [], modules: [] },
  visuals: { playerModels: [], overlayVisuals: [], weaponVisuals: [] },
  assets: [{ path: 'assets/ab/cdef.png', hash: HASH, assetId: `asset:${UUID}` }],
  modeData: { [PLUGIN]: { zone: { phases: 3 } } },
};

const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));

const buildPackageFiles = async (
  manifestOverrides: Record<string, unknown> = {},
): Promise<Map<string, Uint8Array>> => {
  const files = new Map<string, Uint8Array>();
  const entryHashes: Record<string, string> = {};
  for (const [entryName, fileName] of Object.entries(RUNTIME_MAP_PACKAGE_ENTRY_FILES)) {
    const bytes = encode(entryJson[entryName as keyof typeof RUNTIME_MAP_PACKAGE_ENTRY_FILES]);
    files.set(fileName, bytes);
    entryHashes[entryName] = await hashRuntimeMapPackageEntry(bytes);
  }
  files.set(
    RUNTIME_MAP_PACKAGE_MANIFEST_FILE,
    encode({
      packageId: `mappkg:${UUID}`,
      schemaVersion: RUNTIME_MAP_PACKAGE_SCHEMA_VERSION,
      projectId: `project:${UUID}`,
      mapId: `map:${UUID}`,
      activeMode: PLUGIN,
      playerCapacity: 4,
      engineVersion: '0.1.0',
      createdAt: '2026-06-10T12:00:00.000Z',
      entryHashes,
      ...manifestOverrides,
    }),
  );
  return files;
};

const readerFor =
  (files: Map<string, Uint8Array>): RuntimeMapPackageEntryReader =>
  (entryPath) =>
    Promise.resolve(files.get(entryPath));

describe('loadRuntimeMapPackage (ADR-0030)', () => {
  it('loads, verifies, and decodes a full package through the injected reader', async () => {
    const files = await buildPackageFiles();
    const result = await loadRuntimeMapPackage(readerFor(files));
    const loaded = Result.getOrThrow(result);
    expect(loaded.manifest.packageId).toBe(`mappkg:${UUID}`);
    expect(loaded.map.size.width).toBe(8);
    expect(loaded.catalog).toHaveLength(1);
    expect(loaded.placements[0]?.typeId).toBe(`gobj:${UUID}`);
    expect(loaded.assets[0]?.path).toBe('assets/ab/cdef.png');
    expect(loaded.content).toEqual({
      schemaVersion: 1,
      items: [],
      lootTables: [],
      weapons: [],
      provenance: {},
    });
    expect(loaded.behaviors.modules).toEqual([]);
    expect(loaded.modeData[PLUGIN]).toEqual({ zone: { phases: 3 } });
  });

  it('refuses a package written by a different schema version', async () => {
    const files = await buildPackageFiles({ schemaVersion: 999 });
    const result = await loadRuntimeMapPackage(readerFor(files));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.reason).toBe('version');
    }
  });

  it('classifies a malformed schema version as schema rather than version drift', async () => {
    const files = await buildPackageFiles({ schemaVersion: '999' });
    const result = await loadRuntimeMapPackage(readerFor(files));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.reason).toBe('schema');
    }
  });

  it('fails with integrity when an entry was tampered after assembly', async () => {
    const files = await buildPackageFiles();
    files.set(
      RUNTIME_MAP_PACKAGE_ENTRY_FILES.map,
      encode({ ...mapJson, size: { width: 999, height: 8 } }),
    );
    const result = await loadRuntimeMapPackage(readerFor(files));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.reason).toBe('integrity');
    }
  });

  it('fails with integrity when the manifest lacks a hash for a section entry', async () => {
    const files = await buildPackageFiles();
    const manifestBytes = files.get(RUNTIME_MAP_PACKAGE_MANIFEST_FILE);
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as {
      entryHashes: Record<string, string>;
    };
    delete manifest.entryHashes.settings;
    files.set(RUNTIME_MAP_PACKAGE_MANIFEST_FILE, encode(manifest));
    const result = await loadRuntimeMapPackage(readerFor(files));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.reason).toBe('integrity');
      expect(result.failure.message).toContain('settings.json');
    }
  });

  it('fails with schema when a package entry is missing', async () => {
    const files = await buildPackageFiles();
    files.delete(RUNTIME_MAP_PACKAGE_ENTRY_FILES.placements);
    const result = await loadRuntimeMapPackage(readerFor(files));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.reason).toBe('schema');
      expect(result.failure.message).toContain('placements.json');
    }
  });

  it('fails with schema when the manifest is missing or undecodable', async () => {
    const empty = await loadRuntimeMapPackage(() => Promise.resolve(undefined));
    expect(Result.isFailure(empty)).toBe(true);
    if (Result.isFailure(empty)) {
      expect(empty.failure.reason).toBe('schema');
    }

    const files = await buildPackageFiles({ packageId: 'mappkg:not-a-uuid' });
    const malformed = await loadRuntimeMapPackage(readerFor(files));
    expect(Result.isFailure(malformed)).toBe(true);
    if (Result.isFailure(malformed)) {
      expect(malformed.failure.reason).toBe('schema');
    }
  });
});
