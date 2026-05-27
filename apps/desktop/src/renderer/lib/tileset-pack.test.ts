import { describe, expect, it } from 'vitest';

import { parseTilesetPackJson } from './tileset-pack';

describe('parseTilesetPackJson', () => {
  it('loads installed manifests with legacy object placeables', () => {
    const pack = parseTilesetPackJson({
      schemaVersion: 1,
      id: 'pack:550e8400-e29b-41d4-a716-446655440000',
      name: 'Legacy Installed Pack',
      version: '1.0.0',
      license: { spdxId: 'MIT' },
      assets: [
        {
          id: 'asset:550e8400-e29b-41d4-a716-446655440001',
          path: 'terrain.png',
          mime: 'image/png',
          size: 8,
          hash: 'sha256:fixture',
          license: { spdxId: 'MIT' },
        },
      ],
      terrainClasses: [],
      tilesets: [
        {
          id: 'tileset:550e8400-e29b-41d4-a716-446655440002',
          name: 'Terrain',
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
          tags: [],
        },
      ],
      autotileRules: [],
      variantFilters: [],
      animations: [],
      terrainTransitions: [],
      collisionMasks: [],
      placeables: [
        {
          id: 'placeable:550e8400-e29b-41d4-a716-446655440004',
          name: 'Legacy Object',
          size: { width: 16, height: 16 },
          frames: [
            {
              assetId: 'asset:550e8400-e29b-41d4-a716-446655440001',
              tileId: 'tile:550e8400-e29b-41d4-a716-446655440003',
              uv: { x: 0, y: 0, w: 16, h: 16 },
            },
          ],
          tags: [],
          source: {
            format: 'tiled',
            tilesetName: 'Objects',
            localTileId: 0,
            properties: {},
          },
        },
      ],
    });

    expect(pack.tilesets[0]?.tiles).toHaveLength(1);
    expect(pack.placeables?.[0]?.placementMode).toBe('object');
  });
});
