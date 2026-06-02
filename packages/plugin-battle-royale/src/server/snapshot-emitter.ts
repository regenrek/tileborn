import * as BattleRoyaleProtocol from "@tileborne/ipc-contracts/protocols/battle-royale";
import { Option } from "effect";

import { MOVEMENT } from "../constants.js";
import {
  PLAYER_COMPONENT,
  POSITION_COMPONENT,
  PROJECTILE_COMPONENT,
  type Player,
  type Position,
  type Projectile,
} from "../ecs/components.js";
import { getZone } from "../ecs/zone.js";
import type { PluginWorld, RuntimeMessageOut } from "../types/runtime-plugin.js";

const {
  DeltaSnapshot,
  ProjectileSnapshot,
  ProjectileUpdate,
  WelcomeSnapshot,
  encodeServerMessage,
  makePlayerId,
  makeProjectileId,
} = BattleRoyaleProtocol;

export const MAX_DELTA_SNAPSHOT_BYTES = 512;

export type SnapshotSeed = string | number;

interface CapturedPlayerSnapshot {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly health: number;
  readonly modelId?: string;
}

interface CapturedProjectileSnapshot {
  readonly id: string;
  readonly ownerPlayerId: string;
  readonly weaponSlot: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly rotation: number;
  readonly ttlMs: number;
}

interface CapturedSnapshot {
  readonly serverTimestampMs: number;
  readonly players: readonly CapturedPlayerSnapshot[];
  readonly projectiles: readonly CapturedProjectileSnapshot[];
  readonly zone: BattleRoyaleProtocol.ZoneState;
}

const emptyZone = (): BattleRoyaleProtocol.ZoneState => ({
  cx: 0,
  cy: 0,
  radius: 0,
});

const protocolHealth = (health: number): number => Math.max(0, Math.round(health));

const protocolProjectileTtlMs = (ttlTicks: number): number => Math.max(0, Math.round(ttlTicks));

const serverTimestampForTick = (tick: number): number => tick * (1000 / MOVEMENT.tickRate);

const projectileEntries = (world: PluginWorld): Iterable<[number, Projectile]> => {
  try {
    return world.getComponent<Projectile>(PROJECTILE_COMPONENT).entries();
  } catch (cause) {
    if (cause instanceof Error && cause.message === `component not registered: ${PROJECTILE_COMPONENT}`) {
      return [];
    }
    throw cause;
  }
};

const captureSnapshot = (world: PluginWorld, tick: number): CapturedSnapshot => {
  const players = world.getComponent<Player>(PLAYER_COMPONENT);
  const positions = world.getComponent<Position>(POSITION_COMPONENT);
  const zone = getZone(world);
  const capturedPlayers: CapturedPlayerSnapshot[] = [];
  const capturedProjectiles: CapturedProjectileSnapshot[] = [];

  for (const [entity, player] of players.entries()) {
    if (player.alive !== 1) {
      continue;
    }
    const position = positions.get(entity);
    if (!position) {
      continue;
    }
    capturedPlayers.push({
      id: player.playerId,
      x: position.x,
      y: position.y,
      health: protocolHealth(player.health),
      ...(player.modelId === undefined ? {} : { modelId: player.modelId }),
    });
  }

  capturedPlayers.sort((left, right) => left.id.localeCompare(right.id));

  for (const [entity, projectile] of projectileEntries(world)) {
    const position = positions.get(entity);
    if (!position) {
      continue;
    }
    capturedProjectiles.push({
      id: String(entity),
      ownerPlayerId: projectile.ownerId,
      weaponSlot: projectile.weaponSlot,
      x: position.x,
      y: position.y,
      vx: projectile.dirX * projectile.speed,
      vy: projectile.dirY * projectile.speed,
      rotation: Math.atan2(projectile.dirY, projectile.dirX),
      ttlMs: protocolProjectileTtlMs(projectile.ttlTicks),
    });
  }

  capturedProjectiles.sort((left, right) => left.id.localeCompare(right.id));

  return {
    serverTimestampMs: serverTimestampForTick(tick),
    players: capturedPlayers,
    projectiles: capturedProjectiles,
    zone: zone
      ? {
          cx: zone.cx,
          cy: zone.cy,
          radius: zone.currentRadius,
        }
      : emptyZone(),
  };
};

const sameZone = (
  left: BattleRoyaleProtocol.ZoneState,
  right: BattleRoyaleProtocol.ZoneState,
): boolean => left.cx === right.cx && left.cy === right.cy && left.radius === right.radius;

const toPlayerMap = (
  players: readonly CapturedPlayerSnapshot[],
): ReadonlyMap<string, CapturedPlayerSnapshot> => {
  const byId = new Map<string, CapturedPlayerSnapshot>();
  for (const player of players) {
    byId.set(player.id, player);
  }
  return byId;
};

const toProjectileMap = (
  projectiles: readonly CapturedProjectileSnapshot[],
): ReadonlyMap<string, CapturedProjectileSnapshot> => {
  const byId = new Map<string, CapturedProjectileSnapshot>();
  for (const projectile of projectiles) {
    byId.set(projectile.id, projectile);
  }
  return byId;
};

const pushFrame = (msgOut: RuntimeMessageOut | undefined, frame: Uint8Array): Uint8Array => {
  msgOut?.push(frame);
  return frame;
};

export interface BattleRoyaleSnapshotEmitter {
  readonly buildWelcome: (
    world: PluginWorld,
    tick: number,
  ) => Uint8Array;
  readonly emitWelcome: (
    world: PluginWorld,
    tick: number,
    msgOut?: RuntimeMessageOut,
  ) => Uint8Array;
  readonly emitDelta: (
    world: PluginWorld,
    tick: number,
    msgOut?: RuntimeMessageOut,
  ) => Uint8Array;
}

export const createBattleRoyaleSnapshotEmitter = (
  seed: SnapshotSeed = 0,
): BattleRoyaleSnapshotEmitter => {
  let previous: CapturedSnapshot | undefined;

  const encodeWelcome = (snapshot: CapturedSnapshot, tick: number): Uint8Array =>
    encodeServerMessage(
      new WelcomeSnapshot({
        tick,
        serverTimestampMs: snapshot.serverTimestampMs,
        seed,
        players: snapshot.players.map((player) => ({
          id: makePlayerId(player.id),
          x: player.x,
          y: player.y,
          health: player.health,
          ...(player.modelId === undefined ? {} : { modelId: player.modelId }),
        })),
        projectiles: snapshot.projectiles.map((projectile) =>
          new ProjectileSnapshot({
            id: makeProjectileId(projectile.id),
            ownerPlayerId: makePlayerId(projectile.ownerPlayerId),
            weaponSlot: projectile.weaponSlot,
            x: projectile.x,
            y: projectile.y,
            vx: projectile.vx,
            vy: projectile.vy,
            rotation: projectile.rotation,
            ttlMs: projectile.ttlMs,
          }),
        ),
        zone: snapshot.zone,
      }),
    );

  const buildWelcome = (
    world: PluginWorld,
    tick: number,
  ): Uint8Array => encodeWelcome(captureSnapshot(world, tick), tick);

  const emitWelcome = (
    world: PluginWorld,
    tick: number,
    msgOut?: RuntimeMessageOut,
  ): Uint8Array => {
    const snapshot = captureSnapshot(world, tick);
    previous = snapshot;
    return pushFrame(msgOut, encodeWelcome(snapshot, tick));
  };

  const emitDelta = (
    world: PluginWorld,
    tick: number,
    msgOut?: RuntimeMessageOut,
  ): Uint8Array => {
    if (!previous) {
      return emitWelcome(world, tick, msgOut);
    }

    const current = captureSnapshot(world, tick);
    const previousPlayers = toPlayerMap(previous.players);
    const currentPlayers = toPlayerMap(current.players);
    const previousProjectiles = toProjectileMap(previous.projectiles);
    const currentProjectiles = toProjectileMap(current.projectiles);
    const removed = [...previousPlayers.keys()]
      .filter((playerId) => !currentPlayers.has(playerId))
      .sort((left, right) => left.localeCompare(right))
      .map((playerId) => makePlayerId(playerId));
    const projectilesRemoved = [...previousProjectiles.keys()]
      .filter((projectileId) => !currentProjectiles.has(projectileId))
      .sort((left, right) => left.localeCompare(right))
      .map((projectileId) => makeProjectileId(projectileId));

    const updated = current.players.flatMap((player) => {
      const before = previousPlayers.get(player.id);
      if (
        before &&
        before.x === player.x &&
        before.y === player.y &&
        before.health === player.health
      ) {
        return [];
      }

      return [
        {
          id: makePlayerId(player.id),
          x: !before || before.x !== player.x ? Option.some(player.x) : Option.none(),
          y: !before || before.y !== player.y ? Option.some(player.y) : Option.none(),
          health:
            !before || before.health !== player.health
              ? Option.some(player.health)
              : Option.none(),
        },
      ];
    });

    const projectilesUpdated = current.projectiles.flatMap((projectile) => {
      const before = previousProjectiles.get(projectile.id);
      if (
        before &&
        before.ownerPlayerId === projectile.ownerPlayerId &&
        before.weaponSlot === projectile.weaponSlot &&
        before.x === projectile.x &&
        before.y === projectile.y &&
        before.vx === projectile.vx &&
        before.vy === projectile.vy &&
        before.rotation === projectile.rotation &&
        before.ttlMs === projectile.ttlMs
      ) {
        return [];
      }

      return [
        new ProjectileUpdate({
          id: makeProjectileId(projectile.id),
          ownerPlayerId:
            !before || before.ownerPlayerId !== projectile.ownerPlayerId
              ? Option.some(makePlayerId(projectile.ownerPlayerId))
              : Option.none(),
          weaponSlot:
            !before || before.weaponSlot !== projectile.weaponSlot
              ? Option.some(projectile.weaponSlot)
              : Option.none(),
          x: !before || before.x !== projectile.x ? Option.some(projectile.x) : Option.none(),
          y: !before || before.y !== projectile.y ? Option.some(projectile.y) : Option.none(),
          vx: !before || before.vx !== projectile.vx ? Option.some(projectile.vx) : Option.none(),
          vy: !before || before.vy !== projectile.vy ? Option.some(projectile.vy) : Option.none(),
          rotation:
            !before || before.rotation !== projectile.rotation
              ? Option.some(projectile.rotation)
              : Option.none(),
          ttlMs:
            !before || before.ttlMs !== projectile.ttlMs
              ? Option.some(projectile.ttlMs)
              : Option.none(),
        }),
      ];
    });

    const frame = encodeServerMessage(
      new DeltaSnapshot({
        tick,
        serverTimestampMs: current.serverTimestampMs,
        removed,
        updated,
        projectilesUpdated,
        projectilesRemoved,
        zone: sameZone(previous.zone, current.zone) ? Option.none() : Option.some(current.zone),
      }),
    );
    previous = current;
    return pushFrame(msgOut, frame);
  };

  return {
    buildWelcome,
    emitWelcome,
    emitDelta,
  };
};
