import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeClipId, makePackId } from '../ids.js';
import {
  AssetLibraryReference,
  PlayerModelRef,
  isPlayerModelRefable,
  resolvePlayerModelClipId,
} from './library.js';

const UUID = '550e8400-e29b-41d4-a716-446655440000';
const OTHER_UUID = '550e8400-e29b-41d4-a716-446655440001';

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
      anchor: { x: 0.5, y: 1 },
    });
    expect(model.label).toBe('Hero');
    expect(model.anchor).toEqual({ x: 0.5, y: 1 });
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
      anchor: { x: 0, y: 0 },
    });
    expect(resolvePlayerModelClipId(withDefault)).toBe(makeClipId(OTHER_UUID));

    const refClipOnly = new PlayerModelRef({
      id: 'm2',
      label: 'M2',
      ref: spriteRef(UUID),
      anchor: { x: 0, y: 0 },
    });
    expect(resolvePlayerModelClipId(refClipOnly)).toBe(makeClipId(UUID));

    const noClip = new PlayerModelRef({
      id: 'm3',
      label: 'M3',
      ref: spriteRef(),
      anchor: { x: 0, y: 0 },
    });
    expect(resolvePlayerModelClipId(noClip)).toBeUndefined();
  });
});
