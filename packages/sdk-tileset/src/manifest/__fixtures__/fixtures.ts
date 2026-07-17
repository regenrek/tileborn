export const meadowPack = {
  schemaVersion: 1,
  id: 'pack:62656465-0000-4000-8000-000000000002',
  name: 'Meadow Pack',
  version: '1.0.0',
  license: {
    spdxId: 'CC0-1.0',
  },
  assets: [
    {
      id: 'asset:62656465-0000-4000-8000-000000000007',
      path: 'atlases/meadow.png',
      mime: 'image/png',
    },
  ],
  provenance: {
    sourcePath: 'fixtures/meadow/manifest.json',
    originTool: 'tileborne-fixture',
    importedAt: '2026-05-23T07:00:00.000Z',
  },
  terrainClasses: ['grass', 'water'],
  tilesets: [
    {
      id: 'tileset:62656465-0000-4000-8000-000000000003',
      name: 'Meadow',
      atlasAssetId: 'asset:62656465-0000-4000-8000-000000000007',
      cellSize: { width: 32, height: 32 },
      margin: 0,
      spacing: 0,
    },
  ],
  tiles: [
    {
      id: 'tile:62656465-0000-4000-8000-000000000001',
      tilesetId: 'tileset:62656465-0000-4000-8000-000000000003',
      uv: { x: 0, y: 0, w: 32, h: 32 },
      tags: ['grass'],
      terrainClass: 'grass',
      animationId: 'animation:62656465-0000-4000-8000-000000000006',
    },
    {
      id: 'tile:62656465-0000-4000-8000-000000000002',
      tilesetId: 'tileset:62656465-0000-4000-8000-000000000003',
      uv: { x: 32, y: 0, w: 32, h: 32 },
      tags: ['grass'],
      terrainClass: 'grass',
    },
  ],
  animations: [
    {
      id: 'animation:62656465-0000-4000-8000-000000000006',
      frames: [
        {
          tileId: 'tile:62656465-0000-4000-8000-000000000001',
          durationMs: 120,
        },
      ],
      loop: true,
    },
  ],
  collisionMasks: [
    {
      tileId: 'tile:62656465-0000-4000-8000-000000000001',
      mask: {
        _tag: 'bitmask',
        passable: 15,
        blocked: 0,
      },
    },
  ],
  autotileRules: [
    {
      _tag: 'wang2corner',
      tilesetId: 'tileset:62656465-0000-4000-8000-000000000003',
      id: 'autotile-rule:62656465-0000-4000-8000-000000000004',
      name: 'grass-corner',
      terrainClasses: ['grass'],
      maskToTileIds: {
        '0001': ['tile:62656465-0000-4000-8000-000000000001'],
      },
    },
  ],
  variantFilters: [
    {
      id: 'variant-filter:62656465-0000-4000-8000-000000000005',
      tilesetId: 'tileset:62656465-0000-4000-8000-000000000003',
      terrainClass: 'grass',
      tileIds: [
        'tile:62656465-0000-4000-8000-000000000001',
        'tile:62656465-0000-4000-8000-000000000002',
      ],
      weights: [1, 3],
      seedSalt: 'layer-0',
      stableAcrossAnimationFrames: true,
    },
  ],
  terrainTransitions: [
    {
      tilesetId: 'tileset:62656465-0000-4000-8000-000000000003',
      from: 'grass',
      to: 'water',
      ruleId: 'autotile-rule:62656465-0000-4000-8000-000000000004',
    },
  ],
} as const;

export const customAutotilePack = {
  schemaVersion: 1,
  id: 'pack:62656465-0000-4000-8000-000000000010',
  name: 'Custom Rule Pack',
  version: '1.0.0',
  license: {
    spdxId: 'CC0-1.0',
  },
  assets: [
    {
      id: 'asset:62656465-0000-4000-8000-000000000011',
      path: 'atlases/custom.png',
      mime: 'image/png',
    },
  ],
  terrainClasses: ['grass'],
  tilesets: [
    {
      id: 'tileset:62656465-0000-4000-8000-000000000012',
      name: 'Custom',
      atlasAssetId: 'asset:62656465-0000-4000-8000-000000000011',
      cellSize: { width: 32, height: 32 },
      margin: 0,
      spacing: 0,
    },
  ],
  tiles: [
    {
      id: 'tile:62656465-0000-4000-8000-000000000013',
      tilesetId: 'tileset:62656465-0000-4000-8000-000000000012',
      uv: { x: 0, y: 0, w: 32, h: 32 },
      tags: ['grass'],
      terrainClass: 'grass',
    },
  ],
  animations: [],
  collisionMasks: [],
  autotileRules: [
    {
      _tag: 'custom',
      tilesetId: 'tileset:62656465-0000-4000-8000-000000000012',
      id: 'autotile-rule:62656465-0000-4000-8000-000000000008',
      name: 'custom-rule',
      terrainClasses: ['grass'],
      maskToTileIds: {
        '1010': ['tile:62656465-0000-4000-8000-000000000013'],
      },
      source: {
        kind: 'tiled',
        ruleMap: 'Rules/wall-1-rule1.tmx',
      },
    },
  ],
  variantFilters: [],
  terrainTransitions: [],
} as const;
