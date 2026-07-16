import { spreadOrderSpawnPoints } from './spawn-layout.js';

export type BattleRoyaleMatchMode = 'solo' | 'duo' | 'squad';

export interface BattleRoyaleAuthoredSpawnTeam {
  readonly x: number;
  readonly y: number;
  readonly team?: string;
}

export type BattleRoyaleTeamTopologyIssueCode =
  | 'insufficient-participants'
  | 'mixed-authored-and-legacy-teams'
  | 'wrong-team-count'
  | 'team-over-capacity'
  | 'unbalanced-teams';

export interface BattleRoyaleTeamTopologyIssue {
  readonly code: BattleRoyaleTeamTopologyIssueCode;
  readonly message: string;
}

export interface BattleRoyaleTeamTopology {
  readonly source: 'authored' | 'derived';
  /** One canonical runtime team id for each selected spawn slot, in slot order. */
  readonly teamIds: readonly string[];
  readonly issues: readonly BattleRoyaleTeamTopologyIssue[];
}

const teamCapacity = (matchMode: BattleRoyaleMatchMode): number =>
  matchMode === 'solo' ? 1 : matchMode === 'duo' ? 2 : 4;

const normalizedAuthoredTeam = (value: string | undefined): string | undefined => {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0 || normalized.toLowerCase() === 'solo'
    ? undefined
    : normalized;
};

const compareSpawnTeams = (
  left: BattleRoyaleAuthoredSpawnTeam,
  right: BattleRoyaleAuthoredSpawnTeam,
): number =>
  left.y - right.y ||
  left.x - right.x ||
  (normalizedAuthoredTeam(left.team) ?? '').localeCompare(normalizedAuthoredTeam(right.team) ?? '');

/** Select the exact authored spawn subset consumed by runtime and readiness. */
export const selectBattleRoyaleSpawnTeamSlots = <T extends BattleRoyaleAuthoredSpawnTeam>(
  authoredSpawns: readonly T[],
  maxPlayers: number,
): readonly T[] => {
  const sorted = [...authoredSpawns].sort(compareSpawnTeams);
  const count = Math.min(Math.max(0, Math.floor(maxPlayers)), sorted.length);
  return count < sorted.length
    ? spreadOrderSpawnPoints(sorted, compareSpawnTeams).slice(0, count)
    : sorted;
};

const derivedTeamIds = (
  matchMode: BattleRoyaleMatchMode,
  participantCount: number,
): readonly string[] => {
  if (matchMode === 'solo') {
    return Array.from({ length: participantCount }, (_, index) => `solo-${index + 1}`);
  }
  const minimumTeamCount = Math.ceil(participantCount / teamCapacity(matchMode));
  const teamCount = Math.min(participantCount, Math.max(2, minimumTeamCount));
  return Array.from(
    { length: participantCount },
    (_, index) => `team-${(index % teamCount) + 1}`,
  );
};

/**
 * Canonical BR team topology policy. Legacy `solo` labels derive stable,
 * balanced teams. Fully authored labels are preserved only when coherent.
 */
export const resolveBattleRoyaleTeamTopology = (
  matchMode: BattleRoyaleMatchMode,
  selectedSpawns: readonly BattleRoyaleAuthoredSpawnTeam[],
): BattleRoyaleTeamTopology => {
  const participantCount = selectedSpawns.length;
  const fallback = derivedTeamIds(matchMode, participantCount);
  if (matchMode === 'solo') {
    return { source: 'derived', teamIds: fallback, issues: [] };
  }
  if (participantCount < 2) {
    return {
      source: 'derived',
      teamIds: fallback,
      issues: [{
        code: 'insufficient-participants',
        message: `${matchMode} requires at least two usable spawn points.`,
      }],
    };
  }
  const authored = selectedSpawns.map((spawn) => normalizedAuthoredTeam(spawn.team));
  const authoredCount = authored.filter((team): team is string => team !== undefined).length;
  if (authoredCount === 0) {
    return { source: 'derived', teamIds: fallback, issues: [] };
  }
  if (authoredCount !== participantCount) {
    return {
      source: 'derived',
      teamIds: fallback,
      issues: [{
        code: 'mixed-authored-and-legacy-teams',
        message:
          'Spawn teams mix explicit labels with legacy “solo” or empty values. Label every spawn team or clear all labels to use automatic balanced teams.',
      }],
    };
  }

  const teamIds = authored as readonly string[];
  const counts = new Map<string, number>();
  for (const teamId of teamIds) counts.set(teamId, (counts.get(teamId) ?? 0) + 1);
  const sizes = [...counts.values()].sort((left, right) => left - right);
  const capacity = teamCapacity(matchMode);
  const expectedTeamCount = Math.min(
    participantCount,
    Math.max(2, Math.ceil(participantCount / capacity)),
  );
  const issues: BattleRoyaleTeamTopologyIssue[] = [];
  if (counts.size !== expectedTeamCount) {
    issues.push({
      code: 'wrong-team-count',
      message: `${matchMode} with ${participantCount} players requires ${expectedTeamCount} balanced teams; authored spawns define ${counts.size}.`,
    });
  }
  const largest = sizes.at(-1) ?? 0;
  const smallest = sizes[0] ?? 0;
  if (largest > capacity) {
    issues.push({
      code: 'team-over-capacity',
      message: `${matchMode} teams support at most ${capacity} players; an authored team contains ${largest}.`,
    });
  }
  if (largest - smallest > 1) {
    issues.push({
      code: 'unbalanced-teams',
      message: `Authored ${matchMode} teams must be balanced; current team sizes are ${sizes.join(', ')}.`,
    });
  }
  return { source: 'authored', teamIds, issues };
};

export const assertBattleRoyaleTeamTopology = (
  matchMode: BattleRoyaleMatchMode,
  selectedSpawns: readonly BattleRoyaleAuthoredSpawnTeam[],
): BattleRoyaleTeamTopology => {
  const topology = resolveBattleRoyaleTeamTopology(matchMode, selectedSpawns);
  if (topology.issues.length > 0) {
    throw new Error(
      `Invalid Battle Royale ${matchMode} team topology: ${topology.issues.map((issue) => issue.message).join(' ')}`,
    );
  }
  return topology;
};
