import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeClipId, makePackId } from '../ids.js';
import {
  AssetLibraryReference,
  PlayerModelClipSet,
  PlayerModelRef,
  PlayerModelWorldSize,
  REQUIRED_PLAYER_MODEL_CLIP_KEYS,
  isPlayerModelRefable,
  resolvePlayerModelClipId,
  validatePlayerModelRef,
} from './library.js';

const UUID = '550e8400-e29b-41d4-a716-446655440000';
const OTHER_UUID = '550e8400-e29b-41d4-a716-446655440001';
const OUTSIDE_CLIP_UUID = '550e8400-e29b-41d4-a716-446655440999';
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

const geometry = {
  anchor: { x: 0.5, y: 1 },
  hitbox: { x: 0.25, y: 0.1, width: 0.5, height: 0.85 },
  muzzle: { x: 0.75, y: 0.45 },
} as const;

const spriteRef = (clipId?: string) =>
  new AssetLibraryReference({
    packId: makePackId(UUID),
    kind: 'sprite',
    refId: 'placeable:hero',
    ...(clipId === undefined ? {} : { clipId: makeClipId(clipId) }),
  });

describe('PlayerModelRef', () => {
  it('decodes a valid sprite-backed player model', () => {
    const model = Schema.decodeUnknownSync(PlayerModelRef)({
      id: 'model-hero',
      label: 'Hero',
      ref: spriteRef(UUID),
      clips: clips(),
      ...geometry,
    });
    expect(model.label).toBe('Hero');
    expect(model.anchor).toEqual({ x: 0.5, y: 1 });
    expect(Object.keys(model.clips)).toEqual([...REQUIRED_PLAYER_MODEL_CLIP_KEYS]);
    expect(validatePlayerModelRef(model)).toEqual([]);
  });

  it('flags which reference kinds can back a player model', () => {
    expect(isPlayerModelRefable('sprite')).toBe(true);
    expect(isPlayerModelRefable('placeable')).toBe(true);
    expect(isPlayerModelRefable('tile')).toBe(false);
    expect(isPlayerModelRefable('terrain')).toBe(false);
  });

  it('prefers defaultClipId, then the underlying ref clip', () => {
    const withDefault = new PlayerModelRef({
      id: 'm1',
      label: 'M1',
      ref: spriteRef(UUID),
      defaultClipId: makeClipId(OTHER_UUID),
      clips: new PlayerModelClipSet({ ...clips(), idle: makeClipId(OTHER_UUID) }),
      ...geometry,
    });
    expect(resolvePlayerModelClipId(withDefault)).toBe(makeClipId(OTHER_UUID));

    const refClipOnly = new PlayerModelRef({
      id: 'm2',
      label: 'M2',
      ref: spriteRef(UUID),
      clips: clips(),
      ...geometry,
    });
    expect(resolvePlayerModelClipId(refClipOnly)).toBe(makeClipId(UUID));

    const idleFallback = new PlayerModelRef({
      id: 'm3',
      label: 'M3',
      ref: spriteRef(),
      clips: clips(),
      ...geometry,
    });
    expect(resolvePlayerModelClipId(idleFallback)).toBe(clipIdAt(0));
  });

  it('reports semantic validation issues for bad production geometry/default clips', () => {
    const bad = new PlayerModelRef({
      id: '',
      label: '',
      ref: spriteRef(OUTSIDE_CLIP_UUID),
      defaultClipId: makeClipId(OUTSIDE_CLIP_UUID),
      clips: clips(),
      anchor: { x: -1, y: 2 },
      hitbox: { x: 0.8, y: 0.8, width: 0.5, height: 0.5 },
      muzzle: { x: 1.2, y: 0.5 },
      renderScale: 0,
      worldSize: new PlayerModelWorldSize({ width: -1, height: 0 }),
    });
    expect(validatePlayerModelRef(bad).map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        'id',
        'label',
        'anchor.x',
        'anchor.y',
        'hitbox',
        'muzzle.x',
        'renderScale',
        'worldSize.width',
        'worldSize.height',
        'ref.clipId',
        'defaultClipId',
      ]),
    );
  });

  it('rejects stale ref clips even when the explicit default clip is valid', () => {
    const model = new PlayerModelRef({
      id: 'm4',
      label: 'M4',
      ref: spriteRef(OUTSIDE_CLIP_UUID),
      defaultClipId: clipIdAt(0),
      clips: clips(),
      ...geometry,
    });
    expect(validatePlayerModelRef(model).map((issue) => issue.path)).toEqual(['ref.clipId']);
  });
});
