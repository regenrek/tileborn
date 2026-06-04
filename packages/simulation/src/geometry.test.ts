import { Option, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  CombatBlocker,
  Vec2,
  addVec,
  angleBetween,
  distance,
  dotVec,
  hasLineOfSight,
  normalizeVec,
  pointToSegmentDistance,
  rayHitDistance,
  reflectVec,
  rotateVec,
  scaleVec,
  segmentAabbEntry,
  segmentIntersectsAabb,
  subVec,
  vec2,
  vecLength,
} from './geometry.js';

const blocker = (fields: {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  blocksProjectiles?: boolean;
  blocksVision?: boolean;
}): CombatBlocker =>
  new CombatBlocker({
    minX: fields.minX,
    minY: fields.minY,
    maxX: fields.maxX,
    maxY: fields.maxY,
    blocksProjectiles: fields.blocksProjectiles ?? true,
    blocksVision: fields.blocksVision ?? true,
  });

describe('vector math', () => {
  it('adds, subtracts and scales', () => {
    expect(addVec(vec2(1, 2), vec2(3, 4))).toEqual(vec2(4, 6));
    expect(subVec(vec2(5, 5), vec2(2, 1))).toEqual(vec2(3, 4));
    expect(scaleVec(vec2(2, 3), 2)).toEqual(vec2(4, 6));
    expect(dotVec(vec2(1, 0), vec2(0, 1))).toBe(0);
    expect(vecLength(vec2(3, 4))).toBe(5);
    expect(distance(vec2(0, 0), vec2(3, 4))).toBe(5);
  });

  it('normalizes, falling back to the (1, 0) axis at zero length', () => {
    const n = normalizeVec(vec2(0, 5));
    expect(n.x).toBeCloseTo(0);
    expect(n.y).toBeCloseTo(1);
    expect(normalizeVec(vec2(0, 0))).toEqual(vec2(1, 0));
  });

  it('rotates counter-clockwise and measures angle between', () => {
    const r = rotateVec(vec2(1, 0), Math.PI / 2);
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(1);
    expect(angleBetween(vec2(1, 0), vec2(0, 1))).toBeCloseTo(Math.PI / 2);
  });

  it('reflects a direction across a surface normal', () => {
    expect(reflectVec(vec2(1, -1), vec2(0, 1))).toEqual(vec2(1, 1));
  });
});

describe('segmentIntersectsAabb', () => {
  it('detects a crossing segment and misses a parallel one', () => {
    const box = blocker({ minX: 4, minY: -1, maxX: 6, maxY: 1 });
    expect(segmentIntersectsAabb(vec2(0, 0), vec2(10, 0), box)).toBe(true);
    expect(segmentIntersectsAabb(vec2(0, 5), vec2(10, 5), box)).toBe(false);
  });
});

describe('hasLineOfSight', () => {
  it('honors the requested channel', () => {
    const visionOnly = blocker({ minX: 4, minY: -1, maxX: 6, maxY: 1, blocksProjectiles: false });
    expect(hasLineOfSight([visionOnly], vec2(0, 0), vec2(10, 0), 'vision')).toBe(false);
    expect(hasLineOfSight([visionOnly], vec2(0, 0), vec2(10, 0), 'projectiles')).toBe(true);
  });
});

describe('rayHitDistance', () => {
  it('returns along-distance for an on-axis target', () => {
    const hit = rayHitDistance(vec2(0, 0), vec2(1, 0), vec2(7, 0), 100, 1);
    expect(Option.getOrNull(hit)).toBe(7);
  });

  it('misses targets behind, beyond range, or off-axis', () => {
    expect(Option.isNone(rayHitDistance(vec2(0, 0), vec2(1, 0), vec2(-3, 0), 100, 1))).toBe(true);
    expect(Option.isNone(rayHitDistance(vec2(0, 0), vec2(1, 0), vec2(50, 0), 10, 1))).toBe(true);
    expect(Option.isNone(rayHitDistance(vec2(0, 0), vec2(1, 0), vec2(5, 5), 100, 1))).toBe(true);
  });
});

describe('pointToSegmentDistance', () => {
  it('measures the nearest distance from a point to a segment', () => {
    expect(pointToSegmentDistance(vec2(5, 3), vec2(0, 0), vec2(10, 0))).toBe(3);
    expect(pointToSegmentDistance(vec2(-5, 0), vec2(0, 0), vec2(10, 0))).toBe(5);
  });
});

describe('segmentAabbEntry', () => {
  it('reports the entry fraction and face normal', () => {
    const box = blocker({ minX: 10, minY: -100, maxX: 12, maxY: 100 });
    const entry = segmentAabbEntry(vec2(0, 0), vec2(100, 0), box);
    expect(Option.isSome(entry)).toBe(true);
    if (Option.isSome(entry)) {
      expect(entry.value.t).toBeCloseTo(0.1);
      expect(entry.value.normal).toEqual(vec2(-1, 0));
    }
  });
});

describe('schema round-trips', () => {
  it('round-trips Vec2', () => {
    const encoded = Schema.encodeUnknownSync(Vec2)(vec2(3, -4));
    expect(encoded).toEqual({ x: 3, y: -4 });
    expect(Schema.decodeUnknownSync(Vec2)(encoded)).toEqual(vec2(3, -4));
  });

  it('round-trips CombatBlocker', () => {
    const box = blocker({ minX: 1, minY: 2, maxX: 3, maxY: 4, blocksVision: false });
    const encoded = Schema.encodeUnknownSync(CombatBlocker)(box);
    expect(encoded).toEqual({
      minX: 1,
      minY: 2,
      maxX: 3,
      maxY: 4,
      blocksProjectiles: true,
      blocksVision: false,
    });
    expect(Schema.decodeUnknownSync(CombatBlocker)(encoded).blocksVision).toBe(false);
  });
});
