import {
  VisualAssetRoleRef,
  WELL_KNOWN_VISUAL_ROLE_KINDS,
  type ProjectManifest,
} from '@tileborne/core';
import {
  BATTLE_ROYALE_VISUAL_ROLE_POLICY,
  DEFAULT_BATTLE_ROYALE_VISUAL_ASSET_ROLES,
} from '@tileborne/plugin-battle-royale/visual-roles';
import { describe, expect, it } from 'vitest';

import {
  resolveVisualRolePolicy,
  type VisualRolePolicyContribution,
} from './visual-role-policy';

const customProjectile = new VisualAssetRoleRef({
  ...DEFAULT_BATTLE_ROYALE_VISUAL_ASSET_ROLES.find(
    (role) => role.roleKind === WELL_KNOWN_VISUAL_ROLE_KINDS.projectile,
  )!,
  id: 'visual-role:projectile',
  label: 'Custom projectile',
});

const customPolicy: VisualRolePolicyContribution = {
  pluginId: 'plugin-custom',
  placeholderRoleIds: ['visual-role:placeholder'],
  resolveRoles: () => [customProjectile],
};

describe('resolveVisualRolePolicy', () => {
  it('returns the first enabled visual-role policy', () => {
    const resolved = resolveVisualRolePolicy(
      ['plugin-custom'],
      [customPolicy, BATTLE_ROYALE_VISUAL_ROLE_POLICY],
      {},
    );

  expect(resolved?.pluginId).toBe('plugin-custom');
  expect(resolved?.roles).toEqual([customProjectile]);
  expect(resolved?.roleDefinitions).toEqual([
    { kind: customProjectile.roleKind, label: customProjectile.label },
  ]);
  expect(resolved?.placeholderRoleIds).toEqual(['visual-role:placeholder']);
  });

  it('exposes Battle Royale default visual roles when BR is enabled', () => {
    const resolved = resolveVisualRolePolicy(
      [BATTLE_ROYALE_VISUAL_ROLE_POLICY.pluginId],
      [BATTLE_ROYALE_VISUAL_ROLE_POLICY],
      { project: undefined as ProjectManifest | undefined },
    );

    expect(resolved?.roles.map((role) => role.roleKind)).toEqual(
      DEFAULT_BATTLE_ROYALE_VISUAL_ASSET_ROLES.map((role) => role.roleKind),
    );
    expect(
      resolved?.roleDefinitions.find(
        (definition) => definition.kind === WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon,
      )?.requiredAnchors?.map((anchor) => anchor.id),
    ).toEqual(['hand', 'muzzle']);
    const defaultWeapon = DEFAULT_BATTLE_ROYALE_VISUAL_ASSET_ROLES.find(
      (role) => role.roleKind === WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon,
    );
    expect(
      resolved?.roles.find((role) => role.roleKind === WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon)
        ?.label,
    ).toBe(defaultWeapon?.label);
  });
});
