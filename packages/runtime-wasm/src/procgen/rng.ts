import { ProcgenInputError } from "../errors.js";

const MASK64 = (1n << 64n) - 1n;

const rotl = (value: bigint, shift: number): bigint =>
  ((value << BigInt(shift)) & MASK64) | (value >> BigInt(64 - shift));

const splitSeed = (seed: bigint): readonly [bigint, bigint, bigint, bigint] => {
  let state = seed & MASK64;
  if (state === 0n) {
    state = 0x9e3779b97f4a7c15n;
  }
  const s0 = (state ^ 0x9e3779b97f4a7c15n) & MASK64;
  const s1 = (state + 0xbf58476d1ce4e5b9n) & MASK64;
  const s2 = (state + 0x94d049bb133111ebn) & MASK64;
  const s3 = (state + 0x2545be4955c6a1bn) & MASK64;
  return [s0 || 1n, s1 || 2n, s2 || 3n, s3 || 4n];
};

export interface ProcgenRng {
  readonly seed: bigint;
  nextUint32(): number;
  nextFloat(): number;
  uniformInt(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  weighted<T>(items: readonly T[], weights: readonly number[]): T;
}

export class Xoshiro256StarStarRng implements ProcgenRng {
  readonly seed: bigint;
  private s0: bigint;
  private s1: bigint;
  private s2: bigint;
  private s3: bigint;

  constructor(seed: bigint | number) {
    this.seed = typeof seed === "number" ? BigInt(seed) : seed;
    const [s0, s1, s2, s3] = splitSeed(this.seed);
    this.s0 = s0;
    this.s1 = s1;
    this.s2 = s2;
    this.s3 = s3;
  }

  nextUint32(): number {
    const result = Number(this.nextUint64() & 0xffffffffn);
    return result >>> 0;
  }

  nextFloat(): number {
    return this.nextUint32() / 0x1_0000_0000;
  }

  nextUint64(): bigint {
    const result = rotl(this.s1 * 5n, 7) * 9n;
    const t = this.s1 << 17n;

    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 45);

    return result & MASK64;
  }

  uniformInt(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
      throw new ProcgenInputError({ message: "uniformInt bounds must be integers" });
    }
    if (max < min) {
      throw new ProcgenInputError({ message: "uniformInt max must be >= min" });
    }
    const span = max - min + 1;
    // Unbiased rejection sampling: discard any uint32 draw that falls in the
    // partial bucket above the largest multiple of `span` <= 2^32. With a 32-bit
    // generator the expected number of rejections is < 1 unless span is very
    // large, so this stays cheap while removing modulo bias.
    const limit = Math.floor(0x1_0000_0000 / span) * span;
    let draw = this.nextUint32();
    while (draw >= limit) {
      draw = this.nextUint32();
    }
    return min + (draw % span);
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new ProcgenInputError({ message: "pick requires a non-empty array" });
    }
    const index = this.uniformInt(0, items.length - 1);
    const value = items[index];
    if (value === undefined) {
      throw new ProcgenInputError({ message: "pick index out of range" });
    }
    return value;
  }

  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    if (items.length === 0) {
      throw new ProcgenInputError({ message: "weighted requires non-empty items" });
    }
    if (items.length !== weights.length) {
      throw new ProcgenInputError({ message: "weighted items and weights length mismatch" });
    }
    let total = 0;
    for (const weight of weights) {
      if (!Number.isFinite(weight) || weight < 0) {
        throw new ProcgenInputError({ message: "weighted values must be finite and non-negative" });
      }
      total += weight;
    }
    if (total <= 0) {
      throw new ProcgenInputError({ message: "weighted total must be positive" });
    }
    let target = this.nextFloat() * total;
    for (let index = 0; index < items.length; index += 1) {
      const weight = weights[index] ?? 0;
      target -= weight;
      if (target <= 0) {
        const item = items[index];
        if (item === undefined) {
          throw new ProcgenInputError({ message: "weighted index out of range" });
        }
        return item;
      }
    }
    const fallback = items[items.length - 1];
    if (fallback === undefined) {
      throw new ProcgenInputError({ message: "weighted fallback out of range" });
    }
    return fallback;
  }
}

export const createProcgenRng = (seed: bigint | number): ProcgenRng => new Xoshiro256StarStarRng(seed);
