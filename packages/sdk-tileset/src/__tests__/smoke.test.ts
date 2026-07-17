import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { formatDiagnostic } from '@tileborne/sdk-tileset/diagnostics';
import { TilesetPack } from '@tileborne/sdk-tileset/schemas';
import { TilesetPack as TilesetPackFromRoot } from '@tileborne/sdk-tileset';

describe('sdk-tileset public entry smoke', () => {
  it('exports TilesetPack schema from root and ./schemas', () => {
    expect(TilesetPack.name).toBe('TilesetPack');
    expect(TilesetPackFromRoot.name).toBe('TilesetPack');
    expect(Schema.isSchema(TilesetPack)).toBe(true);
    expect(Schema.isSchema(TilesetPackFromRoot)).toBe(true);
  });

  it('exports diagnostics helpers from ./diagnostics', () => {
    expect(
      formatDiagnostic({
        _tag: 'MissingAtlas',
        path: 'pack.assets[0]',
        message: 'Atlas asset is missing',
        severity: 'error',
        atlasAssetId: 'asset-1',
      }),
    ).toBe('[error] pack.assets[0]: Atlas asset is missing');
  });
});
