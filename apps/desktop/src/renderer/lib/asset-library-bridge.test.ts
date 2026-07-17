import { describe, expect, it } from 'vitest';
import { AssetLibraryGroup, AssetLibraryReference, makePackId, makeTileId } from '@tileborne/core';

import { parseTilesetPackJson } from '@/lib/tileset-pack';
import {
  buildLibraryPreviewIndex,
  humanizeIdentifier,
  libraryGroupPreviews,
  libraryGroupToPaletteDrafts,
} from '@/lib/asset-library-bridge';

const samplePackJson = {
  schemaVersion: 1 as const,
  id: 'pack:550e8400-e29b-41d4-a716-446655440000',
  name: 'Sample',
  version: '1.0.0',
  license: { spdxId: 'MIT' },
  assets: [
    {
      id: 'asset:550e8400-e29b-41d4-a716-446655440001',
      path: 'atlas.png',
      mime: 'image/png',
      size: 8,
      hash: 'sha256:fixture',
      license: { spdxId: 'MIT' },
    },
  ],
  terrainClasses: ['tiled-source:grass terrain'],
  tilesets: [
    {
      id: 'tileset:550e8400-e29b-41d4-a716-446655440002',
      name: 'tiled-source:source=foo/Sample Walls.tmx',
      atlasAssetId: 'asset:550e8400-e29b-41d4-a716-446655440001',
      cellSize: { width: 16, height: 16 },
      margin: 0,
      spacing: 0,
    },
  ],
  tiles: [
    {
      id: 'tile:550e8400-e29b-41d4-a716-446655440003',
      tilesetId: 'tileset:550e8400-e29b-41d4-a716-446655440002',
      uv: { x: 0, y: 0, w: 16, h: 16 },
      tags: ['walls'],
      terrainClass: 'tiled-source:grass terrain',
    },
    {
      id: 'tile:550e8400-e29b-41d4-a716-446655440004',
      tilesetId: 'tileset:550e8400-e29b-41d4-a716-446655440002',
      uv: { x: 16, y: 0, w: 16, h: 16 },
      tags: ['floor'],
    },
  ],
  autotileRules: [],
  variantFilters: [],
  animations: [],
  terrainTransitions: [],
  collisionMasks: [],
  placeables: [
    {
      id: 'placeable:550e8400-e29b-41d4-a716-446655440005',
      name: 'Pillar',
      size: { width: 16, height: 16 },
      frames: [
        {
          assetId: 'asset:550e8400-e29b-41d4-a716-446655440001',
          tileId: 'tile:550e8400-e29b-41d4-a716-446655440003',
          uv: { x: 0, y: 0, w: 16, h: 16 },
        },
      ],
      tags: ['structures'],
      source: {
        format: 'tiled',
        tilesetName: 'Objects',
        localTileId: 0,
        properties: {},
      },
    },
  ],
};

describe('asset-library-bridge', () => {
  it('humanises namespaced source identifiers to compact labels', () => {
    expect(humanizeIdentifier('tiled-source:source=foo/Sample Walls.tmx')).toBe('Sample Walls');
    expect(humanizeIdentifier('tiled-source:grass terrain', { dropTerrainSuffix: true })).toBe(
      'Grass',
    );
    expect(humanizeIdentifier('tiled-source:water_drowning')).toBe('Water Drowning');
  });

  it('builds preview refs for backend library references without deriving groups', () => {
    const pack = parseTilesetPackJson(samplePackJson);
    const index = buildLibraryPreviewIndex(pack);
    const tileRef = new AssetLibraryReference({
      packId: makePackId('550e8400-e29b-41d4-a716-446655440000'),
      kind: 'tile',
      refId: 'tile:550e8400-e29b-41d4-a716-446655440003',
      tileId: makeTileId('550e8400-e29b-41d4-a716-446655440003'),
    });
    const preview = index.previewForRef(tileRef);
    expect(preview).toEqual({
      assetPath: 'atlas.png',
      x: 0,
      y: 0,
      width: 16,
      height: 16,
    });
  });

  it('converts backend groups to working palette drafts', () => {
    const packId = makePackId('550e8400-e29b-41d4-a716-446655440000');
    const tileRef = new AssetLibraryReference({
      packId,
      kind: 'tile',
      refId: 'tile:550e8400-e29b-41d4-a716-446655440003',
      tileId: makeTileId('550e8400-e29b-41d4-a716-446655440003'),
    });
    const group = new AssetLibraryGroup({
      id: 'tileset:sample',
      packId,
      kind: 'tileset',
      label: 'Sample tiles',
      count: 1,
      metadata: {},
      searchText: 'sample tiles',
      previewRefs: [tileRef],
    });
    const drafts = libraryGroupToPaletteDrafts(group);
    expect(drafts).toEqual([{ ref: tileRef, label: 'Sample tiles' }]);
    const pack = parseTilesetPackJson(samplePackJson);
    expect(libraryGroupPreviews(group, buildLibraryPreviewIndex(pack))).toHaveLength(1);
  });
});
