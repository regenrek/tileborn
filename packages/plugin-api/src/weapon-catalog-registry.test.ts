import { WeaponDefinition } from '@tileborne/simulation';
import { Option, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  decodeWeaponCatalog,
  DuplicateWeaponDefinitionError,
  mergeWeaponCatalogs,
  WeaponCatalog,
  WeaponCatalogContributionValidationError,
  type WeaponCatalogContributionInput,
} from './weapon-catalog-registry.js';

const WEAPON_A = 'weapon:0b1e7e6e-9c4a-4f1e-8a2b-2f1c3d4e5f60';
const WEAPON_B = 'weapon:0b1e7e6e-9c4a-4f1e-8a2b-2f1c3d4e5f61';
const STATUS_A = 'status:0b1e7e6e-9c4a-4f1e-8a2b-2f1c3d4e5f70';

const projectileDelivery = (damage = 25) => ({
  _tag: 'ProjectileDelivery',
  damage,
  speed: 4,
  ttlTicks: 60,
  radius: 0.5,
  falloff: { _tag: 'NoFalloff' },
  knockback: 0,
});

const weaponCatalogJson = (weaponId: string, deliveryDamage = 25) => ({
  schemaVersion: 1,
  weapons: [
    {
      weapon: {
        id: weaponId,
        damage: 25,
        cooldownTicks: 6,
        magazineSize: 12,
        reloadTicks: 30,
      },
      delivery: projectileDelivery(deliveryDamage),
      appliesStatus: [STATUS_A],
    },
  ],
});

const weaponCatalogJsonWith = (
  weaponId: string,
  weaponOverrides: Partial<{
    damage: number;
    cooldownTicks: number;
    magazineSize: number;
    reloadTicks: number;
  }>,
) => ({
  schemaVersion: 1,
  weapons: [
    {
      weapon: {
        id: weaponId,
        damage: 25,
        cooldownTicks: 6,
        magazineSize: 12,
        reloadTicks: 30,
        ...weaponOverrides,
      },
      delivery: projectileDelivery(),
      appliesStatus: [STATUS_A],
    },
  ],
});

describe('decodeWeaponCatalog', () => {
  it('decodes a valid weapon pack into typed WeaponDefinition / DamageDelivery', () => {
    const result = decodeWeaponCatalog('c1', weaponCatalogJson(WEAPON_A));
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      const entry = result.success.weapons[0];
      expect(entry?.weapon).toBeInstanceOf(WeaponDefinition);
      expect(entry?.weapon.magazineSize).toBe(12);
      expect(entry?.delivery._tag).toBe('ProjectileDelivery');
      expect(Option.isSome(entry?.appliesStatus ?? Option.none())).toBe(true);
    }
  });

  it('fails on an unknown delivery family', () => {
    const result = decodeWeaponCatalog('c1', {
      schemaVersion: 1,
      weapons: [
        {
          weapon: { id: WEAPON_A, damage: 25, cooldownTicks: 6, magazineSize: 12, reloadTicks: 30 },
          delivery: { _tag: 'NopeDelivery', damage: 25 },
          appliesStatus: undefined,
        },
      ],
    });
    expect(Result.isFailure(result)).toBe(true);
  });

  it('fails when a required weapon field is missing', () => {
    const result = decodeWeaponCatalog('c1', {
      schemaVersion: 1,
      weapons: [
        {
          weapon: { id: WEAPON_A, damage: 25, cooldownTicks: 6, reloadTicks: 30 },
          delivery: projectileDelivery(),
          appliesStatus: undefined,
        },
      ],
    });
    expect(Result.isFailure(result)).toBe(true);
  });

  it('fails when the weapon id carries the wrong brand', () => {
    const result = decodeWeaponCatalog('c1', weaponCatalogJson('not-a-weapon-id'));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe('InvalidWeaponCatalogContributionError');
    }
  });

  it('round-trips through encode/decode', () => {
    const decoded = decodeWeaponCatalog('c1', weaponCatalogJson(WEAPON_A));
    expect(Result.isSuccess(decoded)).toBe(true);
    if (Result.isSuccess(decoded)) {
      const encoded = Schema.encodeUnknownSync(WeaponCatalog)(decoded.success);
      const reDecoded = Schema.decodeUnknownSync(WeaponCatalog)(encoded);
      expect(reDecoded.weapons[0]?.weapon.id).toBe(WEAPON_A);
      expect(reDecoded.weapons[0]?.delivery._tag).toBe('ProjectileDelivery');
    }
  });
});

describe('mergeWeaponCatalogs', () => {
  const contribution = (weaponId: string, deliveryDamage = 25): WeaponCatalogContributionInput => {
    const decoded = decodeWeaponCatalog(weaponId, weaponCatalogJson(weaponId, deliveryDamage));
    if (Result.isFailure(decoded)) {
      throw new Error('fixture failed to decode');
    }
    return { contributionId: weaponId, catalog: decoded.success };
  };

  it('merges distinct weapon catalogs', () => {
    const result = mergeWeaponCatalogs([contribution(WEAPON_A), contribution(WEAPON_B)]);
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.weapons).toHaveLength(2);
      expect(result.success.byId.size).toBe(2);
    }
  });

  it('detects duplicate weapon-definition ids across catalogs', () => {
    const result = mergeWeaponCatalogs([contribution(WEAPON_A), contribution(WEAPON_A)]);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(DuplicateWeaponDefinitionError);
    }
  });

  it('rejects a structurally invalid delivery (decodes but fails validation)', () => {
    const decoded = decodeWeaponCatalog(WEAPON_A, weaponCatalogJson(WEAPON_A, -5));
    expect(Result.isSuccess(decoded)).toBe(true);
    if (Result.isSuccess(decoded)) {
      const result = mergeWeaponCatalogs([{ contributionId: WEAPON_A, catalog: decoded.success }]);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(WeaponCatalogContributionValidationError);
      }
    }
  });

  const expectWeaponInvariantRejection = (
    weaponOverrides: Partial<{
      damage: number;
      cooldownTicks: number;
      magazineSize: number;
      reloadTicks: number;
    }>,
  ) => {
    const decoded = decodeWeaponCatalog(WEAPON_A, weaponCatalogJsonWith(WEAPON_A, weaponOverrides));
    expect(Result.isSuccess(decoded)).toBe(true);
    if (Result.isFailure(decoded)) {
      return;
    }
    const result = mergeWeaponCatalogs([
      { contributionId: 'c-invariant', catalog: decoded.success },
    ]);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(WeaponCatalogContributionValidationError);
      if (result.failure._tag === 'WeaponCatalogContributionValidationError') {
        expect(result.failure.contributionId).toBe('c-invariant');
        expect(result.failure.issues.some((issue) => issue.includes(WEAPON_A))).toBe(true);
      }
    }
  };

  it('rejects a weapon with negative damage (decodes but fails invariant validation)', () => {
    expectWeaponInvariantRejection({ damage: -5 });
  });

  it('rejects a weapon with magazineSize 0', () => {
    expectWeaponInvariantRejection({ magazineSize: 0 });
  });

  it('rejects a weapon with negative cooldownTicks', () => {
    expectWeaponInvariantRejection({ cooldownTicks: -1 });
  });

  it('rejects a weapon with negative reloadTicks', () => {
    expectWeaponInvariantRejection({ reloadTicks: -1 });
  });

  it('merges a fully valid weapon (guards against over-rejection)', () => {
    const decoded = decodeWeaponCatalog(
      WEAPON_A,
      weaponCatalogJsonWith(WEAPON_A, {
        damage: 0,
        cooldownTicks: 0,
        magazineSize: 1,
        reloadTicks: 0,
      }),
    );
    expect(Result.isSuccess(decoded)).toBe(true);
    if (Result.isSuccess(decoded)) {
      const result = mergeWeaponCatalogs([{ contributionId: 'c-valid', catalog: decoded.success }]);
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect(result.success.byId.get(WEAPON_A)?.weapon.id).toBe(WEAPON_A);
      }
    }
  });
});
