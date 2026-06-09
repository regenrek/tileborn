import { Effect, Schema } from 'effect';

import { ClipId, WeaponDefinitionId } from '../ids.js';
import { AssetLibraryReference, PlayerModelRef } from './library.js';

const slugPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export const VisualRoleKind = Schema.String.check(Schema.isPattern(slugPattern)).pipe(
  Schema.brand('VisualRoleKind'),
);
export type VisualRoleKind = typeof VisualRoleKind.Type;

export const AttachmentAnchorName = Schema.String.check(Schema.isPattern(slugPattern)).pipe(
  Schema.brand('AttachmentAnchorName'),
);
export type AttachmentAnchorName = typeof AttachmentAnchorName.Type;

export const makeVisualRoleKind = (value: string): VisualRoleKind =>
  Schema.decodeUnknownSync(VisualRoleKind)(value);

export const makeAttachmentAnchorName = (value: string): AttachmentAnchorName =>
  Schema.decodeUnknownSync(AttachmentAnchorName)(value);

export const WELL_KNOWN_VISUAL_ROLE_KINDS = {
  playerModel: makeVisualRoleKind('player-model'),
  equippedWeapon: makeVisualRoleKind('equipped-weapon'),
  projectile: makeVisualRoleKind('projectile'),
  pickup: makeVisualRoleKind('pickup'),
  muzzleFlash: makeVisualRoleKind('muzzle-flash'),
  impactVfx: makeVisualRoleKind('impact-vfx'),
  shield: makeVisualRoleKind('shield'),
  shadow: makeVisualRoleKind('shadow'),
  hazard: makeVisualRoleKind('hazard'),
} as const;

export const WELL_KNOWN_ATTACHMENT_ANCHORS = {
  hand: makeAttachmentAnchorName('hand'),
  muzzle: makeAttachmentAnchorName('muzzle'),
  head: makeAttachmentAnchorName('head'),
  back: makeAttachmentAnchorName('back'),
} as const;

export class VisualAnchorPoint extends Schema.Class<VisualAnchorPoint>('VisualAnchorPoint')({
  x: Schema.Number,
  y: Schema.Number,
}) {}

export class VisualFootprint extends Schema.Class<VisualFootprint>('VisualFootprint')({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
}) {}

export class RenderNameplateProfile extends Schema.Class<RenderNameplateProfile>(
  'RenderNameplateProfile',
)({
  visible: Schema.Boolean.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(true)),
    Schema.withConstructorDefault(Effect.succeed(true)),
  ),
  offsetY: Schema.Number.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(-20)),
    Schema.withConstructorDefault(Effect.succeed(-20)),
  ),
}) {}

export class RenderShadowProfile extends Schema.Class<RenderShadowProfile>(
  'RenderShadowProfile',
)({
  visible: Schema.Boolean.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(true)),
    Schema.withConstructorDefault(Effect.succeed(true)),
  ),
  scale: Schema.Number.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(1)),
    Schema.withConstructorDefault(Effect.succeed(1)),
  ),
  opacity: Schema.Number.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(0.45)),
    Schema.withConstructorDefault(Effect.succeed(0.45)),
  ),
  offset: VisualAnchorPoint.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(new VisualAnchorPoint({ x: 0, y: 0 }))),
    Schema.withConstructorDefault(Effect.succeed(new VisualAnchorPoint({ x: 0, y: 0 }))),
  ),
}) {}

export class RenderProfile extends Schema.Class<RenderProfile>('RenderProfile')({
  scale: Schema.Number.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(1)),
    Schema.withConstructorDefault(Effect.succeed(1)),
  ),
  footprint: VisualFootprint.pipe(
    Schema.withDecodingDefaultTypeKey(
      Effect.succeed(new VisualFootprint({ x: 0, y: 0, width: 1, height: 1 })),
    ),
    Schema.withConstructorDefault(
      Effect.succeed(new VisualFootprint({ x: 0, y: 0, width: 1, height: 1 })),
    ),
  ),
  pivot: VisualAnchorPoint.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(new VisualAnchorPoint({ x: 0.5, y: 1 }))),
    Schema.withConstructorDefault(Effect.succeed(new VisualAnchorPoint({ x: 0.5, y: 1 }))),
  ),
  nameplate: RenderNameplateProfile.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(new RenderNameplateProfile({}))),
    Schema.withConstructorDefault(Effect.succeed(new RenderNameplateProfile({}))),
  ),
  shadow: RenderShadowProfile.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(new RenderShadowProfile({}))),
    Schema.withConstructorDefault(Effect.succeed(new RenderShadowProfile({}))),
  ),
}) {}

export class AttachmentAnchor extends Schema.Class<AttachmentAnchor>('AttachmentAnchor')({
  point: VisualAnchorPoint,
  rotationDeg: Schema.Number.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(0)),
    Schema.withConstructorDefault(Effect.succeed(0)),
  ),
  zOffset: Schema.Number.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(0)),
    Schema.withConstructorDefault(Effect.succeed(0)),
  ),
}) {}

export const AttachmentAnchorMap = Schema.Record(Schema.String, AttachmentAnchor);
export type AttachmentAnchorMap = typeof AttachmentAnchorMap.Type;

export class VisualAssetRoleRef extends Schema.Class<VisualAssetRoleRef>(
  'VisualAssetRoleRef',
)({
  id: Schema.String,
  roleKind: VisualRoleKind,
  label: Schema.String,
  ref: AssetLibraryReference,
  defaultClipId: Schema.optional(ClipId),
  renderProfile: RenderProfile.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(new RenderProfile({}))),
    Schema.withConstructorDefault(Effect.succeed(new RenderProfile({}))),
  ),
  anchors: AttachmentAnchorMap.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed({})),
    Schema.withConstructorDefault(Effect.succeed({})),
  ),
}) {}

export class PlayerModelVisualRef extends Schema.Class<PlayerModelVisualRef>(
  'PlayerModelVisualRef',
)({
  model: PlayerModelRef,
  renderProfile: RenderProfile.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(new RenderProfile({}))),
    Schema.withConstructorDefault(Effect.succeed(new RenderProfile({}))),
  ),
  anchors: AttachmentAnchorMap.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed({})),
    Schema.withConstructorDefault(Effect.succeed({})),
  ),
}) {}

export class WeaponVisualRef extends Schema.Class<WeaponVisualRef>('WeaponVisualRef')({
  role: VisualAssetRoleRef,
  attachAnchor: AttachmentAnchorName.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(WELL_KNOWN_ATTACHMENT_ANCHORS.hand)),
    Schema.withConstructorDefault(Effect.succeed(WELL_KNOWN_ATTACHMENT_ANCHORS.hand)),
  ),
  muzzleAnchor: AttachmentAnchorName.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(WELL_KNOWN_ATTACHMENT_ANCHORS.muzzle)),
    Schema.withConstructorDefault(Effect.succeed(WELL_KNOWN_ATTACHMENT_ANCHORS.muzzle)),
  ),
  rotationOffsetDeg: Schema.Number.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(0)),
    Schema.withConstructorDefault(Effect.succeed(0)),
  ),
}) {}

export class ProjectileVisualRef extends Schema.Class<ProjectileVisualRef>(
  'ProjectileVisualRef',
)({
  role: VisualAssetRoleRef,
  rotationOffsetDeg: Schema.Number.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(0)),
    Schema.withConstructorDefault(Effect.succeed(0)),
  ),
}) {}

export class PickupVisualRef extends Schema.Class<PickupVisualRef>('PickupVisualRef')({
  role: VisualAssetRoleRef,
}) {}

export class VfxVisualRef extends Schema.Class<VfxVisualRef>('VfxVisualRef')({
  role: VisualAssetRoleRef,
  durationMs: Schema.Number.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(180)),
    Schema.withConstructorDefault(Effect.succeed(180)),
  ),
}) {}

export class WeaponVisualBinding extends Schema.Class<WeaponVisualBinding>(
  'WeaponVisualBinding',
)({
  weaponId: WeaponDefinitionId,
  equippedWeapon: WeaponVisualRef,
  projectile: Schema.optional(ProjectileVisualRef),
  pickup: Schema.optional(PickupVisualRef),
  muzzleFlash: Schema.optional(VfxVisualRef),
  impactVfx: Schema.optional(VfxVisualRef),
}) {}

export interface VisualRoleValidationIssue {
  readonly path: string;
  readonly message: string;
}

const isFiniteNumber = (value: number): boolean => Number.isFinite(value);

const pointIssues = (
  path: string,
  point: { readonly x: number; readonly y: number },
): readonly VisualRoleValidationIssue[] => {
  const issues: VisualRoleValidationIssue[] = [];
  if (!isFiniteNumber(point.x) || point.x < 0 || point.x > 1) {
    issues.push({ path: `${path}.x`, message: 'must be a finite number between 0 and 1' });
  }
  if (!isFiniteNumber(point.y) || point.y < 0 || point.y > 1) {
    issues.push({ path: `${path}.y`, message: 'must be a finite number between 0 and 1' });
  }
  return issues;
};

const footprintIssues = (
  path: string,
  footprint: VisualFootprint,
): readonly VisualRoleValidationIssue[] => {
  const issues: VisualRoleValidationIssue[] = [];
  issues.push(...pointIssues(path, footprint));
  if (!isFiniteNumber(footprint.width) || footprint.width <= 0 || footprint.width > 1) {
    issues.push({ path: `${path}.width`, message: 'must be greater than 0 and at most 1' });
  }
  if (!isFiniteNumber(footprint.height) || footprint.height <= 0 || footprint.height > 1) {
    issues.push({ path: `${path}.height`, message: 'must be greater than 0 and at most 1' });
  }
  if (
    isFiniteNumber(footprint.x) &&
    isFiniteNumber(footprint.width) &&
    footprint.x + footprint.width > 1
  ) {
    issues.push({ path, message: 'x + width must not exceed 1' });
  }
  if (
    isFiniteNumber(footprint.y) &&
    isFiniteNumber(footprint.height) &&
    footprint.y + footprint.height > 1
  ) {
    issues.push({ path, message: 'y + height must not exceed 1' });
  }
  return issues;
};

const renderProfileIssues = (
  path: string,
  profile: RenderProfile,
): readonly VisualRoleValidationIssue[] => {
  const issues: VisualRoleValidationIssue[] = [];
  if (!isFiniteNumber(profile.scale) || profile.scale <= 0) {
    issues.push({ path: `${path}.scale`, message: 'must be a finite number greater than 0' });
  }
  issues.push(...footprintIssues(`${path}.footprint`, profile.footprint));
  issues.push(...pointIssues(`${path}.pivot`, profile.pivot));
  if (!isFiniteNumber(profile.nameplate.offsetY)) {
    issues.push({ path: `${path}.nameplate.offsetY`, message: 'must be a finite number' });
  }
  if (!isFiniteNumber(profile.shadow.scale) || profile.shadow.scale <= 0) {
    issues.push({ path: `${path}.shadow.scale`, message: 'must be greater than 0' });
  }
  if (
    !isFiniteNumber(profile.shadow.opacity) ||
    profile.shadow.opacity < 0 ||
    profile.shadow.opacity > 1
  ) {
    issues.push({ path: `${path}.shadow.opacity`, message: 'must be between 0 and 1' });
  }
  return issues;
};

const anchorMapIssues = (
  path: string,
  anchors: AttachmentAnchorMap,
): readonly VisualRoleValidationIssue[] =>
  Object.entries(anchors).flatMap(([name, anchor]) => [
    ...pointIssues(`${path}.${name}.point`, anchor.point),
    ...(!isFiniteNumber(anchor.rotationDeg)
      ? [{ path: `${path}.${name}.rotationDeg`, message: 'must be a finite number' }]
      : []),
    ...(!isFiniteNumber(anchor.zOffset)
      ? [{ path: `${path}.${name}.zOffset`, message: 'must be a finite number' }]
      : []),
  ]);

export const validateVisualAssetRoleRef = (
  role: VisualAssetRoleRef,
): readonly VisualRoleValidationIssue[] => {
  const issues: VisualRoleValidationIssue[] = [];
  if (role.id.trim().length === 0) {
    issues.push({ path: 'id', message: 'must not be empty' });
  }
  if (role.label.trim().length === 0) {
    issues.push({ path: 'label', message: 'must not be empty' });
  }
  issues.push(...renderProfileIssues('renderProfile', role.renderProfile));
  issues.push(...anchorMapIssues('anchors', role.anchors));
  return issues;
};

const expectedRoleIssues = (
  path: string,
  actual: VisualRoleKind,
  expected: VisualRoleKind,
): readonly VisualRoleValidationIssue[] =>
  actual === expected
    ? []
    : [{ path, message: `must use visual role kind "${String(expected)}"` }];

const renderableRoleRefIssues = (
  path: string,
  role: VisualAssetRoleRef,
): readonly VisualRoleValidationIssue[] =>
  role.ref.kind === 'sprite' || role.ref.kind === 'placeable'
    ? []
    : [{ path, message: 'must reference a sprite or placeable asset' }];

const prefixedIssues = (
  prefix: string,
  issues: readonly VisualRoleValidationIssue[],
): readonly VisualRoleValidationIssue[] =>
  issues.map((issue) => ({
    ...issue,
    path: `${prefix}.${issue.path}`,
  }));

export const validateWeaponVisualRef = (
  visual: WeaponVisualRef,
): readonly VisualRoleValidationIssue[] => [
  ...expectedRoleIssues(
    'role.roleKind',
    visual.role.roleKind,
    WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon,
  ),
  ...(!isFiniteNumber(visual.rotationOffsetDeg)
    ? [{ path: 'rotationOffsetDeg', message: 'must be a finite number' }]
    : []),
  ...renderableRoleRefIssues('role.ref.kind', visual.role),
  ...prefixedIssues('role', validateVisualAssetRoleRef(visual.role)),
];

export const validateProjectileVisualRef = (
  visual: ProjectileVisualRef,
): readonly VisualRoleValidationIssue[] => [
  ...expectedRoleIssues(
    'role.roleKind',
    visual.role.roleKind,
    WELL_KNOWN_VISUAL_ROLE_KINDS.projectile,
  ),
  ...(!isFiniteNumber(visual.rotationOffsetDeg)
    ? [{ path: 'rotationOffsetDeg', message: 'must be a finite number' }]
    : []),
  ...renderableRoleRefIssues('role.ref.kind', visual.role),
  ...prefixedIssues('role', validateVisualAssetRoleRef(visual.role)),
];

export const validatePickupVisualRef = (
  visual: PickupVisualRef,
): readonly VisualRoleValidationIssue[] => [
  ...expectedRoleIssues(
    'role.roleKind',
    visual.role.roleKind,
    WELL_KNOWN_VISUAL_ROLE_KINDS.pickup,
  ),
  ...renderableRoleRefIssues('role.ref.kind', visual.role),
  ...prefixedIssues('role', validateVisualAssetRoleRef(visual.role)),
];

export const validateVfxVisualRef = (
  visual: VfxVisualRef,
  expected: VisualRoleKind,
): readonly VisualRoleValidationIssue[] => [
  ...expectedRoleIssues('role.roleKind', visual.role.roleKind, expected),
  ...(!isFiniteNumber(visual.durationMs) || visual.durationMs <= 0
    ? [{ path: 'durationMs', message: 'must be a finite number greater than 0' }]
    : []),
  ...renderableRoleRefIssues('role.ref.kind', visual.role),
  ...prefixedIssues('role', validateVisualAssetRoleRef(visual.role)),
];

export const validateWeaponVisualBinding = (
  binding: WeaponVisualBinding,
): readonly VisualRoleValidationIssue[] => [
  ...prefixedIssues('equippedWeapon', validateWeaponVisualRef(binding.equippedWeapon)),
  ...(binding.projectile === undefined
    ? []
    : prefixedIssues('projectile', validateProjectileVisualRef(binding.projectile))),
  ...(binding.pickup === undefined
    ? []
    : prefixedIssues('pickup', validatePickupVisualRef(binding.pickup))),
  ...(binding.muzzleFlash === undefined
    ? []
    : prefixedIssues(
        'muzzleFlash',
        validateVfxVisualRef(binding.muzzleFlash, WELL_KNOWN_VISUAL_ROLE_KINDS.muzzleFlash),
      )),
  ...(binding.impactVfx === undefined
    ? []
    : prefixedIssues(
        'impactVfx',
        validateVfxVisualRef(binding.impactVfx, WELL_KNOWN_VISUAL_ROLE_KINDS.impactVfx),
      )),
];
