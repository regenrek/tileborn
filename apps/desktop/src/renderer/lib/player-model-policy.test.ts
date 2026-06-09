import {
  AssetLibraryReference,
  PlayerModelClipSet,
  PlayerModelRef,
  REQUIRED_PLAYER_MODEL_CLIP_KEYS,
  makeClipId,
  makeMapId,
  makePackId,
  makeTileborneMap,
} from '@tileborne/core';
import { describe, expect, it } from 'vitest';

import {
  findPlayerModelById,
  resolvePlayerModelPolicy,
  type PlayerModelPolicyContribution,
} from './player-model-policy';

const UUID = '550e8400-e29b-41d4-a716-446655440000';
const clipIdAt = (index: number) => makeClipId(`550e8400-e29b-41d4-a716-44665544000${index}`);

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
    label: id,
    ref: new AssetLibraryReference({ packId: makePackId(UUID), kind: 'sprite', refId: id }),
    clips: clips(),
    anchor: { x: 0.5, y: 1 },
    hitbox: { x: 0.25, y: 0.1, width: 0.5, height: 0.85 },
    muzzle: { x: 0.75, y: 0.45 },
  });

const emptyMap = makeTileborneMap({
  id: makeMapId(UUID),
  width: 1,
  height: 1,
  tileWidth: 16,
  tileHeight: 16,
});

const selectable: PlayerModelPolicyContribution = {
  pluginId: 'plugin-a',
  mode: 'selectable',
  requiredClipKeys: REQUIRED_PLAYER_MODEL_CLIP_KEYS,
  defaultGeometry: {
    anchor: { x: 0.5, y: 1 },
    muzzle: { x: 0.75, y: 0.45 },
    hitbox: { x: 0.25, y: 0.1, width: 0.5, height: 0.85 },
    renderScale: 1,
    worldSize: { width: 24, height: 32 },
  },
  placeholderModelIds: ['legacy'],
  resolveModels: () => [model('m1'), model('m2')],
};

const fixed: PlayerModelPolicyContribution = {
  pluginId: 'plugin-b',
  mode: 'fixed',
  resolveModels: () => [model('only')],
};

describe('resolvePlayerModelPolicy', () => {
  it('returns the first enabled plugin policy', () => {
    const resolved = resolvePlayerModelPolicy(['plugin-a'], [selectable, fixed], { map: emptyMap });
    expect(resolved?.mode).toBe('selectable');
    expect(resolved?.models.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(resolved?.requiredClipKeys).toEqual([...REQUIRED_PLAYER_MODEL_CLIP_KEYS]);
    expect(resolved?.defaultGeometry?.worldSize).toEqual({ width: 24, height: 32 });
    expect(resolved?.placeholderModelIds).toEqual(['legacy']);
  });

  it('returns undefined when no contributing plugin is enabled', () => {
    expect(resolvePlayerModelPolicy(['other'], [selectable], { map: emptyMap })).toBeUndefined();
  });

  it('findPlayerModelById matches by id and falls back to the first model', () => {
    const resolved = resolvePlayerModelPolicy(['plugin-a'], [selectable], { map: emptyMap });
    expect(findPlayerModelById(resolved, 'm2')?.id).toBe('m2');
    expect(findPlayerModelById(resolved, 'missing')?.id).toBe('m1');
    expect(findPlayerModelById(resolved, undefined)?.id).toBe('m1');
    expect(findPlayerModelById(undefined, 'm1')).toBeUndefined();
  });
});
