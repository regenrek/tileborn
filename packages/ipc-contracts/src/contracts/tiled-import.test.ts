import { makeMapId, makePackId, makeProjectId } from '@tileborne/core';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  TiledImportApplyContract,
  TiledImportCancelContract,
  TiledImportContracts,
  TiledImportPlanContract,
  TiledImportScanContract,
} from './tiled-import.ts';

const UUID = '550e8400-e29b-41d4-a716-446655440000';
const projectId = makeProjectId(UUID);
const mapId = makeMapId(UUID);
const packId = makePackId(UUID);

const scan = {
  sourceKind: 'map',
  sourcePath: '/project/maps/test.tmj',
  maps: [{ path: '/project/maps/test.tmj', width: 10, height: 8, tileWidth: 16, tileHeight: 16 }],
  tilesets: [],
  imageAssets: [],
  objectLayers: [],
  placeableCandidates: [],
  categories: [],
  inventory: {
    mapCount: 1,
    tilesetCount: 0,
    gridAtlasCount: 0,
    imageCollectionCount: 0,
    wangSetCount: 0,
    terrainClassCount: 0,
    animationCount: 0,
    collisionObjectCount: 0,
    objectLayerCount: 0,
    placeableCandidateCount: 0,
    unsupportedFeatureCount: 0,
  },
  confidence: 1,
  featureFlags: {
    gridAtlas: false,
    imageCollection: false,
    wangSets: false,
    animations: false,
    collisionObjectgroups: false,
    templates: false,
    rotation: false,
    parallax: false,
    infiniteChunks: false,
    unsupportedOrientation: false,
    classProperties: false,
    projectFiles: false,
    flipFlags: false,
  },
  unsupportedFeatures: [],
  ambiguousAtlasObjects: [],
  recommendedProfile: 'standard',
  sourceRoles: [
    {
      kind: 'paintable-tileset',
      evidence: 'grid-tileset',
      confidence: 1,
      count: 1,
      tilesetName: 'terrain',
      browseTarget: 'tilesets',
      reviewRequired: false,
      rationale: 'Grid tilesets are paintable Tileborne tilesets by default.',
    },
  ],
  importRecommendation: {
    sourceRoles: [
      {
        kind: 'paintable-tileset',
        evidence: 'grid-tileset',
        confidence: 1,
        count: 1,
        tilesetName: 'terrain',
        browseTarget: 'tilesets',
        reviewRequired: false,
        rationale: 'Grid tilesets are paintable Tileborne tilesets by default.',
      },
    ],
    recommendedProfile: 'standard',
    primaryAction: 'import-paintable-tilesets',
    browseTarget: 'tilesets',
    rationale:
      'The source is a grid tileset, so imported content should open as paintable Tilesets.',
    reviewRequired: false,
  },
} as const;

const inventoryPreview = { ...scan.inventory, imageAssetCount: 0 };

const plan = {
  schemaVersion: 1,
  sourcePath: scan.sourcePath,
  profile: 'standard',
  scan,
  importRecommendation: scan.importRecommendation,
  mappings: {
    tilesets: [],
    categories: [],
    placeables: [],
    maps: scan.maps,
  },
  suggestions: [],
  acceptedSuggestionIds: [],
  diagnostics: [],
} as const;

const appliedPlan = {
  schemaVersion: 1,
  sourcePath: scan.sourcePath,
  profile: 'standard',
  selectedMapPath: scan.maps[0].path,
  scan,
  importRecommendation: scan.importRecommendation,
  mappings: plan.mappings,
  acceptedSuggestions: [],
  diagnostics: [],
} as const;

const report = {
  importRecordId: `import:${UUID}`,
  sourceIdentity: {
    kind: 'tiled-map',
    path: scan.sourcePath,
    detectedAt: '2026-05-26T00:00:00.000Z',
    fingerprint: {
      realPath: scan.sourcePath,
      size: 128,
      mtimeMs: 1,
      isDirectory: false,
    },
  },
  diagnostics: [],
  appliedPlan,
  outputs: {
    kind: 'map',
    mapId,
    packId,
    layerCount: 1,
    objectCount: 0,
  },
} as const;

const roundTrip = <A, I>(schema: Schema.Top, value: I) => {
  const codec = schema as Schema.Codec<A, I, never, never>;
  const decoded = Schema.decodeUnknownSync(codec)(value);
  expect(Schema.encodeSync(codec)(decoded)).toEqual(value);
};

describe('tiled import IPC contracts', () => {
  it('registers scan, plan, apply, and cancel contracts', () => {
    expect(TiledImportContracts).toEqual([
      TiledImportScanContract,
      TiledImportPlanContract,
      TiledImportApplyContract,
      TiledImportCancelContract,
    ]);
  });

  it('accepts only the strict profile union', () => {
    for (const profile of [
      'standard',
      'standard-plus-hints',
      'assistive-infer',
      { kind: 'plugin', id: 'rpg-maker' },
    ] as const) {
      roundTrip(TiledImportPlanContract.request, {
        projectId,
        sourcePath: '/project/maps/test.tmj',
        profile,
      });
    }

    for (const profile of ['plugin:rpg-maker', 'random', { kind: 'plugin', id: 'bad path' }]) {
      expect(() =>
        Schema.decodeUnknownSync(TiledImportPlanContract.request)({
          projectId,
          sourcePath: '/project/maps/test.tmj',
          profile,
        }),
      ).toThrow();
    }
  });

  it('validates apply license and rejects NUL paths', () => {
    roundTrip(TiledImportApplyContract.request, {
      projectId,
      sourcePath: '/project/maps/test.tmj',
      profile: 'standard',
      license: { redistributable: false },
    });
    roundTrip(TiledImportApplyContract.response, {
      kind: 'map',
      mapId,
      layerCount: 1,
      objectCount: 0,
      packId,
      report,
    });
    roundTrip(TiledImportApplyContract.response, {
      kind: 'asset-pack',
      packId,
      report: { ...report, outputs: { kind: 'asset-pack', packId } },
    });

    expect(() =>
      Schema.decodeUnknownSync(TiledImportScanContract.request)({
        projectId,
        sourcePath: 'bad\0path',
      }),
    ).toThrow();
  });

  it('round-trips typed scan and plan responses', () => {
    roundTrip(TiledImportScanContract.response, {
      sourceKind: 'tiled-map',
      scan,
      diagnostics: [],
      inventoryPreview,
    });
    roundTrip(TiledImportPlanContract.response, {
      sourceKind: 'tiled-map',
      plan,
      diagnostics: [],
      inventoryPreview,
    });

    const unsupportedScan = {
      ...scan,
      inventory: { ...scan.inventory, unsupportedFeatureCount: 1 },
      featureFlags: { ...scan.featureFlags, classProperties: true },
      unsupportedFeatures: [
        {
          feature: 'class-properties',
          path: '/properties/0',
          message:
            'Tiled class-typed custom properties require Tiled project class definitions and are not imported.',
          action:
            'Flatten class properties to primitive string, number, or boolean properties before importing.',
        },
      ],
    } as const;
    roundTrip(TiledImportScanContract.response, {
      sourceKind: 'tiled-map',
      scan: unsupportedScan,
      diagnostics: [
        {
          _tag: 'TiledUnsupportedFeature',
          severity: 'error',
          path: '/properties/0',
          message:
            'Tiled class-typed custom properties require Tiled project class definitions and are not imported.',
          feature: 'class-properties',
          action:
            'Flatten class properties to primitive string, number, or boolean properties before importing.',
        },
      ],
      inventoryPreview: { ...inventoryPreview, unsupportedFeatureCount: 1 },
    });
  });
});
