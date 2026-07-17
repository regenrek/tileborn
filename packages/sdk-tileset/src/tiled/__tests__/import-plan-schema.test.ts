import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { ParseDiagnosticSchema } from '../import-plan-schema.js';

describe('canonical Tiled import runtime schemas', () => {
  it('round-trips required tagged diagnostic payload fields', () => {
    const diagnostic = {
      _tag: 'InvalidAtlasGrid',
      severity: 'error',
      path: 'terrain.png',
      message: 'invalid atlas grid',
      imageWidth: 31,
      imageHeight: 32,
      cellWidth: 16,
      cellHeight: 16,
      margin: 0,
      spacing: 0,
      columns: 1,
      rows: 2,
    } as const;

    expect(Schema.decodeUnknownSync(ParseDiagnosticSchema)(diagnostic)).toEqual(diagnostic);
  });

  it('rejects a known diagnostic tag when its variant payload is incomplete', () => {
    expect(() =>
      Schema.decodeUnknownSync(ParseDiagnosticSchema)({
        _tag: 'MissingAtlas',
        severity: 'error',
        path: 'terrain.tsx',
        message: 'atlas missing',
      }),
    ).toThrow();
  });

  it('rejects unknown diagnostic tags', () => {
    expect(() =>
      Schema.decodeUnknownSync(ParseDiagnosticSchema)({
        _tag: 'FutureDiagnostic',
        severity: 'warning',
        path: 'future.json',
        message: 'unsupported future diagnostic',
      }),
    ).toThrow();
  });
});
