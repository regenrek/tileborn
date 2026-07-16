import { describe, expect, it } from 'vitest';

import {
  PERSISTED_SCHEMA_REGISTRY,
  PERSISTED_SCHEMA_VERSIONS,
} from './persisted-schema-registry.js';
import { CORE_SCHEMA_VERSIONS } from './index.js';

describe('persisted schema registry', () => {
  it('preserves the deprecated public core version surface', () => {
    expect(CORE_SCHEMA_VERSIONS).toEqual({
      project: PERSISTED_SCHEMA_VERSIONS.projectManifest,
      map: PERSISTED_SCHEMA_VERSIONS.tileborneMap,
      assetPackManifest: 1,
      brandConfig: PERSISTED_SCHEMA_VERSIONS.brandConfig,
    });
  });

  it('registers every current-version constant exactly once', () => {
    const ids = PERSISTED_SCHEMA_REGISTRY.map((registration) => registration.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const [id, currentVersion] of Object.entries(PERSISTED_SCHEMA_VERSIONS)) {
      const registrations = PERSISTED_SCHEMA_REGISTRY.filter(
        (registration) => registration.id === id,
      );
      expect(registrations, id).toHaveLength(1);
      expect(registrations[0]?.currentVersion, id).toBe(currentVersion);
    }
  });

  it('declares an exact, internally coherent compatibility policy', () => {
    for (const registration of PERSISTED_SCHEMA_REGISTRY) {
      const { compatibility, currentVersion, id } = registration;
      expect(registration.codecOwner.length, `${id} codec owner`).toBeGreaterThan(0);
      expect(registration.migrationOwner.length, `${id} migration owner`).toBeGreaterThan(0);
      expect(new Set(compatibility.readableVersions).size, `${id} readable versions`).toBe(
        compatibility.readableVersions.length,
      );

      if (currentVersion === null) {
        expect(registration.versionLocation, id).toBe('unversioned');
        expect(compatibility.readableVersions, id).toEqual([]);
        expect(compatibility.older, id).toBe('not-applicable');
        continue;
      }

      expect(Number.isInteger(currentVersion), id).toBe(true);
      expect(currentVersion, id).toBeGreaterThanOrEqual(0);
      expect(compatibility.readableVersions, id).toContain(currentVersion);
      expect(
        compatibility.readableVersions.every(
          (version) => Number.isInteger(version) && version >= 0 && version <= currentVersion,
        ),
        id,
      ).toBe(true);

      if (compatibility.older === 'migrate') {
        expect(compatibility.readableVersions, id).toEqual(
          Array.from({ length: currentVersion }, (_, index) => index + 1),
        );
      }
    }
  });

  it('never treats authoring source corruption or future data as rebuildable/resettable', () => {
    for (const registration of PERSISTED_SCHEMA_REGISTRY.filter(
      ({ durability }) => durability === 'authoring-source',
    )) {
      expect(['refuse', 'restore-or-refuse'], registration.id).toContain(
        registration.compatibility.future,
      );
      expect(['refuse', 'restore-or-refuse'], registration.id).toContain(
        registration.compatibility.corrupt,
      );
    }
  });
});
