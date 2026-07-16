import {
  AssetLibraryReference,
  PlayerModelClipSet,
  PlayerModelRef,
  REQUIRED_PLAYER_MODEL_CLIP_KEYS,
  makeClipId,
  makePackId,
  makeProjectId,
  makeProjectManifest,
} from '@tileborne/core';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  BATTLE_ROYALE_PLAYER_MODEL_POLICY,
  applyBattleRoyalePlayerModels,
  hasBattleRoyalePlayerModelOverrides,
  readBattleRoyalePlayerModelOverrides,
  readBattleRoyalePlayerModels,
  removeBattleRoyalePlayerModel,
  resolveBattleRoyalePlayerModels,
  resolveBattleRoyalePlayerModelsWire,
  upsertBattleRoyalePlayerModel,
  validateBattleRoyalePlayerModelRoster,
} from '../roster.js';

const UUID = '550e8400-e29b-41d4-a716-446655440000';
const clipIdAt = (index: number) => makeClipId(`550e8400-e29b-41d4-a716-44665544000${index}`);

const baseProject = () => makeProjectManifest({ id: makeProjectId(UUID), name: 'Demo' });

const clips = () =>
  new PlayerModelClipSet({
    idle: clipIdAt(0),
    walk: clipIdAt(1),
    run: clipIdAt(2),
    shoot: clipIdAt(3),
    reload: clipIdAt(4),
    hit: clipIdAt(5),
    death: clipIdAt(6),
    dash: clipIdAt(7),
    pickup: clipIdAt(8),
  });

const model = (id: string): PlayerModelRef =>
  new PlayerModelRef({
    id,
    label: id.toUpperCase(),
    ref: new AssetLibraryReference({
      packId: makePackId(UUID),
      kind: 'sprite',
      refId: `placeable:${id}`,
      clipId: makeClipId(UUID),
    }),
    clips: clips(),
    anchor: { x: 0.5, y: 1 },
    hitbox: { x: 0.25, y: 0.1, width: 0.5, height: 0.85 },
  });

describe('battle-royale-player-models', () => {
  it('reads an empty roster from a fresh project', () => {
    expect(readBattleRoyalePlayerModels(baseProject())).toEqual([]);
    expect(readBattleRoyalePlayerModels(undefined)).toEqual([]);
  });

  it('resolves bundled production defaults when a project has no authored roster', () => {
    const resolved = resolveBattleRoyalePlayerModels(baseProject());
    expect(resolved.map((entry) => entry.id)).toEqual(['maltipoo-mae', 'maltipoo-max']);
    expect(validateBattleRoyalePlayerModelRoster(resolved)).toEqual([]);
  });

  it('resolves the WIRE roster for node-entry hosts (generic resolvePlayerModels, M5 S1)', () => {
    const wire = resolveBattleRoyalePlayerModelsWire(undefined);
    // Plain JSON across the bundle boundary, decodable by the host's own core copy.
    expect(JSON.parse(JSON.stringify(wire))).toEqual(wire);
    const decoded = Schema.decodeUnknownSync(Schema.Array(PlayerModelRef))(wire);
    expect(decoded.map((entry) => entry.id)).toEqual(['maltipoo-mae', 'maltipoo-max']);
  });

  it('persists + round-trips a roster through project settings', () => {
    const next = applyBattleRoyalePlayerModels(baseProject(), [model('hero'), model('mage')]);
    const roundTripped = readBattleRoyalePlayerModels(next);
    expect(roundTripped.map((m) => m.id)).toEqual(['hero', 'mage']);
    expect(roundTripped[0]).toBeInstanceOf(PlayerModelRef);
    expect(roundTripped[0]?.anchor).toEqual({ x: 0.5, y: 1 });
    expect(Object.keys(roundTripped[0]?.clips ?? {})).toEqual([...REQUIRED_PLAYER_MODEL_CLIP_KEYS]);
  });

  it('ignores stale generated defaults so Maltipoos stay visible', () => {
    const stale = applyBattleRoyalePlayerModels(baseProject(), [
      model('vanguard'),
      model('ranger'),
      model('medic'),
      model('engineer'),
    ]);

    expect(readBattleRoyalePlayerModels(stale).map((entry) => entry.id)).toEqual([
      'vanguard',
      'ranger',
      'medic',
      'engineer',
    ]);
    expect(readBattleRoyalePlayerModelOverrides(stale)).toEqual([]);
    expect(hasBattleRoyalePlayerModelOverrides(stale)).toBe(false);
    expect(resolveBattleRoyalePlayerModels(stale).map((entry) => entry.id)).toEqual([
      'maltipoo-mae',
      'maltipoo-max',
    ]);
  });

  it('preserves authored project models while dropping stale generated defaults', () => {
    const mixed = applyBattleRoyalePlayerModels(baseProject(), [model('vanguard'), model('hero')]);

    expect(readBattleRoyalePlayerModelOverrides(mixed).map((entry) => entry.id)).toEqual(['hero']);
    expect(hasBattleRoyalePlayerModelOverrides(mixed)).toBe(true);
    expect(resolveBattleRoyalePlayerModels(mixed).map((entry) => entry.id)).toEqual(['hero']);
  });

  it('upserts by id and removes by id', () => {
    let project = upsertBattleRoyalePlayerModel(baseProject(), model('hero'));
    project = upsertBattleRoyalePlayerModel(project, model('mage'));
    expect(readBattleRoyalePlayerModels(project).map((m) => m.id)).toEqual(['hero', 'mage']);

    const renamed = new PlayerModelRef({ ...model('hero'), label: 'Renamed' });
    project = upsertBattleRoyalePlayerModel(project, renamed);
    expect(readBattleRoyalePlayerModels(project)).toHaveLength(2);
    expect(readBattleRoyalePlayerModels(project)[0]?.label).toBe('Renamed');

    project = removeBattleRoyalePlayerModel(project, 'hero');
    expect(readBattleRoyalePlayerModels(project).map((m) => m.id)).toEqual(['mage']);
  });

  it('exposes a selectable policy that resolves the project roster', () => {
    const project = applyBattleRoyalePlayerModels(baseProject(), [model('hero')]);
    expect(BATTLE_ROYALE_PLAYER_MODEL_POLICY.mode).toBe('selectable');
    expect(BATTLE_ROYALE_PLAYER_MODEL_POLICY.placeholderModelIds).toContain('vanguard');
    const resolved = BATTLE_ROYALE_PLAYER_MODEL_POLICY.resolveModels({
      map: undefined as never,
      project,
    });
    expect(resolved.map((m) => m.id)).toEqual(['hero']);
  });

  it('rejects incomplete production player models', () => {
    const invalid = new PlayerModelRef({
      ...model('bad'),
      defaultClipId: makeClipId('550e8400-e29b-41d4-a716-446655440999'),
    });

    expect(validateBattleRoyalePlayerModelRoster([invalid])[0]?.path).toBe(
      'playerModels[0].defaultClipId',
    );
    expect(() => applyBattleRoyalePlayerModels(baseProject(), [invalid])).toThrow(
      /Invalid Battle Royale player-model roster/,
    );
  });
});
