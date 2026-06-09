import {
  WELL_KNOWN_VISUAL_ROLE_KINDS,
  makeClipId,
  makePackId,
} from '@tileborne/core';
import { describe, expect, it } from 'vitest';

import {
  buildVisualAssetRoleRefFromPlaceable,
  visualRolePlaceableProfileFromProperties,
  visualAssetRoleId,
} from './visual-asset-role-authoring';

const uuid = (suffix: string) => `550e8400-e29b-41d4-a716-${suffix}`;
const PACK_ID = makePackId(uuid('446655440011'));
const CLIP_ID = makeClipId(uuid('446655440012'));

describe('visual asset role authoring', () => {
  it('builds a sprite role when the active placeable pins an animation clip', () => {
    const role = buildVisualAssetRoleRefFromPlaceable({
      roleKind: WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon,
      roleLabel: 'Equipped weapon',
      assetLabel: 'Wooden bow / shoot',
      activePlaceable: {
        packId: PACK_ID,
        placeableId: 'placeable:bow',
        clipId: CLIP_ID,
      },
    });

    expect(role.id).toBe(visualAssetRoleId(WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon));
    expect(role.label).toBe('Wooden bow / shoot');
    expect(role.ref.kind).toBe('sprite');
    expect(role.ref.refId).toBe('placeable:bow');
    expect(role.ref.clipId).toBe(CLIP_ID);
    expect(role.defaultClipId).toBe(CLIP_ID);
    expect(role.renderProfile.scale).toBe(0.74);
    expect(role.renderProfile.pivot).toEqual({ x: 0.28, y: 0.56 });
    expect(role.anchors.hand?.point).toEqual({ x: 0.28, y: 0.56 });
    expect(role.anchors.muzzle?.point).toEqual({ x: 0.92, y: 0.5 });
  });

  it('builds a placeable role for active placeables without a pinned clip', () => {
    const role = buildVisualAssetRoleRefFromPlaceable({
      roleKind: WELL_KNOWN_VISUAL_ROLE_KINDS.pickup,
      roleLabel: 'Pickup',
      assetLabel: '',
      activePlaceable: {
        packId: PACK_ID,
        placeableId: 'placeable:crate',
      },
    });

    expect(role.label).toBe('Pickup');
    expect(role.ref.kind).toBe('placeable');
    expect(role.defaultClipId).toBeUndefined();
  });

  it('uses projectile render defaults for projectile roles', () => {
    const role = buildVisualAssetRoleRefFromPlaceable({
      roleKind: WELL_KNOWN_VISUAL_ROLE_KINDS.projectile,
      roleLabel: 'Projectile',
      assetLabel: 'Needle',
      activePlaceable: {
        packId: PACK_ID,
        placeableId: 'placeable:needle',
      },
    });

    expect(role.renderProfile.scale).toBe(0.72);
    expect(role.renderProfile.pivot).toEqual({ x: 0.14, y: 0.5 });
    expect(role.anchors).toEqual({});
  });

  it('uses placeable visual metadata when assigning weapon roles', () => {
    const role = buildVisualAssetRoleRefFromPlaceable({
      roleKind: WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon,
      roleLabel: 'Equipped weapon',
      assetLabel: 'Pulse Carbine',
      activePlaceable: {
        packId: PACK_ID,
        placeableId: 'placeable:pulse-carbine',
        visualProfile: visualRolePlaceableProfileFromProperties({
          'tileborne.visual.scale': 0.52,
          'tileborne.visual.pivotX': 0.3,
          'tileborne.visual.pivotY': 0.58,
          'tileborne.visual.handX': 0.3,
          'tileborne.visual.handY': 0.58,
          'tileborne.visual.muzzleX': 0.94,
          'tileborne.visual.muzzleY': 0.48,
        }),
      },
    });

    expect(role.renderProfile.scale).toBe(0.52);
    expect(role.renderProfile.pivot).toEqual({ x: 0.3, y: 0.58 });
    expect(role.anchors.hand?.point).toEqual({ x: 0.3, y: 0.58 });
    expect(role.anchors.muzzle?.point).toEqual({ x: 0.94, y: 0.48 });
  });
});
