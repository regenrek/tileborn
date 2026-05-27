import { DAMAGE, DEFAULT_MAX_PLAYERS } from "../constants.js";
import type { ExportedArtifact, SpawnPointArtifact } from "../types/artifact.js";
import type { PluginWorld } from "../types/runtime-plugin.js";
import {
  PLAYER_COMPONENT,
  PLAYER_STATS_COMPONENT,
  POSITION_COMPONENT,
  VELOCITY_COMPONENT,
  type Player,
  type PlayerStats,
  type Position,
  type Velocity,
} from "./components.js";

export interface SpawnSlot {
  readonly x: number;
  readonly y: number;
}

const compareSpawnPoints = (left: SpawnPointArtifact, right: SpawnPointArtifact): number =>
  left.y - right.y || left.x - right.x || left.team.localeCompare(right.team);

export const resolveSpawnSlots = (artifact: ExportedArtifact): readonly SpawnSlot[] => {
  const markers = [...artifact.spawnAnchors].sort(compareSpawnPoints);

  if (markers.length === 0) {
    return [
      {
        x: artifact.shrinkSchedule.centerX,
        y: artifact.shrinkSchedule.centerY,
      },
    ];
  }

  const maxPlayers =
    typeof artifact.maxPlayers === "number" && Number.isFinite(artifact.maxPlayers)
      ? artifact.maxPlayers
      : DEFAULT_MAX_PLAYERS;
  const spawnCount = Math.min(maxPlayers, markers.length);
  return markers.slice(0, spawnCount).map((marker) => ({ x: marker.x, y: marker.y }));
};

const registerPlayerComponents = (world: PluginWorld): void => {
  world.registerComponent<Position>(POSITION_COMPONENT);
  world.registerComponent<Velocity>(VELOCITY_COMPONENT);
  world.registerComponent<Player>(PLAYER_COMPONENT);
  world.registerComponent<PlayerStats>(PLAYER_STATS_COMPONENT);
};

export const spawnPlayersFromArtifact = (
  world: PluginWorld,
  artifact: ExportedArtifact,
  options: { readonly playerHealth?: number } = {},
): readonly number[] => {
  registerPlayerComponents(world);

  const positions = world.getComponent<Position>(POSITION_COMPONENT);
  const velocities = world.getComponent<Velocity>(VELOCITY_COMPONENT);
  const players = world.getComponent<Player>(PLAYER_COMPONENT);
  const stats = world.getComponent<PlayerStats>(PLAYER_STATS_COMPONENT);
  const markers = [...artifact.spawnAnchors].sort(compareSpawnPoints);
  const slots = resolveSpawnSlots(artifact);
  const entities: number[] = [];

  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index]!;
    const marker = markers[index];
    const entity = world.createEntity();
    positions.set(entity, { x: slot.x, y: slot.y });
    velocities.set(entity, { vx: 0, vy: 0 });
    players.set(entity, {
      playerId: `player-${index + 1}`,
      health: options.playerHealth ?? DAMAGE.playerHealth,
      alive: 1,
      team: marker?.team ?? "solo",
    });
    stats.set(entity, { kills: 0, deaths: 0 });
    entities.push(entity);
  }

  return entities;
};

export const countAllPlayers = (world: PluginWorld): number =>
  Array.from(world.getComponent<Player>(PLAYER_COMPONENT).entries()).length;

export const countAlivePlayers = (world: PluginWorld): number => {
  const players = world.getComponent<Player>(PLAYER_COMPONENT);
  let count = 0;
  for (const [, player] of players.entries()) {
    if (player.alive === 1) {
      count += 1;
    }
  }
  return count;
};
