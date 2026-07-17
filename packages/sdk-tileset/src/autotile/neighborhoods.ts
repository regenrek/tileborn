/** Four cardinal edge neighbors (Wang 2-edge). */
export const Edge4 = 'edge4' as const;

/** Four corner Wang neighbors including the center cell at bit 7. */
export const Corner4 = 'corner4' as const;

/** Eight neighbors around a cell (blob / RPG Maker A2). */
export const Around8 = 'around8' as const;

/** Custom neighborhood with explicit offsets supplied by a rule source. */
export const CustomNeighborhood = 'custom' as const;

export type NeighborhoodKind =
  | typeof Edge4
  | typeof Corner4
  | typeof Around8
  | typeof CustomNeighborhood;

export type CellOffset = {
  readonly dx: number;
  readonly dy: number;
};

/** One neighbor direction and the mask bit it contributes. */
export type NeighborhoodBit = {
  readonly offset: CellOffset;
  readonly bit: number;
};

export type Neighborhood = {
  readonly kind: NeighborhoodKind;
  readonly bits: ReadonlyArray<NeighborhoodBit>;
  readonly offsets: ReadonlyArray<CellOffset>;
};

/**
 * Tiled / phaser3-autotile clockwise layout from north:
 * ```
 * 7 | 0 | 1
 * 6 | x | 2
 * 5 | 4 | 3
 * ```
 */
export const Around8Bits = {
  N: 0,
  NE: 1,
  E: 2,
  SE: 3,
  S: 4,
  SW: 5,
  W: 6,
  NW: 7,
} as const;

/** Edge Wang uses cardinal bits 0, 2, 4, 6. */
export const Edge4Bits = {
  N: Around8Bits.N,
  E: Around8Bits.E,
  S: Around8Bits.S,
  W: Around8Bits.W,
} as const;

/** Corner Wang uses bits 1, 3, 5, 7 with the center cell at bit 7. */
export const Corner4Bits = {
  NE: Around8Bits.NE,
  SE: Around8Bits.SE,
  SW: Around8Bits.SW,
  NW: Around8Bits.NW,
} as const;

const around8Offsets: ReadonlyArray<NeighborhoodBit> = [
  { offset: { dx: 0, dy: -1 }, bit: Around8Bits.N },
  { offset: { dx: 1, dy: -1 }, bit: Around8Bits.NE },
  { offset: { dx: 1, dy: 0 }, bit: Around8Bits.E },
  { offset: { dx: 1, dy: 1 }, bit: Around8Bits.SE },
  { offset: { dx: 0, dy: 1 }, bit: Around8Bits.S },
  { offset: { dx: -1, dy: 1 }, bit: Around8Bits.SW },
  { offset: { dx: -1, dy: 0 }, bit: Around8Bits.W },
  { offset: { dx: -1, dy: -1 }, bit: Around8Bits.NW },
];

const edge4Offsets: ReadonlyArray<NeighborhoodBit> = [
  { offset: { dx: 0, dy: -1 }, bit: Edge4Bits.N },
  { offset: { dx: 1, dy: 0 }, bit: Edge4Bits.E },
  { offset: { dx: 0, dy: 1 }, bit: Edge4Bits.S },
  { offset: { dx: -1, dy: 0 }, bit: Edge4Bits.W },
];

const corner4Offsets: ReadonlyArray<NeighborhoodBit> = [
  { offset: { dx: 1, dy: 0 }, bit: Corner4Bits.NE },
  { offset: { dx: 1, dy: 1 }, bit: Corner4Bits.SE },
  { offset: { dx: 0, dy: 1 }, bit: Corner4Bits.SW },
  { offset: { dx: 0, dy: 0 }, bit: Corner4Bits.NW },
];

const toNeighborhood = (
  kind: NeighborhoodKind,
  bits: ReadonlyArray<NeighborhoodBit>,
): Neighborhood => ({
  kind,
  bits,
  offsets: bits.map(({ offset }) => offset),
});

/** Canonical neighborhood definitions keyed by kind. */
export const NEIGHBORHOODS = {
  edge4: toNeighborhood(Edge4, edge4Offsets),
  corner4: toNeighborhood(Corner4, corner4Offsets),
  around8: toNeighborhood(Around8, around8Offsets),
} as const;

/** Build a custom neighborhood from explicit neighbor offsets (bit index follows array order). */
export const customNeighborhood = (offsets: ReadonlyArray<CellOffset>): Neighborhood =>
  toNeighborhood(
    CustomNeighborhood,
    offsets.map((offset, bit) => ({ offset, bit })),
  );
