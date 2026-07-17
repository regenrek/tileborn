import {
  AssetLibraryReference,
  PlayerModelClipSet,
  PlayerModelHitbox,
  PlayerModelRef,
  makeClipId,
  makePackId,
} from '@tileborne/core';
import { describe, expect, it } from 'vitest';

import type { ResolvedPlayerModelPolicy } from '@/lib/player-model-policy';
import {
  diagnosePlayerModelPolicy,
  diagnoseVisualModelAuthoring,
} from './visual-model-diagnostics';

const UUID = '550e8400-e29b-41d4-a716-446655441000';
const PACK_ID = makePackId(UUID);
const clipIdAt = (index: number) => makeClipId(`550e8400-e29b-41d4-a716-44665544100${index}`);

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

const playerModel = (id: string): PlayerModelRef =>
  new PlayerModelRef({
    id,
    label: id,
    ref: new AssetLibraryReference({ packId: PACK_ID, kind: 'sprite', refId: id }),
    clips: clips(),
    anchor: { x: 0.5, y: 0.86 },
    hitbox: { x: 0.28, y: 0.18, width: 0.44, height: 0.66 },
  });

const modelPolicy = (models: readonly PlayerModelRef[]): ResolvedPlayerModelPolicy => ({
  pluginId: 'plugin-test',
  mode: 'selectable',
  requiredClipKeys: ['idle', 'shoot'],
  placeholderModelIds: ['vanguard'],
  models,
});

describe('player model authoring diagnostics', () => {
  it('reports invalid player model geometry and placeholder model ids', () => {
    const broken = new PlayerModelRef({
      ...playerModel('vanguard'),
      hitbox: new PlayerModelHitbox({ x: 0.8, y: 0.2, width: 0.4, height: 0.8 }),
    });
    const diagnostics = diagnosePlayerModelPolicy(modelPolicy([broken]));

    expect(diagnostics.map((entry) => entry.code)).toEqual([
      'player-model.placeholder',
      'player-model.invalid-ref',
    ]);
  });

  it('reports a missing policy and an empty roster as blocking', () => {
    expect(diagnosePlayerModelPolicy(undefined).map((entry) => entry.code)).toEqual([
      'player-model.policy-missing',
    ]);

    const diagnostics = diagnoseVisualModelAuthoring({
      playerModelPolicy: modelPolicy([]),
    });
    expect(diagnostics.some((entry) => entry.code === 'player-model.model-missing')).toBe(true);
  });

  it('passes for a complete roster', () => {
    const diagnostics = diagnosePlayerModelPolicy(modelPolicy([playerModel('hero')]));
    expect(diagnostics).toEqual([]);
  });
});
