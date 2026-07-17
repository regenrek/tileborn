export const REGEN_COMMAND = 'pnpm tsx scripts/regen-goldens.mts';

export const sortKeysDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .flatMap((key) => {
          const inner = record[key];
          if (inner === undefined) {
            return [];
          }
          return [[key, sortKeysDeep(inner)]];
        }),
    );
  }
  return value;
};

export const stableStringify = (value: unknown): string =>
  `${JSON.stringify(sortKeysDeep(value), null, 2)}\n`;

export const assertGoldenMatch = (label: string, actual: unknown, expected: unknown): void => {
  const actualNormalized = stableStringify(actual);
  const expectedNormalized = stableStringify(expected);
  if (actualNormalized !== expectedNormalized) {
    throw new Error(`golden mismatch for ${label}\n\nRegenerate goldens with: ${REGEN_COMMAND}`);
  }
};

export const uvKey = (uv: {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}): string => `${uv.x},${uv.y},${uv.w},${uv.h}`;
