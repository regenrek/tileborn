import { describe, expect, it } from 'vitest';

import { CanonicalJsonError } from '../errors/index.js';
import { canonicalJson } from './canonical-json.js';
import { CONTENT_HASH_ALGORITHM, hashBytes, hashJsonStable, sha256Hex } from './hash.js';

describe('canonicalJson', () => {
  it('serializes with sorted keys regardless of input order', () => {
    const a = canonicalJson({ b: 2, a: 1, nested: { z: true, y: false } });
    const b = canonicalJson({ nested: { y: false, z: true }, a: 1, b: 2 });
    expect(a).toBe('{"a":1,"b":2,"nested":{"y":false,"z":true}}');
    expect(a).toBe(b);
  });

  it('rejects undefined values', () => {
    expect(() => canonicalJson(undefined)).toThrow(CanonicalJsonError);
    expect(() => canonicalJson({ ok: 1, bad: undefined })).toThrow(CanonicalJsonError);
  });

  it('rejects non-finite numbers', () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(CanonicalJsonError);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(CanonicalJsonError);
    expect(() => canonicalJson({ value: Number.NEGATIVE_INFINITY })).toThrow(CanonicalJsonError);
  });

  it('rejects bigint', () => {
    expect(() => canonicalJson(1n)).toThrow(CanonicalJsonError);
    expect(() => canonicalJson({ value: 1n })).toThrow(CanonicalJsonError);
  });

  it('rejects Date, Map, and Set', () => {
    expect(() => canonicalJson(new Date())).toThrow(CanonicalJsonError);
    expect(() => canonicalJson(new Map([['a', 1]]))).toThrow(CanonicalJsonError);
    expect(() => canonicalJson(new Set([1]))).toThrow(CanonicalJsonError);
  });

  it('rejects class instances', () => {
    class Box {
      readonly value = 1;
    }
    expect(() => canonicalJson(new Box())).toThrow(CanonicalJsonError);
  });

  it('rejects sparse arrays', () => {
    const sparse: number[] = [];
    sparse[1] = 2;
    expect(() => canonicalJson(sparse)).toThrow(CanonicalJsonError);
  });

  it('preserves UTF-8 string stability', () => {
    const payload = { emoji: '🧱', text: 'café' };
    const serialized = canonicalJson(payload);
    expect(serialized).toBe(`{"emoji":"🧱","text":"café"}`);
    expect(serialized).toBe(canonicalJson({ text: 'café', emoji: '🧱' }));
  });

  it('serializes nested arrays in order', () => {
    expect(canonicalJson({ layers: [[1, 2], [3]] })).toBe('{"layers":[[1,2],[3]]}');
  });
});

describe('hashing', () => {
  it('matches standard SHA-256 vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('documents sha256 algorithm and stable output', () => {
    expect(CONTENT_HASH_ALGORITHM).toBe('sha256');
    const left = hashJsonStable({ a: 1, b: [2, 3] });
    const right = hashJsonStable({ b: [2, 3], a: 1 });
    expect(left).toBe(right);
    expect(left).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('produces different hashes for different inputs', () => {
    const a = hashJsonStable({ value: 1 });
    const b = hashJsonStable({ value: 2 });
    expect(a).not.toBe(b);
  });

  it('hashes bytes deterministically', () => {
    const bytes = new TextEncoder().encode('tileborne');
    expect(hashBytes(bytes)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(hashBytes(bytes)).toBe(hashBytes(bytes));
  });
});
