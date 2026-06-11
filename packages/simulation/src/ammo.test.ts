import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { AmmoReserve, addAmmo, ammoAmount, consumeAmmo, emptyAmmoReserve } from './ammo.js';
import { makeAmmoKind } from './ids.js';

const light = makeAmmoKind('light');
const heavy = makeAmmoKind('heavy');
const shell = makeAmmoKind('shell');

describe('addAmmo', () => {
  it('creates a stack for a new kind and accumulates an existing one', () => {
    const reserve = addAmmo(addAmmo(emptyAmmoReserve(), light, 12), light, 8);
    expect(ammoAmount(reserve, light)).toBe(20);
    expect(ammoAmount(reserve, heavy)).toBe(0);
  });

  it('floors fractional amounts and ignores non-positive or non-finite adds', () => {
    const base = addAmmo(emptyAmmoReserve(), light, 5.9);
    expect(ammoAmount(base, light)).toBe(5);

    expect(addAmmo(base, light, 0)).toBe(base);
    expect(addAmmo(base, light, -3)).toBe(base);
    expect(addAmmo(base, light, Number.NaN)).toBe(base);
    expect(addAmmo(base, light, Number.POSITIVE_INFINITY)).toBe(base);
  });

  it('keeps stacks in a canonical kind-sorted order regardless of insertion order', () => {
    const a = addAmmo(addAmmo(addAmmo(emptyAmmoReserve(), shell, 1), light, 2), heavy, 3);
    const b = addAmmo(addAmmo(addAmmo(emptyAmmoReserve(), light, 2), heavy, 3), shell, 1);
    expect(a.stacks).toEqual(b.stacks);
    expect(a.stacks.map((stack) => stack.ammoKind)).toEqual([heavy, light, shell]);
  });

  it('never mutates the input reserve', () => {
    const before = addAmmo(emptyAmmoReserve(), light, 4);
    addAmmo(before, light, 10);
    expect(ammoAmount(before, light)).toBe(4);
  });
});

describe('consumeAmmo', () => {
  it('takes the requested rounds when available', () => {
    const before = addAmmo(emptyAmmoReserve(), light, 10);
    const { reserve, consumed } = consumeAmmo(before, light, 4);
    expect(consumed).toBe(4);
    expect(ammoAmount(reserve, light)).toBe(6);
    expect(ammoAmount(before, light)).toBe(10);
  });

  it('clamps to what is held', () => {
    const before = addAmmo(emptyAmmoReserve(), light, 3);
    const { reserve, consumed } = consumeAmmo(before, light, 99);
    expect(consumed).toBe(3);
    expect(ammoAmount(reserve, light)).toBe(0);
  });

  it('removes a stack that reaches zero (canonical empty form)', () => {
    const before = addAmmo(addAmmo(emptyAmmoReserve(), light, 2), heavy, 1);
    const { reserve } = consumeAmmo(before, light, 2);
    expect(reserve.stacks.map((stack) => stack.ammoKind)).toEqual([heavy]);
  });

  it('consumes nothing for a missing kind or a non-positive request', () => {
    const before = addAmmo(emptyAmmoReserve(), light, 5);
    expect(consumeAmmo(before, heavy, 3)).toEqual({ reserve: before, consumed: 0 });
    expect(consumeAmmo(before, light, 0)).toEqual({ reserve: before, consumed: 0 });
    expect(consumeAmmo(before, light, -2)).toEqual({ reserve: before, consumed: 0 });
    expect(consumeAmmo(before, light, Number.NaN)).toEqual({ reserve: before, consumed: 0 });
  });

  it('floors a fractional request', () => {
    const before = addAmmo(emptyAmmoReserve(), light, 5);
    const { consumed } = consumeAmmo(before, light, 2.9);
    expect(consumed).toBe(2);
  });
});

describe('schemas', () => {
  it('round-trips AmmoReserve through encode/decode', () => {
    const reserve = addAmmo(addAmmo(emptyAmmoReserve(), light, 7), heavy, 2);
    const encoded = Schema.encodeUnknownSync(AmmoReserve)(reserve);
    const decoded = Schema.decodeUnknownSync(AmmoReserve)(encoded);
    expect(decoded.stacks).toEqual(reserve.stacks);
  });
});
