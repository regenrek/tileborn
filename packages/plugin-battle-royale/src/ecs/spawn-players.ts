import { DAMAGE } from '../constants.js';
import type { ExportedArtifact, SpawnPointArtifact } from '../types/artifact.js';
import {
  assertBattleRoyaleTeamTopology,
  selectBattleRoyaleSpawnTeamSlots,
  type BattleRoyaleMatchMode,
} from '../team-topology.js';
import type { PluginWorld } from '../types/runtime-plugin.js';
import {
  ANIMATION_STATE_COMPONENT,
  FACING_COMPONENT,
  PLAYER_COMPONENT,
  PLAYER_STATS_COMPONENT,
  POSITION_COMPONENT,
  TEAM_COMPONENT,
  VELOCITY_COMPONENT,
  type AnimationState,
  type Facing,
  type Player,
  type PlayerStats,
  type Position,
  type Team,
  type Velocity,
} from './components.js';

export interface SpawnSlot {
  readonly x: number;
  readonly y: number;
}

interface ResolvedSpawnSlot extends SpawnSlot {
  readonly team: string;
}

export interface SpawnPlayersOptions {
  readonly playerHealth?: number;
  readonly playerIds?: readonly string[];
  readonly existingPlayerIds?: ReadonlySet<string>;
  readonly matchMode?: BattleRoyaleMatchMode;
}

const resolveSpawnMarkers = (artifact: ExportedArtifact): readonly SpawnPointArtifact[] =>
  selectBattleRoyaleSpawnTeamSlots(artifact.spawnAnchors, artifact.maxPlayers);

export const resolveSpawnSlots = (artifact: ExportedArtifact): readonly SpawnSlot[] =>
  resolveSpawnMarkers(artifact).map((marker) => ({ x: marker.x, y: marker.y }));

const registerPlayerComponents = (world: PluginWorld): void => {
  world.registerComponent<Position>(POSITION_COMPONENT);
  world.registerComponent<Velocity>(VELOCITY_COMPONENT);
  world.registerComponent<Player>(PLAYER_COMPONENT);
  world.registerComponent<AnimationState>(ANIMATION_STATE_COMPONENT);
  world.registerComponent<PlayerStats>(PLAYER_STATS_COMPONENT);
  world.registerComponent<Team>(TEAM_COMPONENT);
  world.registerComponent<Facing>(FACING_COMPONENT);
};

const resolvePlayerModelId = (artifact: ExportedArtifact, playerId: string): string => {
  const selected = artifact.playerModelSelections?.find((entry) => entry.playerId === playerId);
  const modelId = selected?.modelId ?? artifact.defaultPlayerModelId;
  if (modelId === undefined) {
    throw new Error('runtime artifact is missing defaultPlayerModelId');
  }
  return modelId;
};

const resolveSpawnPlayerIds = (
  slots: readonly SpawnSlot[],
  playerIds: readonly string[] | undefined,
): readonly string[] => {
  if (playerIds === undefined) {
    return slots.map((_, index) => `player-${index + 1}`);
  }
  const seen = new Set<string>();
  const resolved: string[] = [];
  for (const playerId of playerIds) {
    if (playerId.length === 0 || seen.has(playerId)) {
      continue;
    }
    seen.add(playerId);
    resolved.push(playerId);
    if (resolved.length >= slots.length) {
      break;
    }
  }
  return resolved;
};

export const spawnPlayersFromArtifact = (
  world: PluginWorld,
  artifact: ExportedArtifact,
  options: SpawnPlayersOptions = {},
): readonly number[] => {
  registerPlayerComponents(world);

  const positions = world.getComponent<Position>(POSITION_COMPONENT);
  const velocities = world.getComponent<Velocity>(VELOCITY_COMPONENT);
  const players = world.getComponent<Player>(PLAYER_COMPONENT);
  const animations = world.getComponent<AnimationState>(ANIMATION_STATE_COMPONENT);
  const stats = world.getComponent<PlayerStats>(PLAYER_STATS_COMPONENT);
  const teams = world.getComponent<Team>(TEAM_COMPONENT);
  const facings = world.getComponent<Facing>(FACING_COMPONENT);
  const markers = resolveSpawnMarkers(artifact);
  const playerIds = resolveSpawnPlayerIds(markers, options.playerIds);
  const topology = assertBattleRoyaleTeamTopology(options.matchMode ?? 'solo', markers);
  const slots: readonly ResolvedSpawnSlot[] = markers.map((marker, index) => ({
    x: marker.x,
    y: marker.y,
    team: topology.teamIds[index]!,
  }));
  const entities: number[] = [];

  for (let index = 0; index < playerIds.length; index += 1) {
    const playerId = playerIds[index]!;
    if (options.existingPlayerIds?.has(playerId)) {
      continue;
    }
    const slot = slots[index]!;
    const entity = world.createEntity();
    positions.set(entity, { x: slot.x, y: slot.y });
    velocities.set(entity, { vx: 0, vy: 0 });
    const modelId = resolvePlayerModelId(artifact, playerId);
    players.set(entity, {
      playerId,
      health: options.playerHealth ?? DAMAGE.playerHealth,
      alive: 1,
      team: slot.team,
      modelId,
    });
    animations.set(entity, { modelId, clipKey: 'idle', facingDeg: 0, moving: false });
    stats.set(entity, { kills: 0, deaths: 0 });
    teams.set(entity, { team: slot.team });
    facings.set(entity, { dir: 0 });
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
