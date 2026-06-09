// @vitest-environment jsdom

import {
  AttachmentAnchor,
  RenderProfile,
  VisualAnchorPoint,
  VisualAssetRoleRef,
  WELL_KNOWN_VISUAL_ROLE_KINDS,
  makePackId,
} from '@tileborne/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { buildVisualAssetRoleRefFromPlaceable } from '@/lib/visual-asset-role-authoring';

import { WeaponAttachmentPreview } from './weapon-attachment-preview';

const PACK_ID = makePackId('550e8400-e29b-41d4-a716-446655440051');

const roleFor = (
  roleKind: typeof WELL_KNOWN_VISUAL_ROLE_KINDS[keyof typeof WELL_KNOWN_VISUAL_ROLE_KINDS],
  label: string,
): VisualAssetRoleRef =>
  buildVisualAssetRoleRefFromPlaceable({
    roleKind,
    roleLabel: label,
    assetLabel: label,
    activePlaceable: {
      packId: PACK_ID,
      placeableId: `placeable:${String(roleKind)}`,
    },
  });

const weaponRole = (): VisualAssetRoleRef => {
  const base = roleFor(WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon, 'Pulse Carbine');
  return new VisualAssetRoleRef({
    id: base.id,
    roleKind: base.roleKind,
    label: base.label,
    ref: base.ref,
    renderProfile: new RenderProfile({
      scale: 0.5,
      pivot: base.renderProfile.pivot,
      footprint: base.renderProfile.footprint,
      nameplate: base.renderProfile.nameplate,
      shadow: base.renderProfile.shadow,
    }),
    anchors: {
      hand: new AttachmentAnchor({
        point: new VisualAnchorPoint({ x: 0.25, y: 0.5 }),
        rotationDeg: 15,
      }),
      muzzle: new AttachmentAnchor({
        point: new VisualAnchorPoint({ x: 0.95, y: 0.5 }),
        rotationDeg: 5,
      }),
    },
  });
};

describe('WeaponAttachmentPreview', () => {
  it('renders weapon, muzzle flash, and projectile using authored anchor rotation', () => {
    const roles = new Map<string, VisualAssetRoleRef>([
      [String(WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon), weaponRole()],
      [
        String(WELL_KNOWN_VISUAL_ROLE_KINDS.projectile),
        roleFor(WELL_KNOWN_VISUAL_ROLE_KINDS.projectile, 'Projectile Bolt'),
      ],
      [
        String(WELL_KNOWN_VISUAL_ROLE_KINDS.muzzleFlash),
        roleFor(WELL_KNOWN_VISUAL_ROLE_KINDS.muzzleFlash, 'Muzzle Flash'),
      ],
    ]);

    render(<WeaponAttachmentPreview roles={roles} />);

    const preview = screen.getByRole('img', { name: 'Weapon attachment preview' });

    expect(preview.getAttribute('data-angle')).toBe('20.00');
    expect(preview.getAttribute('data-weapon-angle')).toBe('15.00');
    expect(screen.getByTestId('weapon-preview-weapon')).toBeTruthy();
    expect(screen.getByTestId('weapon-preview-muzzle-flash')).toBeTruthy();
    expect(screen.getByTestId('weapon-preview-projectile')).toBeTruthy();
    expect(screen.getByText('Pulse Carbine')).toBeTruthy();
    expect(screen.getByText('Muzzle Flash')).toBeTruthy();
    expect(screen.getByText('Projectile Bolt')).toBeTruthy();
  });
});
