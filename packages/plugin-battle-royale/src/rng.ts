/** Deterministic xoshiro128** PRNG (seed → reproducible sequence). */

export class SeededRng {
  private state: Uint32Array;

  constructor(seed: string | number) {
    this.state = new Uint32Array(4);
    const numeric =
      typeof seed === "number"
        ? seed >>> 0
        : seed.split("").reduce((acc, char) => (Math.imul(31, acc) + char.charCodeAt(0)) >>> 0, 0x9e3779b9);
    this.state[0] = numeric;
    this.state[1] = Math.imul(numeric ^ 0x85ebca6b, 0xc2b2ae35) >>> 0;
    this.state[2] = Math.imul(numeric ^ 0xc2b2ae35, 0x165667b1) >>> 0;
    this.state[3] = Math.imul(numeric ^ 0x27d4eb2d, 0x9e3779b9) >>> 0;
    for (let index = 0; index < 12; index += 1) {
      this.nextUint32();
    }
  }

  nextUint32(): number {
    const result = (Math.imul(this.rotl(Math.imul(this.state[1]!, 5), 7), 9) + this.state[0]!) >>> 0;
    const t = (this.state[1]! << 9) >>> 0;
    this.state[2]! ^= this.state[0]!;
    this.state[3]! ^= this.state[1]!;
    this.state[1]! ^= this.state[2]!;
    this.state[0]! ^= this.state[3]!;
    this.state[2]! ^= t;
    this.state[3] = this.rotl(this.state[3]!, 11);
    return result;
  }

  nextFloat(): number {
    return this.nextUint32() / 0x1_0000_0000;
  }

  nextInt(min: number, max: number): number {
    const span = max - min + 1;
    return min + (this.nextUint32() % span);
  }

  private rotl(value: number, shift: number): number {
    return ((value << shift) | (value >>> (32 - shift))) >>> 0;
  }
}
