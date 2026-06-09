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
import {
  DEFAULT_PLAYER_PHYSICS,
  physicsForPlayer,
  type PlayerPhysicsProfile,
} from "./player-physics.js";

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

export const buildTileCollisionEnvironment = (artifact: ExportedArtifact): PluginCollisionEnvironment | undefined =>
  PluginCollisionEnvironment.fromTileArtifact(artifact);

export interface MovementOptions {
  readonly speed?: number;
  readonly radius?: number;
  readonly offsetX?: number;
  readonly offsetY?: number;
  readonly bodyByModelId?: ReadonlyMap<string, PlayerPhysicsProfile>;
  readonly speedMultiplierByPlayerId?: ReadonlyMap<string, number>;
}

const sweptCollisionStepCount = (dx: number, dy: number, radius: number): number =>
  Math.max(1, Math.ceil(Math.hypot(dx, dy) / Math.max(1, radius / 2)));

const moveWithSweptCollision = (
  position: Position,
  dx: number,
  dy: number,
  body: PlayerPhysicsProfile,
  collisionEnvironment: PluginCollisionEnvironment | undefined,
): Position => {
  const nextPosition = { ...position };
  if (!collisionEnvironment) {
    nextPosition.x += dx;
    nextPosition.y += dy;
    return nextPosition;
  }

  const steps = sweptCollisionStepCount(dx, dy, body.radius);
  const stepX = dx / steps;
  const stepY = dy / steps;
  for (let step = 0; step < steps; step += 1) {
    nextPosition.x += stepX;
    nextPosition.y += stepY;
    resolvePlayerCollision(nextPosition, collisionEnvironment, body.radius, {
      x: body.offsetX,
      y: body.offsetY,
    });
  }
  return nextPosition;
};

export const applyMovementTick = (
  world: PluginWorld,
  dt: number,
  inputsByPlayerId: MovementInputMap,
  collisionEnvironment: PluginCollisionEnvironment | undefined,
  options: MovementOptions = {},
): void => {
  const speed = options.speed ?? MOVEMENT.speed;
  const defaultBody = {
    radius: options.radius ?? DEFAULT_PLAYER_PHYSICS.radius,
    offsetX: options.offsetX ?? DEFAULT_PLAYER_PHYSICS.offsetX,
    offsetY: options.offsetY ?? DEFAULT_PLAYER_PHYSICS.offsetY,
  };

  const positions = world.getComponent<Position>(POSITION_COMPONENT);
  const velocities = world.getComponent<Velocity>(VELOCITY_COMPONENT);
  const players = world.getComponent<Player>(PLAYER_COMPONENT);

  const alivePlayers = [...players.entries()]
    .filter(([, player]) => player.alive === 1)
    .sort(([, left], [, right]) => left.playerId.localeCompare(right.playerId));

  for (const [entity, player] of alivePlayers) {
    const input = inputsByPlayerId.get(player.playerId);
    const vector = input ? direction8ToUnitVector(input.dir) : { x: 0, y: 0 };
    const speedMultiplier = options.speedMultiplierByPlayerId?.get(player.playerId) ?? 1;
    const nextVelocity = {
      vx: vector.x * speed * speedMultiplier,
      vy: vector.y * speed * speedMultiplier,
    };
    velocities.set(entity, nextVelocity);

    const position = positions.get(entity);
    if (!position) {
      continue;
    }

    const dx = nextVelocity.vx * dt;
    const dy = nextVelocity.vy * dt;
    if (dx === 0 && dy === 0) {
      continue;
    }

    const body = physicsForPlayer(player, options.bodyByModelId, defaultBody);
    positions.set(entity, moveWithSweptCollision(position, dx, dy, body, collisionEnvironment));
  }
};

export const DEFAULT_TICK_DT = 1 / MOVEMENT.tickRate;
