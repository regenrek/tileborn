import { describe, expect, it } from 'vitest';

import {
  resolveBattleRoyaleTeamTopology,
  selectBattleRoyaleSpawnTeamSlots,
} from './team-topology.js';

const legacySpawns = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ x: index * 10, y: 0, team: 'solo' }));

describe('Battle Royale team topology', () => {
  it('derives stable unique solo identities', () => {
    expect(resolveBattleRoyaleTeamTopology('solo', legacySpawns(4))).toEqual({
      source: 'derived',
      teamIds: ['solo-1', 'solo-2', 'solo-3', 'solo-4'],
      issues: [],
    });
  });

  it('derives balanced squad and duo groups from legacy solo labels', () => {
    expect(resolveBattleRoyaleTeamTopology('squad', legacySpawns(8)).teamIds).toEqual([
      'team-1',
      'team-2',
      'team-1',
      'team-2',
      'team-1',
      'team-2',
      'team-1',
      'team-2',
    ]);
    expect(resolveBattleRoyaleTeamTopology('duo', legacySpawns(8)).teamIds).toEqual([
      'team-1',
      'team-2',
      'team-3',
      'team-4',
      'team-1',
      'team-2',
      'team-3',
      'team-4',
    ]);
  });

  it('preserves coherent fully-authored squads', () => {
    const spawns = legacySpawns(8).map((spawn, index) => ({
      ...spawn,
      team: index % 2 === 0 ? 'alpha' : 'beta',
    }));
    expect(resolveBattleRoyaleTeamTopology('squad', spawns)).toEqual({
      source: 'authored',
      teamIds: ['alpha', 'beta', 'alpha', 'beta', 'alpha', 'beta', 'alpha', 'beta'],
      issues: [],
    });
  });

  it('reports mixed and impossible authored topology', () => {
    const mixed = legacySpawns(8).map((spawn, index) => ({
      ...spawn,
      team: index === 0 ? 'alpha' : spawn.team,
    }));
    expect(resolveBattleRoyaleTeamTopology('squad', mixed).issues).toEqual([
      expect.objectContaining({ code: 'mixed-authored-and-legacy-teams' }),
    ]);

    const oneOversizedTeam = legacySpawns(8).map((spawn) => ({ ...spawn, team: 'alpha' }));
    expect(resolveBattleRoyaleTeamTopology('squad', oneOversizedTeam).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'wrong-team-count' }),
        expect.objectContaining({ code: 'team-over-capacity' }),
      ]),
    );
  });

  it('selects the same deterministic spread subset before resolving teams', () => {
    const selected = selectBattleRoyaleSpawnTeamSlots(
      [
        { x: 1, y: 1, team: 'solo' },
        { x: 2, y: 1, team: 'solo' },
        { x: 3, y: 1, team: 'solo' },
        { x: 40, y: 1, team: 'solo' },
        { x: 1, y: 40, team: 'solo' },
        { x: 40, y: 40, team: 'solo' },
      ],
      3,
    );
    expect(selected.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 1, y: 1 },
      { x: 40, y: 40 },
      { x: 40, y: 1 },
    ]);
  });
});
