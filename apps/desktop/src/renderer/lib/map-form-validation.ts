export interface MapDimensionFieldErrors {
  readonly width?: string;
  readonly height?: string;
  readonly seed?: string;
}

export function validateMapDimensions(input: {
  readonly width: string;
  readonly height: string;
  readonly seed?: string;
}): MapDimensionFieldErrors {
  const errors: {
    width?: string;
    height?: string;
    seed?: string;
  } = {};
  const parsedWidth = Number(input.width);
  const parsedHeight = Number(input.height);

  if (!Number.isInteger(parsedWidth) || parsedWidth <= 0) {
    errors.width = 'Width must be a positive integer.';
  }
  if (!Number.isInteger(parsedHeight) || parsedHeight <= 0) {
    errors.height = 'Height must be a positive integer.';
  }
  if (input.seed !== undefined) {
    const parsedSeed = Number(input.seed);
    if (!Number.isInteger(parsedSeed)) {
      errors.seed = 'Seed must be an integer.';
    }
  }
  return errors;
}

export function hasMapDimensionErrors(errors: MapDimensionFieldErrors): boolean {
  return errors.width !== undefined || errors.height !== undefined || errors.seed !== undefined;
}
