/**
 * Battle royale render texture ids for the ADR-0014 Phase 0 slice:
 * - Player sprites: resolved from validated player-model atlas assets
 * - Projectile sprite: `@tileborne-plugins/battle-royale:projectile-bolt`
 *
 * The frontend bridge should preload textures for these ids before calling
 * PixiRendererAdapter.renderFromEntities().
 */
import * as BattleRoyaleProtocol from "@tileborne/ipc-contracts/protocols/battle-royale";
import { WELL_KNOWN_VISUAL_ROLE_KINDS, type PlayerModelClipKey } from "@tileborne/core";
import type {
  RenderableAnimationFrame,
  RenderableEntityAnimation,
  RenderableEntity,
  RenderableEntityProjector,
  RuntimePluginRenderManifest,
} from "@tileborne/runtime";
import { Option } from "effect";

import {
  createBattleRoyaleBundledAssets,
  DECOY_TEXTURE_ASSET_ID,
  SCAN_PULSE_TEXTURE_ASSET_ID,
  TRAP_TEXTURE_ASSET_ID,
  UI_PIXEL_TEXTURE_ASSET_ID,
} from "./bundled-assets.js";
import { BATTLE_ROYALE_VISUAL_ORACLE, type VisualSize } from "./visual-oracle.js";

type BattleRoyaleSnapshot =
  | BattleRoyaleProtocol.WelcomeSnapshot
  | BattleRoyaleProtocol.DeltaSnapshot;

type PlayerId = BattleRoyaleProtocol.PlayerId;
export type InputDirection = BattleRoyaleProtocol.Direction8;

interface PlayerProjectionState {
  readonly team?: string;
  readonly x: number;
  readonly y: number;
  readonly health: number;
  readonly shield?: number;
  readonly armor?: BattleRoyaleProtocol.PlayerArmorSnapshot;
  readonly weapon?: BattleRoyaleProtocol.PlayerWeaponSnapshot;
  readonly inventory?: BattleRoyaleProtocol.PlayerInventorySnapshot;
  readonly pickupPrompt?: BattleRoyaleProtocol.PlayerPickupPromptSnapshot;
  readonly pickupToast?: BattleRoyaleProtocol.PlayerPickupToastSnapshot;
  readonly damageIndicator?: BattleRoyaleProtocol.PlayerDamageIndicatorSnapshot;
  readonly stats?: BattleRoyaleProtocol.PlayerStatsSnapshot;
  readonly statusEffects?: readonly BattleRoyaleProtocol.PlayerStatusSnapshot[];
  readonly abilityCooldowns?: readonly BattleRoyaleProtocol.PlayerAbilityCooldownSnapshot[];
  readonly modelId?: string;
  readonly animation?: BattleRoyaleProtocol.PlayerAnimationState;
}

/**
 * Plugin-agnostic render data for a resolved player model: the atlas asset id to
 * render plus the per-frame animation (UV crops + durations) and pivot. Built by
 * the shell from the per-project roster + loaded packs and injected into the
 * projector so the projector only CONSUMES resolved refs (ADR-0014).
 */
export interface PlayerModelRenderData {
  readonly assetId: string;
  readonly clips: Readonly<Record<PlayerModelClipKey, PlayerModelClipRenderData>>;
  readonly anchor?: { readonly x: number; readonly y: number };
  readonly worldSize?: VisualSize;
  readonly renderScale?: number;
}

export interface BattleRoyaleProjectorConfig {
  /** modelId -> resolved render data (atlas + animation frames + anchor). */
  readonly catalog?: ReadonlyMap<string, PlayerModelRenderData>;
  /** visualRoleKind -> resolved render data from project visual role settings. */
  readonly visualRoles?: ReadonlyMap<string, VisualRoleRenderData>;
}

export interface PlayerModelClipRenderData {
  readonly frames: readonly RenderableAnimationFrame[];
  readonly loop: boolean;
  readonly defaultDurationMs?: number;
}

export interface VisualRoleRenderData {
  readonly roleId: string;
  readonly roleKind: string;
  readonly assetId: string;
  readonly frames: readonly RenderableAnimationFrame[];
  readonly loop: boolean;
  readonly defaultDurationMs?: number;
  readonly anchor?: { readonly x: number; readonly y: number };
  readonly anchors?: Readonly<
    Record<
      string,
      {
        readonly point: { readonly x: number; readonly y: number };
        readonly rotationDeg?: number;
        readonly zOffset?: number;
      }
    >
  >;
  readonly renderScale?: number;
}

interface ProjectileProjectionState {
  readonly x: number;
  readonly y: number;
  readonly rot: number;
  readonly ownerId: PlayerId;
}

interface ImpactProjectionState {
  readonly x: number;
  readonly y: number;
  readonly rot: number;
  readonly startedTick: number;
}

interface DeployableProjectionState {
  readonly kind: BattleRoyaleProtocol.DeployableKind;
  readonly ownerId: BattleRoyaleProtocol.DeployableOwnerId;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly remainingTicks: number;
  readonly armedTicks: number;
  readonly triggered: boolean;
}

interface ObjectProjectionState {
  readonly x: number;
  readonly y: number;
  readonly pickup?: BattleRoyaleProtocol.ObjectPickupSnapshot;
  readonly lootSource?: BattleRoyaleProtocol.ObjectLootSourceSnapshot;
  readonly interactable?: BattleRoyaleProtocol.ObjectInteractableSnapshot;
  readonly breakable?: BattleRoyaleProtocol.ObjectBreakableSnapshot;
  readonly hazard?: BattleRoyaleProtocol.ObjectHazardSnapshot;
}

interface BattleRoyaleFullState {
  readonly _tag: "BattleRoyaleFullState";
  readonly tick: number;
  readonly players: ReadonlyMap<PlayerId, PlayerProjectionState>;
  readonly projectiles: ReadonlyMap<string, ProjectileProjectionState>;
  readonly impacts: ReadonlyMap<string, ImpactProjectionState>;
  readonly deployables: ReadonlyMap<string, DeployableProjectionState>;
  readonly objects: ReadonlyMap<string, ObjectProjectionState>;
  readonly zone: ZoneView;
}

export interface InitialFramePlayerView {
  readonly playerId: string;
  readonly team?: string;
  readonly x: number;
  readonly y: number;
  readonly health: number;
  readonly shield?: number;
  readonly armor?: BattleRoyaleProtocol.PlayerArmorSnapshot;
  readonly weapon?: BattleRoyaleProtocol.PlayerWeaponSnapshot;
  readonly inventory?: BattleRoyaleProtocol.PlayerInventorySnapshot;
  readonly pickupPrompt?: BattleRoyaleProtocol.PlayerPickupPromptSnapshot;
  readonly pickupToast?: BattleRoyaleProtocol.PlayerPickupToastSnapshot;
  readonly damageIndicator?: BattleRoyaleProtocol.PlayerDamageIndicatorSnapshot;
  readonly stats?: BattleRoyaleProtocol.PlayerStatsSnapshot;
  readonly statusEffects?: readonly BattleRoyaleProtocol.PlayerStatusSnapshot[];
  readonly abilityCooldowns?: readonly BattleRoyaleProtocol.PlayerAbilityCooldownSnapshot[];
  readonly modelId?: string;
  readonly animation?: BattleRoyaleProtocol.PlayerAnimationState;
}

export interface FramePlayerUpdateView {
  readonly playerId: string;
  readonly team?: string;
  readonly x?: number;
  readonly y?: number;
  readonly health?: number;
  readonly shield?: number;
  readonly armor?: BattleRoyaleProtocol.PlayerArmorSnapshot;
  readonly weapon?: BattleRoyaleProtocol.PlayerWeaponSnapshot;
  readonly inventory?: BattleRoyaleProtocol.PlayerInventorySnapshot;
  readonly pickupPrompt?: BattleRoyaleProtocol.PlayerPickupPromptSnapshot;
  readonly pickupToast?: BattleRoyaleProtocol.PlayerPickupToastSnapshot;
  readonly damageIndicator?: BattleRoyaleProtocol.PlayerDamageIndicatorSnapshot;
  readonly stats?: BattleRoyaleProtocol.PlayerStatsSnapshot;
  readonly statusEffects?: readonly BattleRoyaleProtocol.PlayerStatusSnapshot[];
  readonly abilityCooldowns?: readonly BattleRoyaleProtocol.PlayerAbilityCooldownSnapshot[];
  readonly animation?: BattleRoyaleProtocol.PlayerAnimationState;
}

export interface FrameObjectView {
  readonly objectId: string;
  readonly x: number;
  readonly y: number;
  readonly pickup?: BattleRoyaleProtocol.ObjectPickupSnapshot;
  readonly lootSource?: BattleRoyaleProtocol.ObjectLootSourceSnapshot;
  readonly interactable?: BattleRoyaleProtocol.ObjectInteractableSnapshot;
  readonly breakable?: BattleRoyaleProtocol.ObjectBreakableSnapshot;
  readonly hazard?: BattleRoyaleProtocol.ObjectHazardSnapshot;
}

export interface ZoneView {
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
}

export type ServerFrameView =
  | {
      readonly kind: "initial";
      readonly tick: number;
      readonly players: readonly InitialFramePlayerView[];
      readonly objects?: readonly FrameObjectView[];
      readonly zone: ZoneView;
    }
  | {
      readonly kind: "delta";
      readonly tick: number;
      readonly removed: readonly string[];
      readonly updated: readonly FramePlayerUpdateView[];
      readonly objectsUpdated?: readonly FrameObjectView[];
      readonly objectsRemoved?: readonly string[];
      readonly zone: ZoneView | undefined;
    }
  | { readonly kind: "joined"; readonly id: string }
  | { readonly kind: "left"; readonly id: string }
  | { readonly kind: "killed"; readonly killer: string; readonly victim: string; readonly tick: number }
  | { readonly kind: "game-over"; readonly winner: string };

export interface InitialFrameInput {
  readonly tick: number;
  readonly players: readonly InitialFramePlayerView[];
  readonly zone: ZoneView;
}

export interface ClientInputFrame {
  readonly tick: number;
  readonly seq: number;
  readonly dir?: InputDirection;
  readonly shoot: boolean;
  readonly reload: boolean;
  readonly interact: boolean;
  readonly drop: boolean;
  readonly abilities: readonly BattleRoyaleProtocol.BattleRoyaleAbilityId[];
  readonly aimDeg?: number;
  readonly swapSlot?: number;
}

export type ClientFrameView =
  | { readonly kind: "heartbeat"; readonly tick: number }
  | { readonly kind: "ack"; readonly tick: number; readonly receivedAtMs: number }
  | ({ readonly kind: "input" } & ClientInputFrame);

export { PLAYER_TEXTURE_ASSET_ID, PROJECTILE_TEXTURE_ASSET_ID } from "./bundled-assets.js";

const renderManifest: RuntimePluginRenderManifest = {
  fixedZoom: 4,
  hudInsets: { top: 0, right: 0, bottom: 0, left: 0 },
};

const PROJECTILE_ANCHOR = { x: 0.5, y: 0.5 } as const;
const CENTER_ANCHOR = { x: 0.5, y: 0.5 } as const;
const HEALTH_BAR_WIDTH = 24;
const HEALTH_BAR_HEIGHT = 3;
const PLAYER_BAR_OFFSET_Y = -20;
const CRATE_HEALTH_BAR_WIDTH = 20;
const IMPACT_LIFETIME_TICKS = 5;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isBattleRoyaleSnapshot = (snapshot: unknown): snapshot is BattleRoyaleSnapshot =>
  isRecord(snapshot) &&
  (snapshot._tag === "WelcomeSnapshot" || snapshot._tag === "DeltaSnapshot");

const isWelcomeFrame = (snapshot: unknown): snapshot is BattleRoyaleProtocol.WelcomeSnapshot =>
  isRecord(snapshot) && snapshot._tag === "WelcomeSnapshot";

const isDeltaFrame = (snapshot: unknown): snapshot is BattleRoyaleProtocol.DeltaSnapshot =>
  isRecord(snapshot) && snapshot._tag === "DeltaSnapshot";

const isBattleRoyaleFullState = (snapshot: unknown): snapshot is BattleRoyaleFullState =>
  isRecord(snapshot) &&
  snapshot._tag === "BattleRoyaleFullState" &&
  snapshot.players instanceof Map &&
    snapshot.projectiles instanceof Map &&
    snapshot.impacts instanceof Map &&
    snapshot.deployables instanceof Map &&
    snapshot.objects instanceof Map;

const optionOr = <Value>(value: Option.Option<Value> | undefined, fallback: Value): Value =>
  value !== undefined && Option.isSome(value) ? value.value : fallback;

const projectileKey = (id: BattleRoyaleProtocol.ProjectileId): string => String(id);

const toPlayerState = (player: BattleRoyaleProtocol.PlayerSnapshot): PlayerProjectionState => ({
  ...(player.team === undefined ? {} : { team: player.team }),
  x: player.x,
  y: player.y,
  health: player.health,
  ...(player.shield === undefined ? {} : { shield: player.shield }),
  ...(player.armor === undefined ? {} : { armor: player.armor }),
  ...(player.weapon === undefined ? {} : { weapon: player.weapon }),
  ...(player.inventory === undefined ? {} : { inventory: player.inventory }),
  ...(player.pickupPrompt === undefined ? {} : { pickupPrompt: player.pickupPrompt }),
  ...(player.pickupToast === undefined ? {} : { pickupToast: player.pickupToast }),
  ...(player.damageIndicator === undefined ? {} : { damageIndicator: player.damageIndicator }),
  ...(player.stats === undefined ? {} : { stats: player.stats }),
  ...(player.statusEffects === undefined ? {} : { statusEffects: player.statusEffects }),
  ...(player.abilityCooldowns === undefined ? {} : { abilityCooldowns: player.abilityCooldowns }),
  ...(player.modelId === undefined ? {} : { modelId: player.modelId }),
  ...(player.animation === undefined ? {} : { animation: player.animation }),
});

const toProjectileState = (
  projectile: BattleRoyaleProtocol.ProjectileSnapshot,
): ProjectileProjectionState => ({
  x: projectile.x,
  y: projectile.y,
  rot: projectile.rotation,
  ownerId: projectile.ownerPlayerId,
});

const deployableKey = (id: BattleRoyaleProtocol.DeployableId): string => String(id);
const objectKey = (id: BattleRoyaleProtocol.ObjectId): string => String(id);

const toDeployableState = (
  deployable: BattleRoyaleProtocol.DeployableSnapshot,
): DeployableProjectionState => ({
  kind: deployable.kind,
  ownerId: deployable.ownerId,
  x: deployable.x,
  y: deployable.y,
  radius: deployable.radius,
  remainingTicks: deployable.remainingTicks,
  armedTicks: deployable.armedTicks,
  triggered: deployable.triggered,
});

const toObjectState = (object: BattleRoyaleProtocol.ObjectSnapshot): ObjectProjectionState => ({
  x: object.x,
  y: object.y,
  ...(object.pickup === undefined ? {} : { pickup: object.pickup }),
  ...(object.lootSource === undefined ? {} : { lootSource: object.lootSource }),
  ...(object.interactable === undefined ? {} : { interactable: object.interactable }),
  ...(object.breakable === undefined ? {} : { breakable: object.breakable }),
  ...(object.hazard === undefined ? {} : { hazard: object.hazard }),
});

export const mergeBattleRoyaleFrame = (
  previousFullState: unknown | undefined,
  frame: unknown,
): unknown => {
  if (!isBattleRoyaleSnapshot(frame)) {
    return previousFullState;
  }

  if (frame._tag === "WelcomeSnapshot") {
    return {
      _tag: "BattleRoyaleFullState",
      tick: frame.tick,
      players: new Map(frame.players.map((player) => [player.id, toPlayerState(player)])),
      projectiles: new Map(
        frame.projectiles.map((projectile) => [projectileKey(projectile.id), toProjectileState(projectile)]),
      ),
      impacts: new Map(),
      deployables: new Map(
        (frame.deployables ?? []).map((deployable) => [deployableKey(deployable.id), toDeployableState(deployable)]),
      ),
      objects: new Map(
        (frame.objects ?? []).map((object) => [objectKey(object.id), toObjectState(object)]),
      ),
      zone: frame.zone,
    } satisfies BattleRoyaleFullState;
  }

  const players = new Map(
    isBattleRoyaleFullState(previousFullState) ? previousFullState.players : [],
  );
  for (const playerId of frame.removed) {
    players.delete(playerId);
  }
  for (const update of frame.updated) {
    const current = players.get(update.id) ?? { x: 0, y: 0, health: 0 };
    const team = optionOr(update.team, current.team);
    const animation = optionOr(update.animation, current.animation);
    const shield = optionOr(update.shield, current.shield);
    const armor = optionOr(update.armor, current.armor);
    const weapon = optionOr(update.weapon, current.weapon);
    const inventory = optionOr(update.inventory, current.inventory);
    const pickupPrompt = optionOr(update.pickupPrompt, current.pickupPrompt);
    const pickupToast = optionOr(update.pickupToast, current.pickupToast);
    const damageIndicator = optionOr(update.damageIndicator, current.damageIndicator);
    const stats = optionOr(update.stats, current.stats);
    const statusEffects = optionOr(update.statusEffects, current.statusEffects);
    const abilityCooldowns = optionOr(update.abilityCooldowns, current.abilityCooldowns);
    const nextPlayer: PlayerProjectionState = {
      x: optionOr(update.x, current.x),
      ...(team === undefined ? {} : { team }),
      y: optionOr(update.y, current.y),
      health: optionOr(update.health, current.health),
      ...(shield === undefined ? {} : { shield }),
      ...(armor === undefined ? {} : { armor }),
      ...(weapon === undefined ? {} : { weapon }),
      ...(inventory === undefined ? {} : { inventory }),
      ...(pickupPrompt === undefined ? {} : { pickupPrompt }),
      ...(pickupToast === undefined ? {} : { pickupToast }),
      ...(damageIndicator === undefined ? {} : { damageIndicator }),
      ...(stats === undefined ? {} : { stats }),
      ...(statusEffects === undefined ? {} : { statusEffects }),
      ...(abilityCooldowns === undefined ? {} : { abilityCooldowns }),
      // modelId is set at spawn (Welcome) and is stable; preserve across deltas.
      ...(current.modelId === undefined ? {} : { modelId: current.modelId }),
      ...(animation === undefined ? {} : { animation }),
    };
    players.set(update.id, nextPlayer);
  }

  const projectiles = new Map(
    isBattleRoyaleFullState(previousFullState) ? previousFullState.projectiles : [],
  );
  const impacts = new Map(
    [...(isBattleRoyaleFullState(previousFullState) ? previousFullState.impacts : [])]
      .filter(([, impact]) => frame.tick - impact.startedTick <= IMPACT_LIFETIME_TICKS),
  );
  for (const projectileId of frame.projectilesRemoved) {
    const id = projectileKey(projectileId);
    const current = projectiles.get(id);
    if (current !== undefined) {
      impacts.set(`${id}:${frame.tick}`, {
        x: current.x,
        y: current.y,
        rot: current.rot,
        startedTick: frame.tick,
      });
    }
    projectiles.delete(projectileKey(projectileId));
  }
  for (const update of frame.projectilesUpdated) {
    const id = projectileKey(update.id);
    const current = projectiles.get(id) ?? {
      x: 0,
      y: 0,
      rot: 0,
      ownerId: BattleRoyaleProtocol.makePlayerId("unknown"),
    };
    projectiles.set(id, {
      x: optionOr(update.x, current.x),
      y: optionOr(update.y, current.y),
      rot: optionOr(update.rotation, current.rot),
      ownerId: optionOr(update.ownerPlayerId, current.ownerId),
    });
  }

  const deployables = new Map(
    isBattleRoyaleFullState(previousFullState) ? previousFullState.deployables : [],
  );
  for (const deployableId of frame.deployablesRemoved ?? []) {
    deployables.delete(deployableKey(deployableId));
  }
  for (const update of frame.deployablesUpdated ?? []) {
    const id = deployableKey(update.id);
    const current = deployables.get(id) ?? {
      kind: "trap" as const,
      ownerId: BattleRoyaleProtocol.makeDeployableOwnerId("unknown"),
      x: 0,
      y: 0,
      radius: 0,
      remainingTicks: 0,
      armedTicks: 0,
      triggered: false,
    };
    deployables.set(id, {
      kind: optionOr(update.kind, current.kind),
      ownerId: optionOr(update.ownerId, current.ownerId),
      x: optionOr(update.x, current.x),
      y: optionOr(update.y, current.y),
      radius: optionOr(update.radius, current.radius),
      remainingTicks: optionOr(update.remainingTicks, current.remainingTicks),
      armedTicks: optionOr(update.armedTicks, current.armedTicks),
      triggered: optionOr(update.triggered, current.triggered),
    });
  }

  const objects = new Map(
    isBattleRoyaleFullState(previousFullState) ? previousFullState.objects : [],
  );
  for (const objectId of frame.objectsRemoved ?? []) {
    objects.delete(objectKey(objectId));
  }
  for (const object of frame.objectsUpdated ?? []) {
    objects.set(objectKey(object.id), toObjectState(object));
  }

  return {
    _tag: "BattleRoyaleFullState",
    tick: frame.tick,
    players,
    projectiles,
    impacts,
    deployables,
    objects,
    zone: optionOr(frame.zone, isBattleRoyaleFullState(previousFullState) ? previousFullState.zone : { cx: 0, cy: 0, radius: 0 }),
  } satisfies BattleRoyaleFullState;
};

const facingDegToRadians = (facingDeg: number): number => (facingDeg * Math.PI) / 180;

const degToRadians = (degrees: number): number => (degrees * Math.PI) / 180;

const healthTint = (health: number): number => {
  if (health >= 65) {
    return 0x22c55e;
  }
  if (health >= 35) {
    return 0xfacc15;
  }
  return 0xef4444;
};

const tierTint = (tier: string | undefined): number => {
  if (tier === "legendary") {
    return 0xf97316;
  }
  if (tier === "epic") {
    return 0xa78bfa;
  }
  if (tier === "rare") {
    return 0x38bdf8;
  }
  return 0xeab308;
};

const playerHealthEntities = (id: PlayerId, player: PlayerProjectionState): readonly RenderableEntity[] => {
  const pct = Math.max(0, Math.min(1, player.health / 100));
  if (pct <= 0) {
    return [];
  }
  return [
    {
      id: `br:health-back:${id}`,
      assetId: UI_PIXEL_TEXTURE_ASSET_ID,
      x: player.x,
      y: player.y + PLAYER_BAR_OFFSET_Y,
      anchor: CENTER_ANCHOR,
      scaleX: HEALTH_BAR_WIDTH,
      scaleY: HEALTH_BAR_HEIGHT + 2,
      tint: 0x111827,
      opacity: 0.8,
      layerIndex: 30,
    },
    {
      id: `br:health-fill:${id}`,
      assetId: UI_PIXEL_TEXTURE_ASSET_ID,
      x: player.x - ((1 - pct) * HEALTH_BAR_WIDTH) / 2,
      y: player.y + PLAYER_BAR_OFFSET_Y,
      anchor: CENTER_ANCHOR,
      scaleX: Math.max(1, HEALTH_BAR_WIDTH * pct),
      scaleY: HEALTH_BAR_HEIGHT,
      tint: healthTint(player.health),
      opacity: 0.95,
      layerIndex: 31,
    },
  ];
};

const playerStatusEntities = (id: PlayerId, player: PlayerProjectionState): readonly RenderableEntity[] =>
  (player.statusEffects ?? []).map((effect, index) => ({
    id: `br:status:${id}:${effect.effectId}`,
    assetId: SCAN_PULSE_TEXTURE_ASSET_ID,
    x: player.x,
    y: player.y,
    anchor: CENTER_ANCHOR,
    scale: 1.05 + index * 0.18,
    tint: effect.effectId.includes("shield") ? 0x38bdf8 : 0xa78bfa,
    opacity: Math.min(0.85, 0.35 + effect.stacks * 0.15),
    layerIndex: 9,
  }));

const visualRoleFor = (
  config: BattleRoyaleProjectorConfig | undefined,
  roleKind: string,
): VisualRoleRenderData | undefined => config?.visualRoles?.get(roleKind);

const visualRoleScale = (visual: VisualRoleRenderData): number =>
  visual.renderScale === undefined ||
  !Number.isFinite(visual.renderScale) ||
  visual.renderScale <= 0
    ? 1
    : visual.renderScale;

const visualRoleAnchorPoint = (
  visual: VisualRoleRenderData,
  name: string,
  fallback: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number } => visual.anchors?.[name]?.point ?? fallback;

const visualRoleAnchorRotation = (
  visual: VisualRoleRenderData | undefined,
  name: string,
): number => {
  const degrees = visual?.anchors?.[name]?.rotationDeg;
  return degrees === undefined || !Number.isFinite(degrees) ? 0 : degToRadians(degrees);
};

const visualRoleAnchorZOffset = (
  visual: VisualRoleRenderData | undefined,
  name: string,
): number => {
  const offset = visual?.anchors?.[name]?.zOffset;
  return offset === undefined || !Number.isFinite(offset) ? 0 : offset;
};

const visualRoleFrameSize = (
  visual: VisualRoleRenderData,
): { readonly width: number; readonly height: number } | undefined => {
  const uv = visual.frames[0]?.uv;
  if (uv === undefined || uv.w <= 0 || uv.h <= 0) {
    return undefined;
  }
  return { width: uv.w, height: uv.h };
};

const weaponDisplayScale = (
  visual: VisualRoleRenderData,
): { readonly scaleX: number; readonly scaleY: number } => {
  const scale = visualRoleScale(visual);
  return { scaleX: 0.72 * scale, scaleY: 0.58 * scale };
};

const weaponMountPoint = (
  player: PlayerProjectionState,
  radians: number,
): { readonly x: number; readonly y: number } => ({
  x: player.x + Math.cos(radians) * 9,
  y: player.y + Math.sin(radians) * 9,
});

const weaponMuzzlePoint = (
  player: PlayerProjectionState,
  weaponVisual: VisualRoleRenderData | undefined,
  mountRotation: number,
  weaponRotation: number,
): { readonly x: number; readonly y: number } => {
  const mount = weaponMountPoint(player, mountRotation);
  if (weaponVisual === undefined) {
    return {
      x: player.x + Math.cos(mountRotation) * 14,
      y: player.y + Math.sin(mountRotation) * 14,
    };
  }
  const frameSize = visualRoleFrameSize(weaponVisual);
  if (frameSize === undefined) {
    return mount;
  }
  const hand = visualRoleAnchorPoint(weaponVisual, "hand", weaponVisual.anchor ?? CENTER_ANCHOR);
  const muzzle = visualRoleAnchorPoint(weaponVisual, "muzzle", { x: 0.92, y: 0.5 });
  const { scaleX, scaleY } = weaponDisplayScale(weaponVisual);
  const dx = (muzzle.x - hand.x) * frameSize.width * scaleX;
  const dy = (muzzle.y - hand.y) * frameSize.height * scaleY;
  return {
    x: mount.x + dx * Math.cos(weaponRotation) - dy * Math.sin(weaponRotation),
    y: mount.y + dx * Math.sin(weaponRotation) + dy * Math.cos(weaponRotation),
  };
};

const visualRoleAnimation = (
  visual: VisualRoleRenderData,
  clockMs: number,
): RenderableEntityAnimation | undefined => {
  if (visual.frames.length === 0) {
    return undefined;
  }
  return {
    clipId: visual.roleId,
    frames: visual.frames,
    loop: visual.loop,
    ...(visual.defaultDurationMs === undefined ? {} : { defaultDurationMs: visual.defaultDurationMs }),
    clockMs,
  };
};

const visualRoleBase = (
  visual: VisualRoleRenderData,
  clockMs: number,
): Pick<RenderableEntity, "assetId" | "anchor" | "animation"> | undefined => {
  const animation = visualRoleAnimation(visual, clockMs);
  if (animation === undefined) {
    return undefined;
  }
  return {
    assetId: visual.assetId,
    anchor: visual.anchor ?? CENTER_ANCHOR,
    animation,
  };
};

const playerShadowEntity = (
  id: PlayerId,
  player: PlayerProjectionState,
  visual: VisualRoleRenderData | undefined,
  clockMs: number,
): readonly RenderableEntity[] => {
  if (visual === undefined) {
    return [];
  }
  const base = visualRoleBase(visual, clockMs);
  if (base === undefined) {
    return [];
  }
  const scale = visualRoleScale(visual);
  return [{
    id: `br:shadow:${id}`,
    ...base,
    x: player.x,
    y: player.y + 8,
    scaleX: 1.15 * scale,
    scaleY: 0.42 * scale,
    tint: 0x020617,
    opacity: 0.34,
    layerIndex: 6,
  }];
};

const playerWorldSize = (model: PlayerModelRenderData): VisualSize => {
  const base = model.worldSize ?? BATTLE_ROYALE_VISUAL_ORACLE.render.playerWorldFootprint;
  const scale =
    model.renderScale === undefined || !Number.isFinite(model.renderScale) || model.renderScale <= 0
      ? 1
      : Math.min(8, model.renderScale);
  return { width: base.width * scale, height: base.height * scale };
};

const playerDisplayScale = (
  model: PlayerModelRenderData,
  clip: PlayerModelClipRenderData,
): { readonly scaleX: number; readonly scaleY: number } => {
  const firstFrame = clip.frames[0];
  const uv = firstFrame?.uv;
  if (uv === undefined || uv.w <= 0 || uv.h <= 0) {
    return { scaleX: 1, scaleY: 1 };
  }
  const worldSize = playerWorldSize(model);
  return {
    scaleX: worldSize.width / uv.w,
    scaleY: worldSize.height / uv.h,
  };
};

const equippedWeaponEntity = (
  id: PlayerId,
  player: PlayerProjectionState,
  visual: VisualRoleRenderData | undefined,
  clockMs: number,
): readonly RenderableEntity[] => {
  const animation = player.animation;
  if (animation === undefined || visual === undefined) {
    return [];
  }
  const base = visualRoleBase(visual, clockMs);
  if (base === undefined) {
    return [];
  }
  const aimDeg = animation.aimDeg ?? animation.facingDeg;
  const radians = facingDegToRadians(aimDeg);
  const weaponRotation = radians + visualRoleAnchorRotation(visual, "hand");
  const mount = weaponMountPoint(player, radians);
  const { scaleX, scaleY } = weaponDisplayScale(visual);
  return [{
    id: `br:weapon:${id}`,
    ...base,
    x: mount.x,
    y: mount.y,
    rotation: weaponRotation,
    anchor: visualRoleAnchorPoint(visual, "hand", base.anchor ?? CENTER_ANCHOR),
    scaleX,
    scaleY,
    tint: 0xe5e7eb,
    opacity: player.health <= 0 ? 0.3 : 0.95,
    layerIndex: 18 + visualRoleAnchorZOffset(visual, "hand"),
  }];
};

const muzzleFlashEntity = (
  id: PlayerId,
  player: PlayerProjectionState,
  visual: VisualRoleRenderData | undefined,
  weaponVisual: VisualRoleRenderData | undefined,
  clockMs: number,
): readonly RenderableEntity[] => {
  const animation = player.animation;
  if (animation?.clipKey !== "shoot" || visual === undefined) {
    return [];
  }
  const base = visualRoleBase(visual, clockMs);
  if (base === undefined) {
    return [];
  }
  const aimDeg = animation.aimDeg ?? animation.facingDeg;
  const radians = facingDegToRadians(aimDeg);
  const weaponRotation = radians + visualRoleAnchorRotation(weaponVisual, "hand");
  const muzzleRotation = weaponRotation + visualRoleAnchorRotation(weaponVisual, "muzzle");
  const muzzle = weaponMuzzlePoint(player, weaponVisual, radians, weaponRotation);
  return [{
    id: `br:muzzle:${id}`,
    ...base,
    x: muzzle.x,
    y: muzzle.y,
    rotation: muzzleRotation,
    scale: 0.55 * visualRoleScale(visual),
    tint: 0xfacc15,
    opacity: 0.9,
    layerIndex: 22 + visualRoleAnchorZOffset(weaponVisual, "muzzle"),
  }];
};

const crateHealthEntities = (id: string, object: ObjectProjectionState): readonly RenderableEntity[] => {
  const breakable = object.breakable;
  if (breakable === undefined || breakable.destroyed || breakable.health >= breakable.maxHealth) {
    return [];
  }
  const pct = Math.max(0, Math.min(1, breakable.health / Math.max(1, breakable.maxHealth)));
  return [
    {
      id: `br:crate-health-back:${id}`,
      assetId: UI_PIXEL_TEXTURE_ASSET_ID,
      x: object.x,
      y: object.y - 18,
      anchor: CENTER_ANCHOR,
      scaleX: CRATE_HEALTH_BAR_WIDTH,
      scaleY: 4,
      tint: 0x111827,
      opacity: 0.75,
      layerIndex: 28,
    },
    {
      id: `br:crate-health-fill:${id}`,
      assetId: UI_PIXEL_TEXTURE_ASSET_ID,
      x: object.x - ((1 - pct) * CRATE_HEALTH_BAR_WIDTH) / 2,
      y: object.y - 18,
      anchor: CENTER_ANCHOR,
      scaleX: Math.max(1, CRATE_HEALTH_BAR_WIDTH * pct),
      scaleY: 2,
      tint: healthTint(pct * 100),
      opacity: 0.9,
      layerIndex: 29,
    },
  ];
};

const objectRenderableEntities = (
  id: string,
  object: ObjectProjectionState,
  config: BattleRoyaleProjectorConfig | undefined,
  clockMs: number,
): readonly RenderableEntity[] => {
  const entities: RenderableEntity[] = [];
  const isCrate = object.lootSource !== undefined || object.pickup !== undefined || object.breakable !== undefined;
  const hazardVisual = visualRoleFor(config, WELL_KNOWN_VISUAL_ROLE_KINDS.hazard);
  const pickupVisual = visualRoleFor(config, WELL_KNOWN_VISUAL_ROLE_KINDS.pickup);
  const hazardBase =
    hazardVisual === undefined ? undefined : visualRoleBase(hazardVisual, clockMs);
  const pickupBase =
    pickupVisual === undefined ? undefined : visualRoleBase(pickupVisual, clockMs);

  if (object.hazard?.enabled && hazardVisual !== undefined && hazardBase !== undefined) {
    entities.push({
      id: `br:hazard:${id}`,
      ...hazardBase,
      x: object.x,
      y: object.y,
      scale: Math.max(1.4, object.hazard.damagePerSecond / 3) * visualRoleScale(hazardVisual),
      tint: 0xef4444,
      opacity: 0.24,
      layerIndex: 3,
    });
  }

  if (isCrate && pickupVisual !== undefined && pickupBase !== undefined) {
    const destroyed = object.breakable?.destroyed === true;
    entities.push({
      id: `br:crate:${id}`,
      ...pickupBase,
      x: object.x,
      y: object.y,
      scale: (destroyed ? 0.9 : 1) * visualRoleScale(pickupVisual),
      tint: destroyed ? 0x64748b : tierTint(object.pickup?.tier ?? object.lootSource?.tier),
      opacity: destroyed ? 0.45 : object.pickup?.available === false ? 0.65 : 1,
      layerIndex: 7,
    });
    entities.push(...crateHealthEntities(id, object));
  }

  if (object.pickup?.available && pickupVisual !== undefined && pickupBase !== undefined) {
    entities.push({
      id: `br:pickup:${id}`,
      ...pickupBase,
      x: object.x,
      y: object.y,
      scale: 0.8 * visualRoleScale(pickupVisual),
      tint: tierTint(object.pickup.tier),
      opacity: 0.72,
      layerIndex: 13,
    });
  }

  if (object.interactable?.enabled) {
    entities.push({
      id: `br:interactable:${id}`,
      assetId: UI_PIXEL_TEXTURE_ASSET_ID,
      x: object.x,
      y: object.y + 15,
      anchor: CENTER_ANCHOR,
      scaleX: Math.max(6, object.interactable.radius / 3),
      scaleY: 2,
      tint: 0xf8fafc,
      opacity: 0.78,
      layerIndex: 14,
    });
  }

  return entities;
};

export const projectBattleRoyaleFullStateWith = (
  config: BattleRoyaleProjectorConfig | undefined,
  snapshot: unknown,
): readonly RenderableEntity[] => {
  if (!isBattleRoyaleFullState(snapshot)) {
    return [];
  }

  // A single deterministic shared clock so every player's clip advances
  // frame-identically and repeated projection of the same snapshot is pure.
  const clockMs = snapshot.tick * 50;
  const equippedWeaponVisual = visualRoleFor(config, WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon);
  const projectileVisual = visualRoleFor(config, WELL_KNOWN_VISUAL_ROLE_KINDS.projectile);
  const muzzleFlashVisual = visualRoleFor(config, WELL_KNOWN_VISUAL_ROLE_KINDS.muzzleFlash);
  const impactVisual = visualRoleFor(config, WELL_KNOWN_VISUAL_ROLE_KINDS.impactVfx);
  const shieldVisual = visualRoleFor(config, WELL_KNOWN_VISUAL_ROLE_KINDS.shield);
  const shadowVisual = visualRoleFor(config, WELL_KNOWN_VISUAL_ROLE_KINDS.shadow);

  const zoneEntity: RenderableEntity =
    {
      id: "br:zone:safe-area",
      assetId: SCAN_PULSE_TEXTURE_ASSET_ID,
      x: snapshot.zone.cx,
      y: snapshot.zone.cy,
      anchor: CENTER_ANCHOR,
      scale: Math.max(1, (snapshot.zone.radius * 2) / 24),
      tint: 0x38bdf8,
      opacity: 0.16,
      layerIndex: 4,
    };

  const playerEntities = [...snapshot.players.entries()]
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
    .flatMap(([id, player]): readonly RenderableEntity[] => {
      const animation = player.animation;
      const model = animation === undefined ? undefined : config?.catalog?.get(animation.modelId);
      const clip = animation === undefined ? undefined : model?.clips[animation.clipKey];
      const shieldEntity: readonly RenderableEntity[] =
        player.shield === undefined || player.shield <= 0 || shieldVisual === undefined
          ? []
          : (() => {
              const base = visualRoleBase(shieldVisual, clockMs);
              return base === undefined
                ? []
                : [{
                    id: `br:shield:${id}`,
                    ...base,
                    x: player.x,
                    y: player.y,
                    scale: 1.35 * visualRoleScale(shieldVisual),
                    layerIndex: 11,
                  }];
            })();
      if (animation !== undefined && model !== undefined && clip !== undefined && clip.frames.length > 0) {
        const displayScale = playerDisplayScale(model, clip);
        return [
          {
            id: `br:player:${id}`,
            assetId: model.assetId,
            x: player.x,
            y: player.y,
            scaleX: displayScale.scaleX,
            scaleY: displayScale.scaleY,
            layerIndex: 10,
            ...(model.anchor === undefined ? {} : { anchor: model.anchor }),
            animation: {
              clipId: `${animation.modelId}:${animation.clipKey}`,
              frames: clip.frames,
              loop: clip.loop,
              ...(clip.defaultDurationMs === undefined
                ? {}
                : { defaultDurationMs: clip.defaultDurationMs }),
              clockMs,
            },
          },
          ...playerShadowEntity(id, player, shadowVisual, clockMs),
          ...equippedWeaponEntity(id, player, equippedWeaponVisual, clockMs),
          ...shieldEntity,
          ...playerStatusEntities(id, player),
          ...playerHealthEntities(id, player),
          ...muzzleFlashEntity(id, player, muzzleFlashVisual, equippedWeaponVisual, clockMs),
        ];
      }
      return [];
    });

  const projectileEntities = [...snapshot.projectiles.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([id, projectile]): readonly RenderableEntity[] => {
      if (projectileVisual === undefined) {
        return [];
      }
      const base = visualRoleBase(projectileVisual, clockMs);
      if (base === undefined) {
        return [];
      }
      const dx = Math.cos(projectile.rot);
      const dy = Math.sin(projectile.rot);
      const scale = visualRoleScale(projectileVisual);
      return [
        {
          id: `br:projectile-trail:${id}`,
          ...base,
          x: projectile.x - dx * 10,
          y: projectile.y - dy * 10,
          rotation: projectile.rot,
          anchor: base.anchor ?? PROJECTILE_ANCHOR,
          scaleX: 0.9 * scale,
          scaleY: 0.55 * scale,
          tint: 0x93c5fd,
          opacity: 0.45,
          layerIndex: 19,
        },
        {
          id: `br:projectile:${id}`,
          ...base,
          x: projectile.x,
          y: projectile.y,
          rotation: projectile.rot,
          anchor: base.anchor ?? PROJECTILE_ANCHOR,
          scale,
          layerIndex: 20,
        },
      ];
    });

  const impactEntities = [...snapshot.impacts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([id, impact]): readonly RenderableEntity[] => {
      if (impactVisual === undefined) {
        return [];
      }
      const base = visualRoleBase(impactVisual, clockMs);
      if (base === undefined) {
        return [];
      }
      const age = Math.max(0, snapshot.tick - impact.startedTick);
      const pct = Math.max(0, 1 - age / IMPACT_LIFETIME_TICKS);
      return [{
        id: `br:impact:${id}`,
        ...base,
        x: impact.x,
        y: impact.y,
        rotation: impact.rot,
        scale: (0.55 + age * 0.12) * visualRoleScale(impactVisual),
        tint: 0xfef08a,
        opacity: 0.75 * pct,
        layerIndex: 21,
      }];
    });

  const deployableEntities = [...snapshot.deployables.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, deployable]): RenderableEntity => ({
      id: `br:deployable:${id}`,
      assetId:
        deployable.kind === "trap"
          ? TRAP_TEXTURE_ASSET_ID
          : deployable.kind === "decoy"
            ? DECOY_TEXTURE_ASSET_ID
            : SCAN_PULSE_TEXTURE_ASSET_ID,
      x: deployable.x,
      y: deployable.y,
      anchor: CENTER_ANCHOR,
      scale: deployable.kind === "scan-pulse" ? Math.max(1, deployable.radius / 24) : 1,
      opacity: deployable.triggered ? 0.95 : 0.75,
      tint: deployable.kind === "trap" ? 0xf97316 : deployable.kind === "decoy" ? 0xa78bfa : 0x38bdf8,
      layerIndex: deployable.kind === "trap" ? 8 : 12,
    }));

  const objectEntities = [...snapshot.objects.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([id, object]) => objectRenderableEntities(id, object, config, clockMs));

  return [
    zoneEntity,
    ...objectEntities,
    ...deployableEntities,
    ...playerEntities,
    ...projectileEntities,
    ...impactEntities,
  ];
};

/** Project with no resolved model catalog: players are omitted instead of drawing placeholders. */
export const projectBattleRoyaleFullState = (snapshot: unknown): readonly RenderableEntity[] =>
  projectBattleRoyaleFullStateWith(undefined, snapshot);

export const createTypedBattleRoyaleProjector = (
  config?: BattleRoyaleProjectorConfig,
): RenderableEntityProjector<unknown> => ({
  project: (snapshot) => projectBattleRoyaleFullStateWith(config, snapshot),
  mergeFrame: mergeBattleRoyaleFrame,
  getFrameTimestamp: (frame) => {
    if ((isWelcomeFrame(frame) || isDeltaFrame(frame)) && Number.isFinite(frame.serverTimestampMs)) {
      return frame.serverTimestampMs;
    }
    return undefined;
  },
  getRenderManifest: createBattleRoyaleRenderManifest,
  textureManifestForAtlas,
});

export const createBattleRoyaleProjector = (
  config?: BattleRoyaleProjectorConfig,
): RenderableEntityProjector<unknown> => {
  return createTypedBattleRoyaleProjector(config);
};

export const textureManifestForAtlas = (): readonly {
  readonly assetId: string;
  readonly path: string;
}[] =>
  createBattleRoyaleBundledAssets().map((asset) => ({
    assetId: asset.assetId,
    path: asset.path,
  }));

export const requiredBattleRoyaleRenderableAssetIds = (): readonly string[] => [
  SCAN_PULSE_TEXTURE_ASSET_ID,
  DECOY_TEXTURE_ASSET_ID,
  TRAP_TEXTURE_ASSET_ID,
  UI_PIXEL_TEXTURE_ASSET_ID,
];

export const createBattleRoyaleRenderManifest = (): RuntimePluginRenderManifest => renderManifest;

export const decodeServerFrame = (bytes: Uint8Array): unknown =>
  BattleRoyaleProtocol.decodeServerMessage(bytes);

export const encodeServerFrame = (frame: unknown): Uint8Array => {
  if (!isRecord(frame)) {
    throw new Error("Cannot encode non-object server frame");
  }
  return BattleRoyaleProtocol.encodeServerMessage(
    frame as BattleRoyaleProtocol.ServerToClientMessage,
  );
};

export const createInitialFrame = (input: InitialFrameInput): unknown =>
  new BattleRoyaleProtocol.WelcomeSnapshot({
    tick: input.tick,
    serverTimestampMs: 0,
    seed: 0,
    players: input.players.map((player) => ({
      id: BattleRoyaleProtocol.makePlayerId(player.playerId),
      ...(player.team === undefined ? {} : { team: player.team }),
      x: player.x,
      y: player.y,
      health: player.health,
      ...(player.shield === undefined ? {} : { shield: player.shield }),
      ...(player.armor === undefined ? {} : { armor: player.armor }),
      ...(player.weapon === undefined ? {} : { weapon: player.weapon }),
      ...(player.inventory === undefined ? {} : { inventory: player.inventory }),
      ...(player.pickupPrompt === undefined ? {} : { pickupPrompt: player.pickupPrompt }),
      ...(player.pickupToast === undefined ? {} : { pickupToast: player.pickupToast }),
      ...(player.damageIndicator === undefined ? {} : { damageIndicator: player.damageIndicator }),
      ...(player.stats === undefined ? {} : { stats: player.stats }),
      ...(player.statusEffects === undefined ? {} : { statusEffects: [...player.statusEffects] }),
      ...(player.abilityCooldowns === undefined ? {} : { abilityCooldowns: [...player.abilityCooldowns] }),
      ...(player.modelId === undefined ? {} : { modelId: player.modelId }),
      ...(player.animation === undefined ? {} : { animation: player.animation }),
    })),
    projectiles: [],
    deployables: [],
    objects: [],
    zone: input.zone,
  });

export const encodeHeartbeatFrame = (tick: number): Uint8Array =>
  BattleRoyaleProtocol.encodeClientMessage(new BattleRoyaleProtocol.Heartbeat({ tick }));

export const encodeSnapshotAckFrame = (tick: number, receivedAtMs: number): Uint8Array =>
  BattleRoyaleProtocol.encodeClientMessage(new BattleRoyaleProtocol.SnapshotAck({ tick, receivedAtMs }));

export const encodeClientInputFrame = (input: ClientInputFrame): Uint8Array =>
  BattleRoyaleProtocol.encodeClientMessage(
    new BattleRoyaleProtocol.PlayerInput({
      tick: input.tick,
      seq: input.seq,
      dir: input.dir === undefined ? Option.none() : Option.some(input.dir),
      shoot: input.shoot,
      reload: input.reload,
      interact: input.interact,
      drop: input.drop,
      abilities: [...input.abilities],
      aimDeg: input.aimDeg === undefined ? Option.none() : Option.some(input.aimDeg),
      swapSlot: input.swapSlot === undefined ? Option.none() : Option.some(input.swapSlot),
    }),
  );

export const decodeClientFrameView = (bytes: Uint8Array): ClientFrameView | undefined => {
  const frame = BattleRoyaleProtocol.decodeClientMessage(bytes);
  if (frame._tag === "Heartbeat") {
    return { kind: "heartbeat", tick: frame.tick };
  }
  if (frame._tag === "SnapshotAck") {
    return { kind: "ack", tick: frame.tick, receivedAtMs: frame.receivedAtMs };
  }
  if (frame._tag === "PlayerInput") {
    return {
      kind: "input",
      tick: frame.tick,
      seq: frame.seq,
      ...(Option.isSome(frame.dir) ? { dir: frame.dir.value } : {}),
      shoot: frame.shoot,
      reload: frame.reload,
      interact: frame.interact,
      drop: frame.drop,
      abilities: [...frame.abilities],
      ...(Option.isSome(frame.aimDeg) ? { aimDeg: frame.aimDeg.value } : {}),
      ...(Option.isSome(frame.swapSlot) ? { swapSlot: frame.swapSlot.value } : {}),
    };
  }
  return undefined;
};

const objectFrameView = (object: BattleRoyaleProtocol.ObjectSnapshot): FrameObjectView => ({
  objectId: object.id,
  x: object.x,
  y: object.y,
  ...(object.pickup === undefined ? {} : { pickup: object.pickup }),
  ...(object.lootSource === undefined ? {} : { lootSource: object.lootSource }),
  ...(object.interactable === undefined ? {} : { interactable: object.interactable }),
  ...(object.breakable === undefined ? {} : { breakable: object.breakable }),
  ...(object.hazard === undefined ? {} : { hazard: object.hazard }),
});

export const serverFrameToView = (frame: unknown): ServerFrameView | undefined => {
  if (!isRecord(frame) || typeof frame._tag !== "string") {
    return undefined;
  }
  if (isWelcomeFrame(frame)) {
    return {
      kind: "initial",
      tick: frame.tick,
      players: frame.players.map((player) => ({
        playerId: player.id,
        ...(player.team === undefined ? {} : { team: player.team }),
        x: player.x,
        y: player.y,
        health: player.health,
        ...(player.shield === undefined ? {} : { shield: player.shield }),
        ...(player.armor === undefined ? {} : { armor: player.armor }),
        ...(player.weapon === undefined ? {} : { weapon: player.weapon }),
        ...(player.inventory === undefined ? {} : { inventory: player.inventory }),
        ...(player.pickupPrompt === undefined ? {} : { pickupPrompt: player.pickupPrompt }),
        ...(player.pickupToast === undefined ? {} : { pickupToast: player.pickupToast }),
        ...(player.damageIndicator === undefined ? {} : { damageIndicator: player.damageIndicator }),
        ...(player.stats === undefined ? {} : { stats: player.stats }),
        ...(player.statusEffects === undefined ? {} : { statusEffects: player.statusEffects }),
        ...(player.abilityCooldowns === undefined ? {} : { abilityCooldowns: player.abilityCooldowns }),
        ...(player.modelId === undefined ? {} : { modelId: player.modelId }),
        ...(player.animation === undefined ? {} : { animation: player.animation }),
      })),
      objects: (frame.objects ?? []).map(objectFrameView),
      zone: frame.zone,
    };
  }
  if (isDeltaFrame(frame)) {
    return {
      kind: "delta",
      tick: frame.tick,
      removed: frame.removed,
      updated: frame.updated.map((update) => ({
        playerId: update.id,
        ...(Option.isSome(update.team) ? { team: update.team.value } : {}),
        ...(Option.isSome(update.x) ? { x: update.x.value } : {}),
        ...(Option.isSome(update.y) ? { y: update.y.value } : {}),
        ...(Option.isSome(update.health) ? { health: update.health.value } : {}),
        ...(Option.isSome(update.shield) ? { shield: update.shield.value } : {}),
        ...(Option.isSome(update.armor) ? { armor: update.armor.value } : {}),
        ...(Option.isSome(update.weapon) ? { weapon: update.weapon.value } : {}),
        ...(Option.isSome(update.inventory) ? { inventory: update.inventory.value } : {}),
        ...(Option.isSome(update.pickupPrompt) ? { pickupPrompt: update.pickupPrompt.value } : {}),
        ...(Option.isSome(update.pickupToast) ? { pickupToast: update.pickupToast.value } : {}),
        ...(Option.isSome(update.damageIndicator) ? { damageIndicator: update.damageIndicator.value } : {}),
        ...(Option.isSome(update.stats) ? { stats: update.stats.value } : {}),
        ...(Option.isSome(update.statusEffects) ? { statusEffects: update.statusEffects.value } : {}),
        ...(Option.isSome(update.abilityCooldowns) ? { abilityCooldowns: update.abilityCooldowns.value } : {}),
        ...(Option.isSome(update.animation) ? { animation: update.animation.value } : {}),
      })),
      objectsUpdated: (frame.objectsUpdated ?? []).map(objectFrameView),
      objectsRemoved: [...(frame.objectsRemoved ?? [])],
      zone: Option.isSome(frame.zone) ? frame.zone.value : undefined,
    };
  }
  if (frame._tag === "PlayerJoined" && "id" in frame && typeof frame.id === "string") {
    return { kind: "joined", id: frame.id };
  }
  if (frame._tag === "PlayerLeft" && "id" in frame && typeof frame.id === "string") {
    return { kind: "left", id: frame.id };
  }
  if (
    frame._tag === "PlayerKilled" &&
    "killer" in frame &&
    typeof frame.killer === "string" &&
    "victim" in frame &&
    typeof frame.victim === "string" &&
    "tick" in frame &&
    typeof frame.tick === "number"
  ) {
    return { kind: "killed", killer: frame.killer, victim: frame.victim, tick: frame.tick };
  }
  if (frame._tag === "GameOver" && "winner" in frame && typeof frame.winner === "string") {
    return { kind: "game-over", winner: frame.winner };
  }
  return undefined;
};
