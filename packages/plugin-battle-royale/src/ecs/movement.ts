import { MOVEMENT } from "../constants.js";
import type { ExportedArtifact } from "../types/artifact.js";
import type { PluginWorld } from "../types/runtime-plugin.js";
import {
  PLAYER_COMPONENT,
  POSITION_COMPONENT,
  VELOCITY_COMPONENT,
  type Player,
  type Position,
  type Velocity,
} from "./components.js";
import { PluginCollisionEnvironment, resolvePlayerCollision } from "./collision.js";

export type Direction8 = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface MovementInput {
  readonly dir: Direction8;
  readonly shoot: boolean;
}

export type MovementInputMap = ReadonlyMap<string, MovementInput>;

/** Eight-way unit vector: 0 = east, increasing clockwise. */
export const direction8ToUnitVector = (dir: Direction8): { readonly x: number; readonly y: number } => {
  const angle = (dir * Math.PI) / 4;
  return { x: Math.cos(angle), y: Math.sin(angle) };
};

export const buildCollisionEnvironment = (artifact: ExportedArtifact): PluginCollisionEnvironment | undefined =>
  PluginCollisionEnvironment.fromArtifact(artifact);

export interface MovementOptions {
  readonly speed?: number;
  readonly radius?: number;
  readonly offsetY?: number;
}

export const applyMovementTick = (
  world: PluginWorld,
  dt: number,
  inputsByPlayerId: MovementInputMap,
  collisionEnvironment: PluginCollisionEnvironment | undefined,
  options: MovementOptions = {},
): void => {
  const speed = options.speed ?? MOVEMENT.speed;
  const radius = options.radius ?? MOVEMENT.radius;
  const offsetY = options.offsetY ?? MOVEMENT.footprintOffsetY;

  const positions = world.getComponent<Position>(POSITION_COMPONENT);
  const velocities = world.getComponent<Velocity>(VELOCITY_COMPONENT);
  const players = world.getComponent<Player>(PLAYER_COMPONENT);

  const alivePlayers = [...players.entries()]
    .filter(([, player]) => player.alive === 1)
    .sort(([, left], [, right]) => left.playerId.localeCompare(right.playerId));

  for (const [entity, player] of alivePlayers) {
    const input = inputsByPlayerId.get(player.playerId);
    const vector = input ? direction8ToUnitVector(input.dir) : { x: 0, y: 0 };
    const nextVelocity = {
      vx: vector.x * speed,
      vy: vector.y * speed,
    };
    velocities.set(entity, nextVelocity);

    const position = positions.get(entity);
    if (!position) {
      continue;
    }

    const nextPosition = {
      x: position.x + nextVelocity.vx * dt,
      y: position.y + nextVelocity.vy * dt,
    };

    if (collisionEnvironment) {
      resolvePlayerCollision(nextPosition, collisionEnvironment, radius, offsetY);
    }

    positions.set(entity, nextPosition);
  }
};

export const DEFAULT_TICK_DT = 1 / MOVEMENT.tickRate;
