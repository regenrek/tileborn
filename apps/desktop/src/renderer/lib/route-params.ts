const MAX_DECODE_PASSES = 8;

export const normalizeRouteParam = (value: string): string => {
  let current = value;

  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    if (!current.includes('%')) {
      return current;
    }

    try {
      const next = decodeURIComponent(current);
      if (next === current) {
        return current;
      }
      current = next;
    } catch {
      return current;
    }
  }

  return current;
};

export const normalizeOptionalRouteParam = (value: string | undefined): string | undefined =>
  value === undefined ? undefined : normalizeRouteParam(value);
