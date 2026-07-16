import { Schema } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { makeTileId, type Uuid } from '@tileborne/core';

import { compileAnimation } from '../compile.js';
import { resolveAnimatedTile } from '../resolve.js';
import { Animation, AnimationFrame } from '../../schemas/animation.js';
import { AnimationId } from '../../schemas/ids.js';

const variantFilterAccess = vi.hoisted(() => ({ loaded: false }));

vi.mock('../../schemas/variant-filter.js', () => {
  variantFilterAccess.loaded = true;
  return { VariantFilter: class VariantFilter {} };
});

const uuid = (suffix: string): Uuid =>
  `62656465-0000-4000-8000-${suffix.padStart(12, '0')}` as Uuid;

const tileId = (suffix: string) => makeTileId(uuid(suffix));

const decodeAnimationId = (value: string) => Schema.decodeUnknownSync(AnimationId)(value);

const makeAnimation = (frames: ReadonlyArray<{ tile: string; durationMs: number }>, loop = true) =>
  new Animation({
    id: decodeAnimationId('animation:62656465-0000-4000-8000-000000000006'),
    frames: frames.map(
      (frame) => new AnimationFrame({ tileId: tileId(frame.tile), durationMs: frame.durationMs }),
    ),
    loop,
  });

describe('compileAnimation', () => {
  it('precomputes cumulative frame end times and total loop duration', () => {
    const animation = makeAnimation([
      { tile: '1', durationMs: 100 },
      { tile: '2', durationMs: 250 },
      { tile: '3', durationMs: 50 },
    ]);

    const result = compileAnimation(animation);

    expect(result.diagnostics).toEqual([]);
    expect(result.value).toEqual({
      id: animation.id,
      loop: true,
      totalDurationMs: 400,
      frames: [
        { tileId: tileId('1'), durationMs: 100, endTimeMs: 100 },
        { tileId: tileId('2'), durationMs: 250, endTimeMs: 350 },
        { tileId: tileId('3'), durationMs: 50, endTimeMs: 400 },
      ],
    });
  });

  it('returns a diagnostic for empty frame lists', () => {
    const animation = {
      id: decodeAnimationId('animation:62656465-0000-4000-8000-000000000006'),
      frames: [],
      loop: true,
    } as unknown as Animation;

    const result = compileAnimation(animation);

    expect(result.value).toBeUndefined();
    expect(result.diagnostics).toEqual([
      {
        _tag: 'EmptyAnimationFrames',
        animationId: animation.id,
        path: `/animations/${animation.id}/frames`,
        message: 'Animation must contain at least one frame',
        severity: 'error',
      },
    ]);
  });
});

describe('resolveAnimatedTile', () => {
  const tiledStyleAnimation = makeAnimation([
    { tile: '1', durationMs: 200 },
    { tile: '2', durationMs: 200 },
    { tile: '3', durationMs: 200 },
    { tile: '4', durationMs: 200 },
  ]);

  const compiledTiledStyle = compileAnimation(tiledStyleAnimation).value!;

  it('resolves Tiled-style 4x200ms frames at canonical boundaries', () => {
    expect(resolveAnimatedTile(compiledTiledStyle, 0)).toBe(tileId('1'));
    expect(resolveAnimatedTile(compiledTiledStyle, 199)).toBe(tileId('1'));
    expect(resolveAnimatedTile(compiledTiledStyle, 200)).toBe(tileId('2'));
    expect(resolveAnimatedTile(compiledTiledStyle, 599)).toBe(tileId('3'));
    expect(resolveAnimatedTile(compiledTiledStyle, 800)).toBe(tileId('1'));
  });

  it('supports variable per-frame durations', () => {
    const animation = makeAnimation([
      { tile: '1', durationMs: 75 },
      { tile: '2', durationMs: 125 },
      { tile: '3', durationMs: 300 },
    ]);
    const compiled = compileAnimation(animation).value!;

    expect(resolveAnimatedTile(compiled, 0)).toBe(tileId('1'));
    expect(resolveAnimatedTile(compiled, 74)).toBe(tileId('1'));
    expect(resolveAnimatedTile(compiled, 75)).toBe(tileId('2'));
    expect(resolveAnimatedTile(compiled, 199)).toBe(tileId('2'));
    expect(resolveAnimatedTile(compiled, 200)).toBe(tileId('3'));
    expect(resolveAnimatedTile(compiled, 499)).toBe(tileId('3'));
    expect(resolveAnimatedTile(compiled, 500)).toBe(tileId('1'));
  });

  it('always returns the single frame for one-frame animations', () => {
    const animation = makeAnimation([{ tile: '9', durationMs: 120 }]);
    const compiled = compileAnimation(animation).value!;

    expect(resolveAnimatedTile(compiled, 0)).toBe(tileId('9'));
    expect(resolveAnimatedTile(compiled, 119)).toBe(tileId('9'));
    expect(resolveAnimatedTile(compiled, 999)).toBe(tileId('9'));
  });

  it('maps negative time to frame 0', () => {
    expect(resolveAnimatedTile(compiledTiledStyle, -1)).toBe(tileId('1'));
    expect(resolveAnimatedTile(compiledTiledStyle, -500)).toBe(tileId('1'));
  });

  it('does not load variant filter modules during resolution', () => {
    expect(variantFilterAccess.loaded).toBe(false);
    expect(resolveAnimatedTile(compiledTiledStyle, 200)).toBe(tileId('2'));
    expect(variantFilterAccess.loaded).toBe(false);
  });
});
