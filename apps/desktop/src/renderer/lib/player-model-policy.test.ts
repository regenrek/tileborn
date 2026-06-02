import {
  AssetLibraryReference,
  PlayerModelRef,
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

const model = (id: string): PlayerModelRef =>
  new PlayerModelRef({
    id,
    label: id,
    ref: new AssetLibraryReference({ packId: makePackId(UUID), kind: 'sprite', refId: id }),
    anchor: { x: 0.5, y: 1 },
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
