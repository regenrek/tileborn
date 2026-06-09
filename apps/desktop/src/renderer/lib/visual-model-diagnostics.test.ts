import {
  AssetLibraryReference,
  AttachmentAnchor,
  PlayerModelClipSet,
  PlayerModelHitbox,
  PlayerModelRef,
  VisualAnchorPoint,
  VisualAssetRoleRef,
  WELL_KNOWN_VISUAL_ROLE_KINDS,
  makeClipId,
  makePackId,
} from '@tileborne/core';
import { describe, expect, it } from 'vitest';

import type { ResolvedPlayerModelPolicy } from '@/lib/player-model-policy';
import type { ResolvedVisualRolePolicy } from '@/lib/visual-role-policy';
import {
  diagnosePlayerModelPolicy,
  diagnoseVisualModelAuthoring,
  diagnoseVisualRolePolicy,
} from './visual-model-diagnostics';

const UUID = '550e8400-e29b-41d4-a716-446655441000';
const PACK_ID = makePackId(UUID);
const clipIdAt = (index: number) => makeClipId(`550e8400-e29b-41d4-a716-44665544100${index}`);

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

const playerModel = (id: string): PlayerModelRef =>
  new PlayerModelRef({
    id,
    label: id,
    ref: new AssetLibraryReference({ packId: PACK_ID, kind: 'sprite', refId: id }),
    clips: clips(),
    anchor: { x: 0.5, y: 0.86 },
    hitbox: { x: 0.28, y: 0.18, width: 0.44, height: 0.66 },
    muzzle: { x: 0.8, y: 0.52 },
  });

const visualRole = (
  anchors: VisualAssetRoleRef['anchors'] = {},
): VisualAssetRoleRef =>
  new VisualAssetRoleRef({
    id: 'visual-role:equipped-weapon',
    roleKind: WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon,
    label: 'Weapon',
    ref: new AssetLibraryReference({ packId: PACK_ID, kind: 'placeable', refId: 'weapon' }),
    anchors,
  });

const visualPolicy = (roles: readonly VisualAssetRoleRef[]): ResolvedVisualRolePolicy => ({
  pluginId: 'plugin-test',
  placeholderRoleIds: [],
  roleDefinitions: [
    {
      kind: WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon,
      label: 'Equipped weapon',
      requiredAnchors: [
        { id: 'hand', label: 'Hand', kind: 'hand' },
        { id: 'muzzle', label: 'Muzzle', kind: 'muzzle' },
      ],
      previewScenario: 'weapon-attachment',
    },
    { kind: WELL_KNOWN_VISUAL_ROLE_KINDS.projectile, label: 'Projectile' },
  ],
  roles,
});

const modelPolicy = (models: readonly PlayerModelRef[]): ResolvedPlayerModelPolicy => ({
  pluginId: 'plugin-test',
  mode: 'selectable',
  requiredClipKeys: ['idle', 'shoot'],
  placeholderModelIds: ['vanguard'],
  models,
});

describe('visual/model authoring diagnostics', () => {
  it('reports required visual roles and weapon anchors', () => {
    const diagnostics = diagnoseVisualRolePolicy(visualPolicy([visualRole()]));

    expect(diagnostics.map((entry) => entry.code)).toEqual([
      'visual-role.anchor-missing',
      'visual-role.anchor-missing',
      'visual-role.role-missing',
    ]);
    expect(diagnostics.every((entry) => entry.severity === 'error')).toBe(true);
  });

  it('warns when weapon muzzle setup is suspicious but not blocking', () => {
    const diagnostics = diagnoseVisualRolePolicy(
      visualPolicy([
        visualRole({
          hand: new AttachmentAnchor({ point: new VisualAnchorPoint({ x: 0.6, y: 0.5 }) }),
          muzzle: new AttachmentAnchor({ point: new VisualAnchorPoint({ x: 0.55, y: 0.5 }) }),
        }),
        new VisualAssetRoleRef({
          id: 'visual-role:projectile',
          roleKind: WELL_KNOWN_VISUAL_ROLE_KINDS.projectile,
          label: 'Projectile',
          ref: new AssetLibraryReference({ packId: PACK_ID, kind: 'placeable', refId: 'projectile' }),
        }),
      ]),
    );

    expect(diagnostics.map((entry) => entry.code)).toContain(
      'visual-role.weapon-muzzle-behind-hand',
    );
    expect(diagnostics.every((entry) => entry.severity === 'warning')).toBe(true);
  });

  it('reports invalid player model geometry and placeholder model ids', () => {
    const broken = new PlayerModelRef({
      ...playerModel('vanguard'),
      hitbox: new PlayerModelHitbox({ x: 0.8, y: 0.2, width: 0.4, height: 0.8 }),
    });
    const diagnostics = diagnosePlayerModelPolicy(modelPolicy([broken]));

    expect(diagnostics.map((entry) => entry.code)).toEqual([
      'player-model.placeholder',
      'player-model.invalid-ref',
    ]);
  });

  it('combines visual and player model diagnostics for playtest gating', () => {
    const diagnostics = diagnoseVisualModelAuthoring({
      visualPolicy: visualPolicy([]),
      playerModelPolicy: modelPolicy([]),
    });

    expect(diagnostics.some((entry) => entry.code === 'visual-role.role-missing')).toBe(true);
    expect(diagnostics.some((entry) => entry.code === 'player-model.model-missing')).toBe(true);
  });
});
