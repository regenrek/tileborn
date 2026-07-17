import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  hashJsonStable,
  makePackId,
  makeProjectId,
  makeTileId,
  makeWorkingPaletteId,
} from '@tileborne/core';

import {
  AssetLibraryGetPackCacheStatusResponse,
  AssetLibraryGetPackLibraryRequest,
  AssetLibraryGetPackLibraryResponse,
  AssetLibraryGetPackUseSitesResponse,
  AssetLibraryReloadPackCacheRequest,
} from './asset-library.js';
import { WorkingPalettesAddItemsRequest } from './working-palettes.js';

const packId = makePackId('550e8400-e29b-41d4-a716-446655440001');
const tileId = makeTileId('550e8400-e29b-41d4-a716-446655440002');
const paletteId = makeWorkingPaletteId('550e8400-e29b-41d4-a716-446655440003');
const integrityHash = hashJsonStable({ packId });
const projectId = makeProjectId('550e8400-e29b-41d4-a716-446655440004');

describe('asset library IPC contracts', () => {
  it('validates pack library query inputs', () => {
    const decoded = Schema.decodeUnknownSync(AssetLibraryGetPackLibraryRequest)({
      packId,
      query: 'grass',
      groupKind: 'terrain',
      offset: 10,
      limit: 25,
    });

    expect(decoded).toEqual({
      packId,
      query: 'grass',
      groupKind: 'terrain',
      offset: 10,
      limit: 25,
    });
  });

  it('rejects unknown library group kinds', () => {
    expect(() =>
      Schema.decodeUnknownSync(AssetLibraryGetPackLibraryRequest)({
        packId,
        groupKind: 'everything',
      }),
    ).toThrow();
  });

  it('validates integrity-aware paginated library responses', () => {
    const decoded = Schema.decodeUnknownSync(AssetLibraryGetPackLibraryResponse)({
      packId,
      integrityHash,
      indexSchemaVersion: 1,
      previewRefLimit: 8,
      total: 0,
      offset: 0,
      limit: 25,
      groups: [],
    });

    expect(decoded.integrityHash).toBe(integrityHash);
    expect(decoded.previewRefLimit).toBe(8);
  });

  it('validates index metadata cache status and rebuild contracts', () => {
    const rebuild = Schema.decodeUnknownSync(AssetLibraryReloadPackCacheRequest)({ packId });
    const status = Schema.decodeUnknownSync(AssetLibraryGetPackCacheStatusResponse)({
      status: {
        packId,
        integrityHash,
        indexSchemaVersion: 1,
        state: 'cached',
        cacheKind: 'index-metadata',
        groupCount: 3,
        previewRefCount: 12,
        thumbnailSheetCount: 0,
        thumbnailSheetsAvailable: false,
        updatedAt: '2026-05-25T16:40:00.000Z',
      },
    });

    expect(rebuild.packId).toBe(packId);
    expect(status.status.cacheKind).toBe('index-metadata');
    expect(status.status.thumbnailSheetsAvailable).toBe(false);
  });

  it('validates bounded use sites with actionable navigation', () => {
    const decoded = Schema.decodeUnknownSync(AssetLibraryGetPackUseSitesResponse)({
      projectId,
      packId,
      useSites: [
        {
          id: 'player-model:model:test',
          kind: 'player-model',
          label: 'Hero',
          detail: 'Player model uses placeable:test',
          navigation: { kind: 'player-model', projectId, modelId: 'model:test' },
        },
      ],
      total: 1,
      scannedMapCount: 2,
      truncated: false,
    });

    expect(decoded.useSites[0]?.navigation.kind).toBe('player-model');
    expect(decoded.scannedMapCount).toBe(2);
  });

  it('validates working-palette item references', () => {
    const decoded = Schema.decodeUnknownSync(WorkingPalettesAddItemsRequest)({
      paletteId,
      items: [
        {
          ref: {
            packId,
            kind: 'tile',
            refId: tileId,
            tileId,
          },
          label: 'Grass',
        },
      ],
    });

    expect(decoded.items[0]?.ref.kind).toBe('tile');
  });

  it('rejects unchecked working-palette reference kinds', () => {
    expect(() =>
      Schema.decodeUnknownSync(WorkingPalettesAddItemsRequest)({
        paletteId,
        items: [
          {
            ref: {
              packId,
              kind: 'tileset',
              refId: 'tileset:550e8400-e29b-41d4-a716-446655440004',
            },
          },
        ],
      }),
    ).toThrow();
  });
});
