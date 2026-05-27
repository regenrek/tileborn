import { Around8Bits } from "../neighborhoods.js";

/** Edge bit flags in around-8 clockwise layout (phaser3-autotile / cr31 blob reference). */
export const EdgeMaskBits = {
  N: 1 << Around8Bits.N,
  E: 1 << Around8Bits.E,
  S: 1 << Around8Bits.S,
  W: 1 << Around8Bits.W,
} as const;

/** Corner bit flags in around-8 clockwise layout. */
export const CornerMaskBits = {
  NE: 1 << Around8Bits.NE,
  SE: 1 << Around8Bits.SE,
  SW: 1 << Around8Bits.SW,
  NW: 1 << Around8Bits.NW,
} as const;

/**
 * Standard 47-tile blob manifest (phaser3-autotile `Patterns.LITERAL_BLOB`).
 * Keys are projected around-8 wang ids; values are canonical atlas cell indices.
 */
export const BLOB47_MASK_TO_TILE_INDEX: Readonly<Record<number, number>> = {
  0: 0,
  1: 1,
  4: 2,
  5: 3,
  7: 4,
  16: 5,
  17: 6,
  20: 7,
  21: 8,
  23: 9,
  28: 10,
  29: 11,
  31: 12,
  64: 13,
  65: 14,
  68: 15,
  69: 16,
  71: 17,
  80: 18,
  81: 19,
  84: 20,
  85: 21,
  87: 22,
  92: 23,
  93: 24,
  95: 25,
  112: 26,
  113: 27,
  116: 28,
  117: 29,
  119: 30,
  124: 31,
  125: 32,
  127: 33,
  193: 34,
  197: 35,
  199: 36,
  209: 37,
  213: 38,
  215: 39,
  221: 40,
  223: 41,
  241: 42,
  245: 43,
  247: 44,
  253: 45,
  255: 46,
};

/** Expected unique tile count for blob / RPG Maker A2 manifests. */
export const BLOB47_TILE_COUNT = 47;

/**
 * Wang 2-edge 16-tile layout (phaser3-autotile `Patterns.EDGE`).
 * Used by RPG Maker A3/A4 wall and ceiling autotiles.
 */
export const EDGE16_MASK_TO_TILE_INDEX: Readonly<Record<number, number>> = {
  [EdgeMaskBits.S]: 0,
  [EdgeMaskBits.S | EdgeMaskBits.E]: 1,
  [EdgeMaskBits.W | EdgeMaskBits.S | EdgeMaskBits.E]: 2,
  [EdgeMaskBits.W | EdgeMaskBits.S]: 3,
  [EdgeMaskBits.N | EdgeMaskBits.S]: 4,
  [EdgeMaskBits.N | EdgeMaskBits.E | EdgeMaskBits.S]: 5,
  [EdgeMaskBits.N | EdgeMaskBits.E | EdgeMaskBits.S | EdgeMaskBits.W]: 6,
  [EdgeMaskBits.N | EdgeMaskBits.S | EdgeMaskBits.W]: 7,
  [EdgeMaskBits.N]: 8,
  [EdgeMaskBits.N | EdgeMaskBits.E]: 9,
  [EdgeMaskBits.N | EdgeMaskBits.E | EdgeMaskBits.W]: 10,
  [EdgeMaskBits.N | EdgeMaskBits.W]: 11,
  0: 12,
  [EdgeMaskBits.E]: 13,
  [EdgeMaskBits.E | EdgeMaskBits.W]: 14,
  [EdgeMaskBits.W]: 15,
};

/** Expected tile count for RPG Maker A3/A4 edge autotile blocks. */
export const RPGM_EDGE_TILE_COUNT = 16;

/**
 * Wang 2-corner 16-tile layout (phaser3-autotile `Patterns.BRIGITTS_CROSS`).
 * Used when compiling corner wang atlases from fixed cell order.
 */
export const CORNER16_MASK_TO_TILE_INDEX: Readonly<Record<number, number>> = {
  [CornerMaskBits.SW]: 0,
  [CornerMaskBits.NE | CornerMaskBits.SE]: 1,
  [CornerMaskBits.NW | CornerMaskBits.SW | CornerMaskBits.SE]: 2,
  [CornerMaskBits.SW | CornerMaskBits.SE]: 3,
  [CornerMaskBits.NW | CornerMaskBits.SE]: 4,
  [CornerMaskBits.NE | CornerMaskBits.SE | CornerMaskBits.SW]: 5,
  [CornerMaskBits.NE | CornerMaskBits.SE | CornerMaskBits.SW | CornerMaskBits.NW]: 6,
  [CornerMaskBits.NE | CornerMaskBits.SW | CornerMaskBits.NW]: 7,
  [CornerMaskBits.NE]: 8,
  [CornerMaskBits.NW | CornerMaskBits.NE]: 9,
  [CornerMaskBits.NW | CornerMaskBits.NE | CornerMaskBits.SE]: 10,
  [CornerMaskBits.NW | CornerMaskBits.SW]: 11,
  0: 12,
  [CornerMaskBits.SE]: 13,
  [CornerMaskBits.SW | CornerMaskBits.NE]: 14,
  [CornerMaskBits.NW]: 15,
};

/** Edge4 bit values aligned with {@link Edge4Bits}. */
export const edgeMaskFromEdge4Bits = (bits: {
  readonly n: boolean;
  readonly e: boolean;
  readonly s: boolean;
  readonly w: boolean;
}): number =>
  (bits.n ? EdgeMaskBits.N : 0) |
  (bits.e ? EdgeMaskBits.E : 0) |
  (bits.s ? EdgeMaskBits.S : 0) |
  (bits.w ? EdgeMaskBits.W : 0);
