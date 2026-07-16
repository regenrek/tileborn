import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { JsonValue } from './index.js';

describe('JsonValue', () => {
  it('accepts nested JSON shapes', () => {
    const value = Schema.decodeUnknownSync(JsonValue)({
      count: 2,
      flags: [true, false, null],
      meta: { label: 'spawn' },
    });
    expect(value).toEqual({
      count: 2,
      flags: [true, false, null],
      meta: { label: 'spawn' },
    });
  });

  it('rejects non-JSON values at the root', () => {
    expect(() => Schema.decodeUnknownSync(JsonValue)(undefined)).toThrow();
    expect(() => Schema.decodeUnknownSync(JsonValue)(() => 1)).toThrow();
    expect(() => Schema.decodeUnknownSync(JsonValue)(Symbol('x'))).toThrow();
    expect(() => Schema.decodeUnknownSync(JsonValue)(1n)).toThrow();
    expect(() => Schema.decodeUnknownSync(JsonValue)(new Date())).toThrow();
  });

  it('rejects non-JSON values when nested deeply', () => {
    expect(() =>
      Schema.decodeUnknownSync(JsonValue)({
        ok: true,
        nested: { bad: Number.NaN },
      }),
    ).toThrow();

    expect(() =>
      Schema.decodeUnknownSync(JsonValue)({
        items: [{ ok: 1 }, { bad: undefined }],
      }),
    ).toThrow();
  });

  it.each([
    ['function', () => 1],
    ['symbol', Symbol('x')],
    ['Date', new Date()],
    ['BigInt', 1n],
  ] as const)('rejects nested %s values', (_label, badValue) => {
    expect(() =>
      Schema.decodeUnknownSync(JsonValue)({
        items: [{ ok: true, nested: { bad: badValue } }],
      }),
    ).toThrow('value is not a finite JSON value');
  });
});
