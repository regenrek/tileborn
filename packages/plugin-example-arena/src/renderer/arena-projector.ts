import type {
  RenderableEntity,
  RenderableEntityProjector,
  RuntimePluginRenderManifest,
} from "@tileborne/runtime";
import { Option } from "effect";

import {
  ArenaHeartbeat,
  ArenaPlayerInput,
  ArenaSnapshot,
  decodeArenaClientMessage,
  decodeArenaServerMessage,
  encodeArenaClientMessage,
  encodeArenaServerMessage,
  type ArenaDirection8,
} from "../wire-codec.js";
import {
  ARENA_DUMMY_TEXTURE_ASSET_ID,
  ARENA_HEALTH_BAR_TEXTURE_ASSET_ID,
  ARENA_HIT_FLASH_TEXTURE_ASSET_ID,
  ARENA_MELEE_SWING_TEXTURE_ASSET_ID,
  ARENA_PLAYER_TEXTURE_ASSET_ID,
  createArenaBundledAssets,
} from "./bundled-assets.js";

export {
  ARENA_DUMMY_TEXTURE_ASSET_ID,
  ARENA_HEALTH_BAR_TEXTURE_ASSET_ID,
  ARENA_HIT_FLASH_TEXTURE_ASSET_ID,
  ARENA_MELEE_SWING_TEXTURE_ASSET_ID,
  ARENA_PLAYER_TEXTURE_ASSET_ID,
  createArenaBundledAssets,
} from "./bundled-assets.js";

export type InputDirection = ArenaDirection8;

export interface InitialFramePlayerView {
  readonly playerId: string;
  readonly x: number;
  readonly y: number;
  readonly health: number;
}

export interface ZoneView {
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
}

export interface InitialFrameInput {
  readonly tick: number;
  readonly players: readonly InitialFramePlayerView[];
  readonly zone: ZoneView;
}

export interface ClientInputFrame {
  readonly tick: number;
  readonly seq: number;
  readonly dir?: ArenaDirection8;
  readonly shoot: boolean;
  readonly aimDeg?: number;
}

export type ClientFrameView =
  | { readonly kind: "heartbeat"; readonly tick: number }
  | ({ readonly kind: "input" } & ClientInputFrame);

export type ServerFrameView = {
  readonly kind: "initial";
  readonly tick: number;
  readonly players: readonly InitialFramePlayerView[];
  readonly zone: ZoneView;
};

const renderManifest: RuntimePluginRenderManifest = {
  fixedZoom: 4,
  hudInsets: { top: 0, right: 0, bottom: 0, left: 0 },
};

const DEFAULT_ZONE: ZoneView = { cx: 0, cy: 0, radius: 64 };
const DEFAULT_DUMMY_OFFSET_X = 20;
const ENTITY_ANCHOR = { x: 0.5, y: 0.5 } as const;
const HEALTH_ANCHOR = { x: 0, y: 0.5 } as const;
const MELEE_SWING_ANCHOR = { x: 0.5, y: 0.5 } as const;
const MELEE_SWING_OFFSET = 10;
const HIT_FLASH_ANCHOR = { x: 0.5, y: 0.5 } as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isArenaSnapshot = (value: unknown): value is ArenaSnapshot =>
  isRecord(value) && value._tag === "ArenaSnapshot";

const healthRatio = (health: number, maxHealth: number): number => {
  if (!Number.isFinite(maxHealth) || maxHealth <= 0) {
    return 0;
  }
  return Math.max(0.05, Math.min(1, health / maxHealth));
};

export const mergeArenaFrame = (
  previousFullState: unknown | undefined,
  frame: unknown,
): unknown => (isArenaSnapshot(frame) ? frame : previousFullState);

export const projectArenaSnapshot = (snapshot: unknown): readonly RenderableEntity[] => {
  if (!isArenaSnapshot(snapshot)) {
    return [];
  }

  return snapshot.entities
    .flatMap((entity): readonly RenderableEntity[] => {
      const headingRad = (entity.headingDeg * Math.PI) / 180;
      const sprite: RenderableEntity = {
        id: `arena:${entity.kind}:${entity.id}`,
        assetId:
          entity.kind === "player" ? ARENA_PLAYER_TEXTURE_ASSET_ID : ARENA_DUMMY_TEXTURE_ASSET_ID,
        x: entity.x,
        y: entity.y,
        rotation: headingRad,
        scale: 1,
        layerIndex: entity.kind === "player" ? 10 : 9,
        anchor: ENTITY_ANCHOR,
      };
      const bar: RenderableEntity = {
        id: `arena:health:${entity.id}`,
        assetId: ARENA_HEALTH_BAR_TEXTURE_ASSET_ID,
        x: entity.x - 8,
        y: entity.y - 15,
        scale: healthRatio(entity.health, entity.maxHealth),
        layerIndex: 30,
        anchor: HEALTH_ANCHOR,
      };
      const extras: RenderableEntity[] = [];
      if (entity.attacking === true) {
        extras.push({
          id: `arena:attack:${entity.id}`,
          assetId: ARENA_MELEE_SWING_TEXTURE_ASSET_ID,
          x: entity.x + Math.cos(headingRad) * MELEE_SWING_OFFSET,
          y: entity.y + Math.sin(headingRad) * MELEE_SWING_OFFSET,
          rotation: headingRad - Math.PI / 4,
          scale: 1,
          layerIndex: 20,
          anchor: MELEE_SWING_ANCHOR,
        });
      }
      if (entity.hitTick !== undefined) {
        extras.push({
          id: `arena:hit:${entity.id}`,
          assetId: ARENA_HIT_FLASH_TEXTURE_ASSET_ID,
          x: entity.x,
          y: entity.y,
          scale: 1,
          layerIndex: 21,
          anchor: HIT_FLASH_ANCHOR,
        });
      }
      return [sprite, bar, ...extras];
    })
    .sort((left, right) => left.id.localeCompare(right.id));
};

export const createArenaProjector = (): RenderableEntityProjector<unknown> => ({
  project: projectArenaSnapshot,
  mergeFrame: mergeArenaFrame,
  getFrameTimestamp: (frame) =>
    isArenaSnapshot(frame) && Number.isFinite(frame.serverTimestampMs)
      ? frame.serverTimestampMs
      : undefined,
  getRenderManifest: createArenaRenderManifest,
  textureManifestForAtlas,
});

export const textureManifestForAtlas = (): readonly {
  readonly assetId: string;
  readonly path: string;
}[] =>
  createArenaBundledAssets().map((asset) => ({
    assetId: asset.assetId,
    path: asset.path,
  }));

export const createArenaRenderManifest = (): RuntimePluginRenderManifest => renderManifest;

export const decodeServerFrame = (bytes: Uint8Array): unknown => decodeArenaServerMessage(bytes);

export const encodeServerFrame = (frame: unknown): Uint8Array => {
  if (!isRecord(frame)) {
    throw new Error("Cannot encode non-object arena server frame");
  }
  return encodeArenaServerMessage(frame as unknown as ArenaSnapshot);
};

export const createInitialFrame = (input: InitialFrameInput): unknown => {
  const player = input.players[0] ?? { playerId: "player-1", x: 0, y: 0, health: 100 };
  return new ArenaSnapshot({
    tick: input.tick,
    serverTimestampMs: 0,
    entities: [
      {
        id: player.playerId,
        kind: "player",
        x: player.x,
        y: player.y,
        health: player.health,
        maxHealth: Math.max(1, player.health),
        headingDeg: 0,
        attacking: false,
      },
      {
        id: "dummy-1",
        kind: "dummy",
        x: player.x + DEFAULT_DUMMY_OFFSET_X,
        y: player.y,
        health: 100,
        maxHealth: 100,
        headingDeg: 180,
        attacking: false,
      },
    ],
  });
};

export const encodeHeartbeatFrame = (tick: number): Uint8Array =>
  encodeArenaClientMessage(new ArenaHeartbeat({ tick }));

export const encodeClientInputFrame = (input: ClientInputFrame): Uint8Array =>
  encodeArenaClientMessage(
    new ArenaPlayerInput({
      tick: input.tick,
      seq: input.seq,
      dir: input.dir === undefined ? Option.none() : Option.some(input.dir),
      shoot: input.shoot,
      aimDeg: input.aimDeg === undefined ? Option.none() : Option.some(input.aimDeg),
    }),
  );

export const decodeClientFrameView = (bytes: Uint8Array): ClientFrameView | undefined => {
  const frame = decodeArenaClientMessage(bytes);
  if (frame._tag === "ArenaHeartbeat") {
    return { kind: "heartbeat", tick: frame.tick };
  }
  if (frame._tag === "ArenaPlayerInput") {
    return {
      kind: "input",
      tick: frame.tick,
      seq: frame.seq,
      ...(Option.isSome(frame.dir) ? { dir: frame.dir.value } : {}),
      shoot: frame.shoot,
      ...(Option.isSome(frame.aimDeg) ? { aimDeg: frame.aimDeg.value } : {}),
    };
  }
  return undefined;
};

export const serverFrameToView = (frame: unknown): ServerFrameView | undefined => {
  if (!isArenaSnapshot(frame)) {
    return undefined;
  }
  return {
    kind: "initial",
    tick: frame.tick,
    players: frame.entities.map((entity) => ({
      playerId: entity.id,
      x: entity.x,
      y: entity.y,
      health: entity.health,
    })),
    zone: DEFAULT_ZONE,
  };
};
