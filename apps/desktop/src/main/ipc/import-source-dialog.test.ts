// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  importSourceDialogFilters,
  TILED_MAP_SOURCE_EXTENSIONS,
  TILED_TILESET_SOURCE_EXTENSIONS,
} from './import-source-dialog.js';

describe('importSourceDialogFilters', () => {
  it('keeps standalone Tiled tilesets selectable in the native import picker', () => {
    expect(importSourceDialogFilters[0]).toEqual({
      name: 'Tiled source files',
      extensions: ['tmx', 'tmj', 'json', 'tsx', 'tsj'],
    });
    expect(importSourceDialogFilters).toContainEqual({
      name: 'Tiled tilesets',
      extensions: [...TILED_TILESET_SOURCE_EXTENSIONS],
    });
    expect(TILED_MAP_SOURCE_EXTENSIONS).toEqual(['tmx', 'tmj', 'json']);
  });
});
