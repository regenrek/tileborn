import {
  AssetLibraryReference,
  AttachmentAnchor,
  PlayerModelClipSet,
  PlayerModelRef,
  RenderProfile,
  VisualAnchorPoint,
  VisualAssetRoleRef,
  WELL_KNOWN_VISUAL_ROLE_KINDS,
  makeClipId,
  makePackId,
  readProjectVisualAssetRoles,
  type ProjectManifest,
  type VisualRoleKind,
} from "@tileborne/core";

import { PLUGIN_ID } from "./constants.js";

export const BATTLE_ROYALE_CORE_PACK_ID = makePackId("b4111e00-0000-4000-8000-000000000001");
export const BATTLE_ROYALE_CORE_PACK_VERSION = "0.1.0";

const clipId = (modelIndex: number, clipIndex: number) =>
  makeClipId(
    `b4111e00-0000-4000-8000-${(0x1000 + modelIndex * 0x100 + clipIndex)
      .toString(16)
      .padStart(12, "0")}`,
  );

const playerModelPlaceableId = (modelIndex: number): string =>
  `placeable:b4111e00-0000-4000-8000-${(0x2000 + modelIndex).toString(16).padStart(12, "0")}`;

const objectPlaceableId = (objectIndex: number): string =>
  `placeable:b4111e00-0000-4000-8000-${(0x5000 + objectIndex).toString(16).padStart(12, "0")}`;

const model = (index: number, id: string, label: string): PlayerModelRef => {
  const clips = new PlayerModelClipSet({
    idle: clipId(index, 0),
    walk: clipId(index, 1),
    run: clipId(index, 2),
    shoot: clipId(index, 3),
    reload: clipId(index, 4),
    hit: clipId(index, 5),
    death: clipId(index, 6),
    dash: clipId(index, 7),
    pickup: clipId(index, 8),
  });
  return new PlayerModelRef({
    id,
    label,
    ref: new AssetLibraryReference({
      packId: BATTLE_ROYALE_CORE_PACK_ID,
      kind: "sprite",
      refId: playerModelPlaceableId(index),
      clipId: clips.idle,
    }),
    defaultClipId: clips.idle,
    clips,
    anchor: { x: 0.5, y: 0.86 },
    hitbox: { x: 0.28, y: 0.18, width: 0.44, height: 0.66 },
    muzzle: { x: 0.8, y: 0.52 },
  });
};

export const DEFAULT_BATTLE_ROYALE_PLAYER_MODEL_REFS: readonly PlayerModelRef[] = [
  model(0, "maltipoo-mae", "Maltipoo Mae"),
  model(1, "maltipoo-max", "Maltipoo Max"),
] as const;

export const BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS = {
  lootCrate: objectPlaceableId(2),
  trap: objectPlaceableId(3),
  decoy: objectPlaceableId(4),
  barrier: objectPlaceableId(5),
  rifle: objectPlaceableId(9),
  projectileBolt: objectPlaceableId(10),
  muzzleFlash: objectPlaceableId(11),
  impactBurst: objectPlaceableId(12),
  shieldBubble: objectPlaceableId(13),
  playerShadow: objectPlaceableId(14),
  hazardFlame: objectPlaceableId(15),
  petwarsWeapons: {
    ionBlaster: objectPlaceableId(0x2000),
    pulseRanger: objectPlaceableId(0x2001),
    arcBurst: objectPlaceableId(0x2002),
    pulseCarbine: objectPlaceableId(0x2003),
    scatterLance: objectPlaceableId(0x2004),
    arcCharger: objectPlaceableId(0x2005),
    ricochetDisc: objectPlaceableId(0x2006),
    railNeedle: objectPlaceableId(0x2007),
    novaLauncher: objectPlaceableId(0x2008),
    prismBeam: objectPlaceableId(0x2009),
    plasmaSabre: objectPlaceableId(0x200a),
  },
} as const;

const visualRoleId = (roleKind: VisualRoleKind): string => `visual-role:${String(roleKind)}`;

const visualRole = (
  roleKind: VisualRoleKind,
  label: string,
  refId: string,
  render: {
    readonly scale: number;
    readonly pivot: { readonly x: number; readonly y: number };
    readonly hand?: { readonly x: number; readonly y: number } | undefined;
    readonly muzzle?: { readonly x: number; readonly y: number } | undefined;
  },
): VisualAssetRoleRef =>
  new VisualAssetRoleRef({
    id: visualRoleId(roleKind),
    roleKind,
    label,
    ref: new AssetLibraryReference({
      packId: BATTLE_ROYALE_CORE_PACK_ID,
      kind: "placeable",
      refId,
    }),
    renderProfile: new RenderProfile({
      scale: render.scale,
      pivot: new VisualAnchorPoint(render.pivot),
    }),
    anchors: {
      ...(render.hand === undefined
        ? {}
        : { hand: new AttachmentAnchor({ point: new VisualAnchorPoint(render.hand) }) }),
      ...(render.muzzle === undefined
        ? {}
        : { muzzle: new AttachmentAnchor({ point: new VisualAnchorPoint(render.muzzle) }) }),
    },
  });

export const DEFAULT_BATTLE_ROYALE_VISUAL_ASSET_ROLES: readonly VisualAssetRoleRef[] = [
  visualRole(
    WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon,
    "Pulse Carbine",
    BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS.petwarsWeapons.pulseCarbine,
    {
      scale: 0.52,
      pivot: { x: 0.28, y: 0.56 },
      hand: { x: 0.28, y: 0.56 },
      muzzle: { x: 0.92, y: 0.49 },
    },
  ),
  visualRole(
    WELL_KNOWN_VISUAL_ROLE_KINDS.projectile,
    "Projectile Bolt",
    BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS.projectileBolt,
    { scale: 0.72, pivot: { x: 0.14, y: 0.5 } },
  ),
  visualRole(
    WELL_KNOWN_VISUAL_ROLE_KINDS.pickup,
    "Loot Crate",
    BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS.lootCrate,
    { scale: 1, pivot: { x: 0.5, y: 0.5 } },
  ),
  visualRole(
    WELL_KNOWN_VISUAL_ROLE_KINDS.muzzleFlash,
    "Muzzle Flash",
    BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS.muzzleFlash,
    { scale: 0.72, pivot: { x: 0.18, y: 0.5 } },
  ),
  visualRole(
    WELL_KNOWN_VISUAL_ROLE_KINDS.impactVfx,
    "Impact Burst",
    BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS.impactBurst,
    { scale: 0.86, pivot: { x: 0.5, y: 0.5 } },
  ),
  visualRole(
    WELL_KNOWN_VISUAL_ROLE_KINDS.shield,
    "Shield Bubble",
    BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS.shieldBubble,
    { scale: 1, pivot: { x: 0.5, y: 0.5 } },
  ),
  visualRole(
    WELL_KNOWN_VISUAL_ROLE_KINDS.shadow,
    "Player Shadow",
    BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS.playerShadow,
    { scale: 1, pivot: { x: 0.5, y: 0.5 } },
  ),
  visualRole(
    WELL_KNOWN_VISUAL_ROLE_KINDS.hazard,
    "Hazard Flame",
    BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS.hazardFlame,
    { scale: 1, pivot: { x: 0.5, y: 0.62 } },
  ),
] as const;

export const DEFAULT_BATTLE_ROYALE_VISUAL_ROLE_DEFINITIONS = [
  {
    kind: WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon,
    label: "Equipped weapon",
    requiredAnchors: [
      { id: "hand", label: "Hand", kind: "hand" },
      { id: "muzzle", label: "Muzzle", kind: "muzzle" },
    ],
    previewScenario: "weapon-attachment",
  },
  { kind: WELL_KNOWN_VISUAL_ROLE_KINDS.projectile, label: "Projectile" },
  { kind: WELL_KNOWN_VISUAL_ROLE_KINDS.pickup, label: "Pickup" },
  { kind: WELL_KNOWN_VISUAL_ROLE_KINDS.muzzleFlash, label: "Muzzle flash" },
  { kind: WELL_KNOWN_VISUAL_ROLE_KINDS.impactVfx, label: "Impact VFX" },
  { kind: WELL_KNOWN_VISUAL_ROLE_KINDS.shield, label: "Shield" },
  { kind: WELL_KNOWN_VISUAL_ROLE_KINDS.shadow, label: "Shadow" },
  { kind: WELL_KNOWN_VISUAL_ROLE_KINDS.hazard, label: "Hazard" },
] as const;

export const resolveBattleRoyaleVisualAssetRoles = (
  project: ProjectManifest | undefined,
): readonly VisualAssetRoleRef[] => {
  const byKind = new Map<string, VisualAssetRoleRef>(
    DEFAULT_BATTLE_ROYALE_VISUAL_ASSET_ROLES.map((role) => [String(role.roleKind), role]),
  );
  for (const role of readProjectVisualAssetRoles(project)) {
    byKind.set(String(role.roleKind), role);
  }
  return [...byKind.values()];
};

interface VisualRolePolicyContext {
  readonly project?: ProjectManifest | undefined;
}

export const BATTLE_ROYALE_VISUAL_ROLE_POLICY = {
  pluginId: PLUGIN_ID,
  roleDefinitions: DEFAULT_BATTLE_ROYALE_VISUAL_ROLE_DEFINITIONS,
  resolveRoles: (context: VisualRolePolicyContext): readonly VisualAssetRoleRef[] =>
    resolveBattleRoyaleVisualAssetRoles(context.project),
};

const defaultModelIds = new Set(DEFAULT_BATTLE_ROYALE_PLAYER_MODEL_REFS.map((entry) => entry.id));
export const DEPRECATED_BATTLE_ROYALE_PLAYER_MODEL_IDS = [
  "vanguard",
  "ranger",
  "medic",
  "engineer",
] as const;
const deprecatedDefaultModelIds: ReadonlySet<string> = new Set(
  DEPRECATED_BATTLE_ROYALE_PLAYER_MODEL_IDS,
);

export const isDefaultBattleRoyalePlayerModelId = (modelId: string): boolean =>
  defaultModelIds.has(modelId);

export const isDeprecatedBattleRoyalePlayerModelId = (modelId: string): boolean =>
  deprecatedDefaultModelIds.has(modelId);
