/**
 * Battle royale render texture ids for the ADR-0014 Phase 0 slice:
 * - Player sprite: `@tileborne-plugins/battle-royale:default-pet`
 * - Projectile sprite: `@tileborne-plugins/battle-royale:projectile-bolt`
 *
 * The frontend bridge should preload textures for these ids before calling
 * PixiRendererAdapter.renderFromEntities().
 */
import * as BattleRoyaleProtocol from "@tileborne/ipc-contracts/protocols/battle-royale";
import type {
  RenderableEntity,
  RenderableEntityProjector,
  RuntimePluginRenderManifest,
} from "@tileborne/runtime";
import { Option } from "effect";

import {
  createBattleRoyaleBundledAssets,
  PLAYER_TEXTURE_ASSET_ID,
  PROJECTILE_TEXTURE_ASSET_ID,
} from "./bundled-assets.js";

type BattleRoyaleSnapshot =
  | BattleRoyaleProtocol.WelcomeSnapshot
  | BattleRoyaleProtocol.DeltaSnapshot;

type PlayerId = BattleRoyaleProtocol.PlayerId;
export type InputDirection = BattleRoyaleProtocol.Direction8;

interface PlayerProjectionState {
  readonly x: number;
  readonly y: number;
  readonly health: number;
}

interface ProjectileProjectionState {
  readonly x: number;
  readonly y: number;
  readonly rot: number;
  readonly ownerId: PlayerId;
}

interface BattleRoyaleFullState {
  readonly _tag: "BattleRoyaleFullState";
  readonly tick: number;
  readonly players: ReadonlyMap<PlayerId, PlayerProjectionState>;
  readonly projectiles: ReadonlyMap<string, ProjectileProjectionState>;
}

export interface InitialFramePlayerView {
  readonly playerId: string;
  readonly x: number;
  readonly y: number;
  readonly health: number;
}

export interface FramePlayerUpdateView {
  readonly playerId: string;
  readonly x?: number;
  readonly y?: number;
  readonly health?: number;
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
      readonly zone: ZoneView;
    }
  | {
      readonly kind: "delta";
      readonly tick: number;
      readonly removed: readonly string[];
      readonly updated: readonly FramePlayerUpdateView[];
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
  readonly dir: InputDirection;
  readonly shoot: boolean;
  readonly aimDeg?: number;
  readonly weaponSlot?: number;
}

export type ClientFrameView =
  | { readonly kind: "heartbeat"; readonly tick: number }
  | ({ readonly kind: "input" } & ClientInputFrame);

export { PLAYER_TEXTURE_ASSET_ID, PROJECTILE_TEXTURE_ASSET_ID } from "./bundled-assets.js";

const renderManifest: RuntimePluginRenderManifest = {
  fixedZoom: 4,
  hudInsets: { top: 0, right: 0, bottom: 0, left: 0 },
};

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
  snapshot.projectiles instanceof Map;

const optionOr = <Value>(value: Option.Option<Value>, fallback: Value): Value =>
  Option.isSome(value) ? value.value : fallback;

const projectileKey = (id: BattleRoyaleProtocol.ProjectileId): string => String(id);

const toPlayerState = (player: BattleRoyaleProtocol.PlayerSnapshot): PlayerProjectionState => ({
  x: player.x,
  y: player.y,
  health: player.health,
});

const toProjectileState = (
  projectile: BattleRoyaleProtocol.ProjectileSnapshot,
): ProjectileProjectionState => ({
  x: projectile.x,
  y: projectile.y,
  rot: projectile.rotation,
  ownerId: projectile.ownerPlayerId,
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
    players.set(update.id, {
      x: optionOr(update.x, current.x),
      y: optionOr(update.y, current.y),
      health: optionOr(update.health, current.health),
    });
  }

  const projectiles = new Map(
    isBattleRoyaleFullState(previousFullState) ? previousFullState.projectiles : [],
  );
  for (const projectileId of frame.projectilesRemoved) {
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

  return {
    _tag: "BattleRoyaleFullState",
    tick: frame.tick,
    players,
    projectiles,
  } satisfies BattleRoyaleFullState;
};

export const projectBattleRoyaleFullState = (snapshot: unknown): readonly RenderableEntity[] => {
  if (!isBattleRoyaleFullState(snapshot)) {
    return [];
  }

  const playerEntities = [...snapshot.players.entries()]
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
    .map(([id, player]): RenderableEntity => ({
      id: `br:player:${id}`,
      assetId: PLAYER_TEXTURE_ASSET_ID,
      x: player.x,
      y: player.y,
      scale: 1,
      layerIndex: 10,
    }));

  const projectileEntities = [...snapshot.projectiles.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, projectile]): RenderableEntity => ({
      id: `br:projectile:${id}`,
      assetId: PROJECTILE_TEXTURE_ASSET_ID,
      x: projectile.x,
      y: projectile.y,
      rotation: projectile.rot,
      scale: 1,
      layerIndex: 20,
    }));

  return [...playerEntities, ...projectileEntities];
};

export const createTypedBattleRoyaleProjector = (): RenderableEntityProjector<unknown> => ({
  project: projectBattleRoyaleFullState,
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

export const createBattleRoyaleProjector = (): RenderableEntityProjector<unknown> => {
  return createTypedBattleRoyaleProjector();
};

export const textureManifestForAtlas = (): readonly {
  readonly assetId: string;
  readonly path: string;
}[] =>
  createBattleRoyaleBundledAssets().map((asset) => ({
    assetId: asset.assetId,
    path: asset.path,
  }));

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
      x: player.x,
      y: player.y,
      health: player.health,
    })),
    projectiles: [],
    zone: input.zone,
  });

export const encodeHeartbeatFrame = (tick: number): Uint8Array =>
  BattleRoyaleProtocol.encodeClientMessage(new BattleRoyaleProtocol.Heartbeat({ tick }));

export const encodeClientInputFrame = (input: ClientInputFrame): Uint8Array =>
  BattleRoyaleProtocol.encodeClientMessage(
    new BattleRoyaleProtocol.PlayerInput({
      tick: input.tick,
      seq: input.seq,
      dir: input.dir,
      shoot: input.shoot,
      aimDeg: input.aimDeg === undefined ? Option.none() : Option.some(input.aimDeg),
      weaponSlot: input.weaponSlot === undefined ? Option.none() : Option.some(input.weaponSlot),
    }),
  );

export const decodeClientFrameView = (bytes: Uint8Array): ClientFrameView | undefined => {
  const frame = BattleRoyaleProtocol.decodeClientMessage(bytes);
  if (frame._tag === "Heartbeat") {
    return { kind: "heartbeat", tick: frame.tick };
  }
  if (frame._tag === "PlayerInput") {
    return {
      kind: "input",
      tick: frame.tick,
      seq: frame.seq,
      dir: frame.dir,
      shoot: frame.shoot,
      ...(Option.isSome(frame.aimDeg) ? { aimDeg: frame.aimDeg.value } : {}),
      ...(Option.isSome(frame.weaponSlot) ? { weaponSlot: frame.weaponSlot.value } : {}),
    };
  }
  return undefined;
};

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
        x: player.x,
        y: player.y,
        health: player.health,
      })),
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
        ...(Option.isSome(update.x) ? { x: update.x.value } : {}),
        ...(Option.isSome(update.y) ? { y: update.y.value } : {}),
        ...(Option.isSome(update.health) ? { health: update.health.value } : {}),
      })),
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
