import {
  AssetLibraryReference,
  AttachmentAnchor,
  PlayerModelClipSet,
  PlayerModelRef,
  VisualAnchorPoint,
  makeClipId,
  makePackId,
} from "@tileborne/core";

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
    // Model-local attachment anchor where equipped weapon entities mount
    // (composed with the weapon entity's "grip" anchor, ADR-0028 §2b).
    anchors: {
      hand: new AttachmentAnchor({ point: new VisualAnchorPoint({ x: 0.64, y: 0.56 }) }),
    },
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
