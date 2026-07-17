import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { PERSISTED_SCHEMA_REGISTRY } from '../packages/core/src/versioning/persisted-schema-registry.js';

const expectedRestartPersistentIds = [
  'assetLibraryIndex',
  'assetPackIntegrityLock',
  'battleRoyaleLoadoutSelection',
  'behaviorDefinition',
  'behaviorManifest',
  'behaviorRegistryCatalog',
  'brandConfig',
  'buildAndExportArtifactMetadata',
  'bundledGameManifest',
  'documentRecovery',
  'editorTilesetIndex',
  'editorUiStore',
  'gameObjectCatalog',
  'genericAssetPackManifest',
  'lobbyModelSelection',
  'lobbyReconnect',
  'persistentJobRecord',
  'pluginArchiveSidecar',
  'pluginInstallLock',
  'pluginManifest',
  'projectAssetIndex',
  'projectBehaviorRegistry',
  'projectBehaviorTransaction',
  'projectContent',
  'projectImportRecords',
  'projectIntegrityLock',
  'projectManifest',
  'projectRegistry',
  'projectRevisionJournal',
  'projectRevisionOwner',
  'roomStorage',
  'runtimeBehaviorPackage',
  'runtimeMapPackage',
  'runtimeProjectContent',
  'thinGameProjectConfig',
  'thumbnailCache',
  'tilePaletteMetadata',
  'tileborneConfig',
  'tileborneMap',
  'tilesetManifest',
  'userHudOverlay',
  'userInputOverlay',
  'weaponCatalog',
  'workingPaletteStore',
] as const;

describe('persisted schema registry repository audit', () => {
  it('covers the independently audited restart-persistent surfaces', () => {
    expect(PERSISTED_SCHEMA_REGISTRY.map(({ id }) => id).sort()).toEqual(
      [...expectedRestartPersistentIds].sort(),
    );
  });

  it('points every owner at an existing source file and symbol', () => {
    for (const registration of PERSISTED_SCHEMA_REGISTRY) {
      for (const owner of [registration.codecOwner, registration.migrationOwner]) {
        const [relativePath, symbol] = owner.split('#');
        const absolutePath = path.resolve(import.meta.dirname, '..', relativePath!);
        expect(existsSync(absolutePath), `${registration.id}: ${relativePath}`).toBe(true);
        if (symbol !== undefined) {
          expect(readFileSync(absolutePath, 'utf8'), `${registration.id}: ${symbol}`).toContain(
            symbol,
          );
        }
      }
    }
  });

  it('keeps the dependency-local foundation config version aligned', () => {
    const source = readFileSync(
      path.resolve(import.meta.dirname, '../packages/services-foundation/src/config/index.ts'),
      'utf8',
    );
    const match = source.match(/TILEBORNE_CONFIG_SCHEMA_VERSION = (\d+)/);
    expect(Number(match?.[1])).toBe(
      PERSISTED_SCHEMA_REGISTRY.find(({ id }) => id === 'tileborneConfig')?.currentVersion,
    );
  });

  it('keeps asset-library cache storage evidence aligned with its owner constants', () => {
    const source = readFileSync(
      path.resolve(import.meta.dirname, '../packages/services-app/src/asset-library/index.ts'),
      'utf8',
    );
    for (const [id, constant] of [
      ['assetLibraryIndex', 'ASSET_LIBRARY_CACHE_DIR'],
      ['editorTilesetIndex', 'EDITOR_INDEX_CACHE_DIR'],
    ] as const) {
      const value = source.match(new RegExp(`${constant} = '([^']+)'`))?.[1];
      expect(value, constant).toBeDefined();
      expect(PERSISTED_SCHEMA_REGISTRY.find((entry) => entry.id === id)?.storage).toContain(value);
    }
  });
});
