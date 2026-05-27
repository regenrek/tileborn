import { describe, expect, it } from 'vitest';

import {
  computeAimDeg,
  isPlaytestMovementKey,
  movementKeysToDirection,
  parseWeaponSlotKey,
} from './playtest-input';

describe('playtest-input', () => {
  it('maps arrow-right to east (dir=0)', () => {
    expect(movementKeysToDirection(new Set(['ArrowRight']))).toBe(0);
  });

  it('maps W+D to north-east (dir=7)', () => {
    expect(movementKeysToDirection(new Set(['KeyW', 'KeyD']))).toBe(7);
  });

  it('recognizes WASD and arrow movement keys', () => {
    expect(isPlaytestMovementKey('ArrowUp')).toBe(true);
    expect(isPlaytestMovementKey('KeyA')).toBe(true);
    expect(isPlaytestMovementKey('Space')).toBe(false);
  });

  describe('computeAimDeg', () => {
    it('returns 0° when pointer is east of the player (DOM screen-space)', () => {
      expect(computeAimDeg(110, 50, 50, 50)).toBeCloseTo(0, 0);
    });

    it('returns 90° when pointer is south (y grows downward in DOM)', () => {
      expect(computeAimDeg(50, 110, 50, 50)).toBeCloseTo(90, 0);
    });

    it('returns 180° when pointer is west', () => {
      expect(computeAimDeg(-10, 50, 50, 50)).toBeCloseTo(180, 0);
    });

    it('returns 270° when pointer is north', () => {
      expect(computeAimDeg(50, -10, 50, 50)).toBeCloseTo(270, 0);
    });

    it('returns a normalized integer in [0, 359]', () => {
      for (let deg = 0; deg < 360; deg += 17) {
        const rad = (deg * Math.PI) / 180;
        const result = computeAimDeg(
          Math.cos(rad) * 100 + 50,
          Math.sin(rad) * 100 + 50,
          50,
          50,
        );
        expect(Number.isInteger(result)).toBe(true);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(359);
        expect(Math.abs(result - deg)).toBeLessThanOrEqual(1);
      }
    });

    it('returns 0 when pointer is exactly on the player', () => {
      expect(computeAimDeg(50, 50, 50, 50)).toBe(0);
    });
  });

  describe('parseWeaponSlotKey', () => {
    it('parses Digit1..Digit5', () => {
      expect(parseWeaponSlotKey('Digit1')).toBe(1);
      expect(parseWeaponSlotKey('Digit5')).toBe(5);
    });

    it('parses Numpad1..Numpad5', () => {
      expect(parseWeaponSlotKey('Numpad3')).toBe(3);
    });

    it('rejects out-of-range and non-digit codes', () => {
      expect(parseWeaponSlotKey('Digit0')).toBeUndefined();
      expect(parseWeaponSlotKey('Digit6')).toBeUndefined();
      expect(parseWeaponSlotKey('KeyA')).toBeUndefined();
      expect(parseWeaponSlotKey('Space')).toBeUndefined();
    });
  });
});
