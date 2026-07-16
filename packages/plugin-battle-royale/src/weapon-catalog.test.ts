import { decodeWeaponCatalog, mergeWeaponCatalogs } from '@tileborne/plugin-api';
import { Result } from 'effect';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { PROJECTILE } from './constants.js';
import { DEFAULT_BATTLE_ROYALE_CONFIG } from './battle-royale-config.js';
import {
  BR_PRIMARY_WEAPON_ID,
  BR_WEAPON_CATALOG_CONTRIBUTION_ID,
  buildBattleRoyaleWeaponCatalogData,
  resolveBattleRoyaleWeaponEntry,
} from './weapon-catalog.js';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

const readManifestWeaponCatalogData = (): unknown => {
  const manifestPath = path.join(packageRoot, '../tileborne-plugin.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    contributes?: {
      runtime?: {
        weaponCatalogs?: readonly { readonly id: string; readonly data: unknown }[];
      };
    };
  };
  const contribution = manifest.contributes?.runtime?.weaponCatalogs?.find(
    (entry) => entry.id === BR_WEAPON_CATALOG_CONTRIBUTION_ID,
  );
  if (!contribution) {
    throw new Error('battle-royale manifest is missing the weapon-catalog contribution');
  }
  return contribution.data;
};

describe('battle royale weapon catalog contribution', () => {
  it('decodes the manifest weaponCatalogs slot data against the @tileborne/simulation schemas', () => {
    const decoded = decodeWeaponCatalog(
      BR_WEAPON_CATALOG_CONTRIBUTION_ID,
      readManifestWeaponCatalogData(),
    );
    expect(Result.isSuccess(decoded)).toBe(true);
    if (Result.isSuccess(decoded)) {
      const entry = decoded.success.weapons[0];
      expect(entry?.weapon.id).toBe(BR_PRIMARY_WEAPON_ID);
      expect(entry?.delivery._tag).toBe('ProjectileDelivery');
    }
  });

  it('merges the manifest weapon pack through the typed registry without errors', () => {
    const decoded = decodeWeaponCatalog(
      BR_WEAPON_CATALOG_CONTRIBUTION_ID,
      readManifestWeaponCatalogData(),
    );
    expect(Result.isSuccess(decoded)).toBe(true);
    if (Result.isFailure(decoded)) {
      return;
    }
    const merged = mergeWeaponCatalogs([
      { contributionId: BR_WEAPON_CATALOG_CONTRIBUTION_ID, catalog: decoded.success },
    ]);
    expect(Result.isSuccess(merged)).toBe(true);
    if (Result.isSuccess(merged)) {
      expect(merged.success.byId.get(BR_PRIMARY_WEAPON_ID)?.weapon.id).toBe(BR_PRIMARY_WEAPON_ID);
    }
  });

  it('keeps the manifest data in sync with the runtime builder for the default config', () => {
    const manifestData = readManifestWeaponCatalogData();
    const builtData = buildBattleRoyaleWeaponCatalogData(DEFAULT_BATTLE_ROYALE_CONFIG);
    expect(manifestData).toEqual(builtData);
  });

  it("resolves the runtime weapon entry carrying BR's balance numbers", () => {
    const entry = resolveBattleRoyaleWeaponEntry(DEFAULT_BATTLE_ROYALE_CONFIG);
    expect(entry.weapon.damage).toBe(PROJECTILE.damage);
    expect(entry.weapon.cooldownTicks).toBe(PROJECTILE.shootCooldownTicks);
    expect(entry.delivery._tag).toBe('ProjectileDelivery');
    if (entry.delivery._tag === 'ProjectileDelivery') {
      expect(entry.delivery.ttlTicks).toBe(PROJECTILE.ttlTicks);
      // Engine-native per-tick speed = world units/sec ÷ tickRate.
      expect(entry.delivery.speed).toBeCloseTo(
        PROJECTILE.speed / DEFAULT_BATTLE_ROYALE_CONFIG.tickRate,
      );
    }
  });
});
