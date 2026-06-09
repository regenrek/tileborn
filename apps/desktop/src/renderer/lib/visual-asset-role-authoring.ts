import {
  AssetLibraryReference,
  AttachmentAnchor,
  RenderProfile,
  VisualAnchorPoint,
  VisualAssetRoleRef,
  WELL_KNOWN_VISUAL_ROLE_KINDS,
  type ClipId,
  type PackId,
  type VisualRoleKind,
} from '@tileborne/core';

export interface VisualRoleActivePlaceable {
  readonly packId: PackId;
  readonly placeableId: string;
  readonly clipId?: ClipId | undefined;
  readonly visualProfile?: VisualRolePlaceableProfile | undefined;
}

export interface BuildVisualAssetRoleRefInput {
  readonly roleKind: VisualRoleKind;
  readonly roleLabel: string;
  readonly assetLabel: string;
  readonly activePlaceable: VisualRoleActivePlaceable;
}

export interface VisualRolePlaceableProfile {
  readonly scale?: number | undefined;
  readonly pivot?: { readonly x: number; readonly y: number } | undefined;
  readonly anchors?: Record<string, { readonly x: number; readonly y: number }> | undefined;
}

export const visualAssetRoleId = (roleKind: VisualRoleKind): string =>
  `visual-role:${String(roleKind)}`;

const finiteProperty = (properties: Record<string, unknown>, key: string): number | undefined => {
  const value = properties[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

const pointFromProperties = (
  properties: Record<string, unknown>,
  xKey: string,
  yKey: string,
): { readonly x: number; readonly y: number } | undefined => {
  const x = finiteProperty(properties, xKey);
  const y = finiteProperty(properties, yKey);
  return x === undefined || y === undefined ? undefined : { x, y };
};

export const visualRolePlaceableProfileFromProperties = (
  properties: unknown,
): VisualRolePlaceableProfile | undefined => {
  if (properties === null || typeof properties !== 'object' || Array.isArray(properties)) {
    return undefined;
  }
  const record = properties as Record<string, unknown>;
  const scale = finiteProperty(record, 'tileborne.visual.scale');
  const pivot = pointFromProperties(record, 'tileborne.visual.pivotX', 'tileborne.visual.pivotY');
  const hand = pointFromProperties(record, 'tileborne.visual.handX', 'tileborne.visual.handY');
  const muzzle = pointFromProperties(record, 'tileborne.visual.muzzleX', 'tileborne.visual.muzzleY');
  const anchors = {
    ...(hand === undefined ? {} : { hand }),
    ...(muzzle === undefined ? {} : { muzzle }),
  };
  if (scale === undefined && pivot === undefined && Object.keys(anchors).length === 0) {
    return undefined;
  }
  return {
    ...(scale === undefined ? {} : { scale }),
    ...(pivot === undefined ? {} : { pivot }),
    ...(Object.keys(anchors).length === 0 ? {} : { anchors }),
  };
};

const renderProfileForRoleKind = (
  roleKind: VisualRoleKind,
  profile: VisualRolePlaceableProfile | undefined,
): RenderProfile => {
  switch (roleKind) {
    case WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon:
      return new RenderProfile({
        scale: profile?.scale ?? 0.74,
        pivot: new VisualAnchorPoint(profile?.pivot ?? { x: 0.28, y: 0.56 }),
      });
    case WELL_KNOWN_VISUAL_ROLE_KINDS.projectile:
      return new RenderProfile({
        scale: 0.72,
        pivot: new VisualAnchorPoint({ x: 0.14, y: 0.5 }),
      });
    case WELL_KNOWN_VISUAL_ROLE_KINDS.muzzleFlash:
      return new RenderProfile({
        scale: 0.72,
        pivot: new VisualAnchorPoint({ x: 0.18, y: 0.5 }),
      });
    case WELL_KNOWN_VISUAL_ROLE_KINDS.impactVfx:
      return new RenderProfile({
        scale: 0.86,
        pivot: new VisualAnchorPoint({ x: 0.5, y: 0.5 }),
      });
    case WELL_KNOWN_VISUAL_ROLE_KINDS.hazard:
      return new RenderProfile({
        scale: 1,
        pivot: new VisualAnchorPoint({ x: 0.5, y: 0.62 }),
      });
    default:
      return new RenderProfile({});
  }
};

const anchorsForRoleKind = (
  roleKind: VisualRoleKind,
  profile: VisualRolePlaceableProfile | undefined,
): Record<string, AttachmentAnchor> => {
  if (roleKind !== WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon) {
    return {};
  }
  const hand = profile?.anchors?.hand ?? { x: 0.28, y: 0.56 };
  const muzzle = profile?.anchors?.muzzle ?? { x: 0.92, y: 0.5 };
  return {
    hand: new AttachmentAnchor({ point: new VisualAnchorPoint(hand) }),
    muzzle: new AttachmentAnchor({ point: new VisualAnchorPoint(muzzle) }),
  };
};

export const buildVisualAssetRoleRefFromPlaceable = (
  input: BuildVisualAssetRoleRefInput,
): VisualAssetRoleRef => {
  const ref = new AssetLibraryReference({
    packId: input.activePlaceable.packId,
    kind: input.activePlaceable.clipId === undefined ? 'placeable' : 'sprite',
    refId: input.activePlaceable.placeableId,
    ...(input.activePlaceable.clipId === undefined
      ? {}
      : { clipId: input.activePlaceable.clipId }),
  });

  return new VisualAssetRoleRef({
    id: visualAssetRoleId(input.roleKind),
    roleKind: input.roleKind,
    label: input.assetLabel.trim().length === 0 ? input.roleLabel : input.assetLabel,
    ref,
    renderProfile: renderProfileForRoleKind(input.roleKind, input.activePlaceable.visualProfile),
    anchors: anchorsForRoleKind(input.roleKind, input.activePlaceable.visualProfile),
    ...(input.activePlaceable.clipId === undefined
      ? {}
      : { defaultClipId: input.activePlaceable.clipId }),
  });
};
