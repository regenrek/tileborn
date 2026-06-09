import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeClipId, makePackId, makeWeaponDefinitionId } from '../ids.js';
import { AssetLibraryReference, PlayerModelClipSet, PlayerModelRef } from './library.js';
import {
  AttachmentAnchor,
  PickupVisualRef,
  PlayerModelVisualRef,
  ProjectileVisualRef,
  VisualAnchorPoint,
  RenderProfile,
  VfxVisualRef,
  VisualAssetRoleRef,
  VisualFootprint,
  VisualRoleKind,
  WELL_KNOWN_VISUAL_ROLE_KINDS,
  WeaponVisualBinding,
  WeaponVisualRef,
  makeVisualRoleKind,
  validateProjectileVisualRef,
  validateVfxVisualRef,
  validateVisualAssetRoleRef,
  validateWeaponVisualBinding,
  validateWeaponVisualRef,
} from './visual-role.js';

const UUID = '550e8400-e29b-41d4-a716-446655440000';
const clipIdAt = (index: number) => makeClipId(`550e8400-e29b-41d4-a716-44665544000${index}`);

const spriteRef = (clipId?: string) =>
  new AssetLibraryReference({
    packId: makePackId(UUID),
    kind: 'sprite',
    refId: 'sprite:weapon-rifle',
    ...(clipId === undefined ? {} : { clipId: makeClipId(clipId) }),
  });

const role = (
  roleKind = WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon,
): VisualAssetRoleRef =>
  new VisualAssetRoleRef({
    id: 'visual:rifle',
    roleKind,
    label: 'Rifle',
    ref: spriteRef(),
  });

const clips = () =>
  new PlayerModelClipSet({
    idle: clipIdAt(0),
    walk: clipIdAt(1),
    run: clipIdAt(2),
    shoot: clipIdAt(3),
    reload: clipIdAt(4),
    hit: clipIdAt(5),
    death: clipIdAt(6),
    dash: clipIdAt(7),
    pickup: clipIdAt(8),
  });

const playerModel = () =>
  new PlayerModelRef({
    id: 'model:mae',
    label: 'Maltipoo Mae',
    ref: spriteRef(),
    clips: clips(),
    anchor: { x: 0.5, y: 1 },
    hitbox: { x: 0.25, y: 0.1, width: 0.5, height: 0.85 },
    muzzle: { x: 0.75, y: 0.45 },
  });

describe('VisualRoleKind', () => {
  it('accepts plugin-friendly slug role names and rejects unsafe labels', () => {
    expect(Schema.decodeUnknownSync(VisualRoleKind)('pet-trail')).toBe('pet-trail');
    expect(() => Schema.decodeUnknownSync(VisualRoleKind)('Pet Trail!')).toThrow();
  });
});

describe('VisualAssetRoleRef', () => {
  it('decodes defaults for render profile and attachment anchors', () => {
    const decoded = Schema.decodeUnknownSync(VisualAssetRoleRef)({
      id: 'visual:projectile-bolt',
      roleKind: 'projectile',
      label: 'Projectile bolt',
      ref: spriteRef(),
    });

    expect(decoded.roleKind).toBe(WELL_KNOWN_VISUAL_ROLE_KINDS.projectile);
    expect(decoded.renderProfile.scale).toBe(1);
    expect(decoded.renderProfile.pivot).toEqual({ x: 0.5, y: 1 });
    expect(decoded.renderProfile.footprint).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(decoded.renderProfile.nameplate.visible).toBe(true);
    expect(decoded.renderProfile.shadow.opacity).toBe(0.45);
    expect(decoded.anchors).toEqual({});
    expect(validateVisualAssetRoleRef(decoded)).toEqual([]);
  });

  it('round-trips a visual role with scale, footprint, pivot, and anchors', () => {
    const visual = new VisualAssetRoleRef({
      id: 'visual:rifle',
      roleKind: WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon,
      label: 'Rifle',
      ref: spriteRef(),
      defaultClipId: clipIdAt(3),
      renderProfile: new RenderProfile({
        scale: 1.25,
        footprint: new VisualFootprint({ x: 0.1, y: 0.2, width: 0.8, height: 0.5 }),
        pivot: new VisualAnchorPoint({ x: 0.45, y: 0.5 }),
      }),
      anchors: {
        hand: new AttachmentAnchor({ point: new VisualAnchorPoint({ x: 0.2, y: 0.5 }) }),
        muzzle: new AttachmentAnchor({
          point: new VisualAnchorPoint({ x: 0.92, y: 0.48 }),
          rotationDeg: 4,
        }),
      },
    });

    const encoded = Schema.encodeUnknownSync(VisualAssetRoleRef)(visual);
    const decoded = Schema.decodeUnknownSync(VisualAssetRoleRef)(encoded);

    expect(decoded.renderProfile.scale).toBe(1.25);
    expect(decoded.anchors.muzzle?.rotationDeg).toBe(4);
    expect(validateVisualAssetRoleRef(decoded)).toEqual([]);
  });

  it('reports semantic validation issues for bad render metadata', () => {
    const invalid = new VisualAssetRoleRef({
      id: '',
      roleKind: makeVisualRoleKind('projectile'),
      label: '',
      ref: spriteRef(),
      renderProfile: new RenderProfile({
        scale: 0,
        footprint: new VisualFootprint({ x: 0.8, y: 0, width: 0.4, height: 1.2 }),
        pivot: new VisualAnchorPoint({ x: -1, y: 2 }),
      }),
      anchors: {
        muzzle: new AttachmentAnchor({
          point: new VisualAnchorPoint({ x: 2, y: 0.5 }),
          rotationDeg: Number.NaN,
        }),
      },
    });

    expect(validateVisualAssetRoleRef(invalid).map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        'id',
        'label',
        'renderProfile.scale',
        'renderProfile.footprint.height',
        'renderProfile.footprint',
        'renderProfile.pivot.x',
        'renderProfile.pivot.y',
        'anchors.muzzle.point.x',
        'anchors.muzzle.rotationDeg',
      ]),
    );
  });
});

describe('specialized visual refs', () => {
  it('keeps player visual metadata attached to the existing PlayerModelRef source of truth', () => {
    const visual = Schema.decodeUnknownSync(PlayerModelVisualRef)({
      model: playerModel(),
      anchors: {
        hand: { point: { x: 0.3, y: 0.52 } },
        muzzle: { point: { x: 0.74, y: 0.46 } },
      },
    });

    expect(visual.model.id).toBe('model:mae');
    expect(visual.renderProfile.scale).toBe(1);
    expect(visual.anchors.hand?.rotationDeg).toBe(0);
  });

  it('round-trips weapon, projectile, pickup, and VFX visual refs', () => {
    const weapon = new WeaponVisualRef({
      role: role(WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon),
      rotationOffsetDeg: 12,
    });
    const projectile = new ProjectileVisualRef({
      role: role(WELL_KNOWN_VISUAL_ROLE_KINDS.projectile),
      rotationOffsetDeg: -90,
    });
    const pickup = new PickupVisualRef({ role: role(WELL_KNOWN_VISUAL_ROLE_KINDS.pickup) });
    const impact = new VfxVisualRef({
      role: role(WELL_KNOWN_VISUAL_ROLE_KINDS.impactVfx),
      durationMs: 240,
    });

    expect(
      Schema.decodeUnknownSync(WeaponVisualRef)(Schema.encodeUnknownSync(WeaponVisualRef)(weapon))
        .rotationOffsetDeg,
    ).toBe(12);
    expect(
      Schema.decodeUnknownSync(ProjectileVisualRef)(Schema.encodeUnknownSync(ProjectileVisualRef)(projectile))
        .rotationOffsetDeg,
    ).toBe(-90);
    expect(Schema.decodeUnknownSync(PickupVisualRef)(Schema.encodeUnknownSync(PickupVisualRef)(pickup))).toBeInstanceOf(
      PickupVisualRef,
    );
    expect(Schema.decodeUnknownSync(VfxVisualRef)(Schema.encodeUnknownSync(VfxVisualRef)(impact)).durationMs).toBe(240);
  });

  it('validates specialized role-kind invariants', () => {
    expect(validateWeaponVisualRef(new WeaponVisualRef({ role: role(WELL_KNOWN_VISUAL_ROLE_KINDS.projectile) })).map(
      (issue) => issue.path,
    )).toContain('role.roleKind');
    expect(
      validateWeaponVisualRef(
        new WeaponVisualRef({
          role: role(WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon),
          rotationOffsetDeg: Number.NaN,
        }),
      ).map((issue) => issue.path),
    ).toContain('rotationOffsetDeg');
    expect(validateProjectileVisualRef(new ProjectileVisualRef({ role: role(WELL_KNOWN_VISUAL_ROLE_KINDS.projectile) }))).toEqual(
      [],
    );
    expect(
      validateVfxVisualRef(
        new VfxVisualRef({ role: role(WELL_KNOWN_VISUAL_ROLE_KINDS.muzzleFlash), durationMs: 0 }),
        WELL_KNOWN_VISUAL_ROLE_KINDS.muzzleFlash,
      ).map((issue) => issue.path),
    ).toContain('durationMs');
  });

  it('round-trips a weapon visual binding across equipped, projectile, pickup, and VFX roles', () => {
    const binding = new WeaponVisualBinding({
      weaponId: makeWeaponDefinitionId(UUID),
      equippedWeapon: new WeaponVisualRef({
        role: role(WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon),
        rotationOffsetDeg: -8,
      }),
      projectile: new ProjectileVisualRef({
        role: role(WELL_KNOWN_VISUAL_ROLE_KINDS.projectile),
      }),
      pickup: new PickupVisualRef({ role: role(WELL_KNOWN_VISUAL_ROLE_KINDS.pickup) }),
      muzzleFlash: new VfxVisualRef({
        role: role(WELL_KNOWN_VISUAL_ROLE_KINDS.muzzleFlash),
      }),
      impactVfx: new VfxVisualRef({
        role: role(WELL_KNOWN_VISUAL_ROLE_KINDS.impactVfx),
      }),
    });

    const decoded = Schema.decodeUnknownSync(WeaponVisualBinding)(
      Schema.encodeUnknownSync(WeaponVisualBinding)(binding),
    );

    expect(decoded.weaponId).toBe(`weapon:${UUID}`);
    expect(decoded.equippedWeapon.rotationOffsetDeg).toBe(-8);
    expect(decoded.projectile?.role.roleKind).toBe(WELL_KNOWN_VISUAL_ROLE_KINDS.projectile);
    expect(decoded.muzzleFlash?.durationMs).toBe(180);
    expect(validateWeaponVisualBinding(decoded)).toEqual([]);
  });

  it('reports binding-level role-kind validation paths', () => {
    const binding = new WeaponVisualBinding({
      weaponId: makeWeaponDefinitionId(UUID),
      equippedWeapon: new WeaponVisualRef({
        role: role(WELL_KNOWN_VISUAL_ROLE_KINDS.projectile),
        rotationOffsetDeg: Number.NaN,
      }),
      impactVfx: new VfxVisualRef({
        role: role(WELL_KNOWN_VISUAL_ROLE_KINDS.muzzleFlash),
      }),
    });

    expect(validateWeaponVisualBinding(binding).map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        'equippedWeapon.role.roleKind',
        'equippedWeapon.rotationOffsetDeg',
        'impactVfx.role.roleKind',
      ]),
    );
  });
});
