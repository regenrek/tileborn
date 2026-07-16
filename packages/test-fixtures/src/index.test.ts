import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  FIXTURE_CATEGORIES,
  fixtureExists,
  getFixturePath,
  getSampleAssetPackPath,
  listFixtures,
  SAMPLE_ASSET_PACK_DIR,
} from './index.js';

describe('@tileborne/test-fixtures', () => {
  it('lists fixtures in every category', () => {
    for (const category of FIXTURE_CATEGORIES) {
      const entries = listFixtures(category);
      expect(entries.length).toBeGreaterThan(0);
    }
  });

  it('resolves smoke plugin and asset pack paths', () => {
    expect(getFixturePath('plugins', 'smoke-fixture', 'tileborne-plugin.json')).toContain(
      'tileborne-plugin.json',
    );
    expect(getFixturePath('asset-packs', 'smoke-pack', 'tileborne-asset-pack.json')).toContain(
      'tileborne-asset-pack.json',
    );
  });

  it('lists and resolves the sample asset pack fixture', () => {
    expect(listFixtures('asset-packs')).toContain(SAMPLE_ASSET_PACK_DIR);
    expect(getSampleAssetPackPath()).toContain(path.join('asset-packs', SAMPLE_ASSET_PACK_DIR));
  });

  it('ships the complete project schema-compatibility matrix', () => {
    expect(listFixtures('projects')).toContain('schema-compatibility');
    for (const fixture of ['legacy-v0', 'current-v1', 'future-v2', 'invalid-version', 'corrupt']) {
      expect(
        fixtureExists('projects', 'schema-compatibility', fixture, 'project.json'),
        fixture,
      ).toBe(true);
    }
    expect(fixtureExists('projects', 'schema-compatibility', 'PROVENANCE.md')).toBe(true);
    for (const fixture of [
      'legacy-catalog.json',
      'current-v1.json',
      'future-v2.json',
      'corrupt.json',
    ]) {
      expect(
        fixtureExists('projects', 'schema-compatibility', 'project-content', fixture),
        fixture,
      ).toBe(true);
    }
  });

  it('ships the complete persisted-map schema-compatibility matrix', () => {
    expect(listFixtures('maps')).toContain('schema-compatibility');
    for (const fixture of ['legacy-shape', 'current-v1', 'future-v2', 'corrupt']) {
      expect(fixtureExists('maps', 'schema-compatibility', fixture, 'map.json'), fixture).toBe(
        true,
      );
    }
    expect(fixtureExists('maps', 'schema-compatibility', 'PROVENANCE.md')).toBe(true);
  });
});
