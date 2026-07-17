import { Option, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  makeAssetId,
  makePackId,
  makePlaceableId,
  makeTileId,
  PackId,
  TileId,
  type Uuid,
} from '@tileborne/core';

import {
  Animation,
  AnimationFrame,
  AnimationId,
  AutotileRuleId,
  BitmaskCollisionMask,
  CellSize,
  CustomAutotileRule,
  Placeable,
  PlaceableFrameRef,
  PlaceableSize,
  PolygonCollisionMask,
  TerrainClass,
  TerrainTransition,
  Tile,
  Tileset,
  TilesetId,
  TilesetPack,
  TilesetPackAsset,
  TilesetPackLicense,
  TiledPlaceableSource,
  UVRect,
  VariantFilter,
  VariantFilterId,
  Wang2CornerAutotileRule,
} from '../schemas/index.js';

const uuid = (suffix: string): Uuid =>
  `62656465-0000-4000-8000-${suffix.padStart(12, '0')}` as Uuid;

const tileId = (suffix: string) => makeTileId(uuid(suffix));
const packId = (suffix: string) => makePackId(uuid(suffix));
const assetId = (suffix: string) => makeAssetId(uuid(suffix));

const decode = <A, I>(schema: Schema.Codec<A, I, never, never>, input: unknown): A =>
  Schema.decodeUnknownSync(schema)(input);

const encode = <A, I>(schema: Schema.Codec<A, I, never, never>, value: A): unknown =>
  Schema.encodeUnknownSync(schema)(value);

const decodeTilesetId = (value: string) => decode(TilesetId, value);
const decodeAutotileRuleId = (value: string) => decode(AutotileRuleId, value);
const decodeVariantFilterId = (value: string) => decode(VariantFilterId, value);
const decodeAnimationId = (value: string) => decode(AnimationId, value);
const decodeTerrainClass = (value: string) => decode(TerrainClass, value);

const sampleUv = new UVRect({ x: 0, y: 0, w: 32, h: 32 });

const sampleAnimation = new Animation({
  id: decodeAnimationId('animation:62656465-0000-4000-8000-000000000006'),
  frames: [new AnimationFrame({ tileId: tileId('1'), durationMs: 120 })],
  loop: true,
});

const sampleTile = new Tile({
  id: tileId('1'),
  uv: sampleUv,
  tags: ['grass'],
  terrainClass: Option.some(decodeTerrainClass('grass')),
  collisionMask: Option.some(new BitmaskCollisionMask({ passable: 0b1111, blocked: 0b0000 })),
  animation: Option.some(sampleAnimation),
});

const samplePlaceable = new Placeable({
  id: makePlaceableId(uuid('9')),
  name: 'Large Statue',
  size: new PlaceableSize({ width: 96, height: 128 }),
  frames: [
    new PlaceableFrameRef({
      assetId: assetId('9'),
      tileId: tileId('1'),
      uv: new UVRect({ x: 0, y: 0, w: 96, h: 128 }),
      durationMs: Option.none(),
    }),
  ],
  tags: ['tiled:type=statue'],
  placementMode: 'object',
  source: new TiledPlaceableSource({
    format: 'tiled',
    tilesetName: 'Objects',
    localTileId: 0,
    image: Option.some('statue.png'),
    imageWidth: Option.some(96),
    imageHeight: Option.some(128),
    objectType: Option.some('statue'),
    objectClass: Option.none(),
    properties: { category: 'decor' },
  }),
});

const sampleAutotileRule = new Wang2CornerAutotileRule({
  id: decodeAutotileRuleId('autotile-rule:62656465-0000-4000-8000-000000000004'),
  name: 'grass-corner',
  terrainClasses: [decodeTerrainClass('grass')],
  maskToTileIds: {
    '0001': [tileId('1')],
  },
  fallbackTileId: Option.none(),
});

const sampleVariantFilter = new VariantFilter({
  id: decodeVariantFilterId('variant-filter:62656465-0000-4000-8000-000000000005'),
  terrainClass: Option.some(decodeTerrainClass('grass')),
  tileIds: [tileId('1'), tileId('2')],
  weights: [1, 3],
  seedSalt: 'layer-0',
  stableAcrossAnimationFrames: true,
});

const sampleTileset = new Tileset({
  id: decodeTilesetId('tileset:62656465-0000-4000-8000-000000000003'),
  name: 'Meadow',
  atlasAssetId: assetId('7'),
  cellSize: new CellSize({ width: 32, height: 32 }),
  margin: 0,
  spacing: 0,
  tiles: [sampleTile],
  autotileRules: [sampleAutotileRule],
  variantFilters: [sampleVariantFilter],
  terrainTransitions: [
    new TerrainTransition({
      from: decodeTerrainClass('grass'),
      to: decodeTerrainClass('water'),
      ruleId: decodeAutotileRuleId('autotile-rule:62656465-0000-4000-8000-000000000004'),
    }),
  ],
});

const samplePack = new TilesetPack({
  schemaVersion: 1,
  id: packId('2'),
  name: 'Meadow Pack',
  version: '1.0.0',
  license: new TilesetPackLicense({
    spdxId: 'CC0-1.0',
    attribution: Option.none(),
    sourceUrl: Option.none(),
    notes: Option.none(),
    redistributable: true,
  }),
  tilesets: [sampleTileset],
  placeables: [samplePlaceable],
  assets: [
    new TilesetPackAsset({
      id: assetId('7'),
      path: 'atlases/meadow.png',
      mime: 'image/png',
    }),
  ],
});

const roundtripCases = [
  ['UVRect', UVRect, sampleUv],
  ['AnimationFrame', AnimationFrame, sampleAnimation.frames[0]],
  ['Animation', Animation, sampleAnimation],
  [
    'BitmaskCollisionMask',
    BitmaskCollisionMask,
    new BitmaskCollisionMask({ passable: 1, blocked: 2 }),
  ],
  ['PlaceableFrameRef', PlaceableFrameRef, samplePlaceable.frames[0]],
  ['TiledPlaceableSource', TiledPlaceableSource, samplePlaceable.source],
  ['Placeable', Placeable, samplePlaceable],
  [
    'PolygonCollisionMask',
    PolygonCollisionMask,
    new PolygonCollisionMask({
      edges: [{ x1: 0, y1: 0, x2: 32, y2: 0 }],
      passable: false,
      blocksMovement: true,
      blocksProjectiles: false,
    }),
  ],
  ['Tile', Tile, sampleTile],
  ['VariantFilter', VariantFilter, sampleVariantFilter],
  ['Wang2CornerAutotileRule', Wang2CornerAutotileRule, sampleAutotileRule],
  [
    'CustomAutotileRule',
    CustomAutotileRule,
    new CustomAutotileRule({
      id: decodeAutotileRuleId('autotile-rule:62656465-0000-4000-8000-000000000008'),
      name: 'custom-rule',
      terrainClasses: [decodeTerrainClass('grass')],
      maskToTileIds: { '1010': [tileId('1')] },
      fallbackTileId: Option.none(),
      source: { kind: 'tiled' },
    }),
  ],
  ['TerrainTransition', TerrainTransition, sampleTileset.terrainTransitions[0]],
  ['CellSize', CellSize, sampleTileset.cellSize],
  ['Tileset', Tileset, sampleTileset],
  ['TilesetPackAsset', TilesetPackAsset, samplePack.assets[0]],
  ['TilesetPackLicense', TilesetPackLicense, samplePack.license],
  ['TilesetPack', TilesetPack, samplePack],
] as const;

describe('sdk-tileset schema roundtrip', () => {
  for (const [name, schema, value] of roundtripCases) {
    it(`round-trips ${name}`, () => {
      const encoded = encode(schema, value);
      const decoded = decode(schema, encoded);
      expect(decoded).toEqual(value);
    });
  }

  it('rejects raw strings for branded TileId', () => {
    expect(() => decode(TileId, 'not-a-branded-id')).toThrow();
  });

  it('rejects raw strings for branded PackId', () => {
    expect(() => decode(PackId, 'pack-without-uuid')).toThrow();
  });

  it('rejects raw strings for branded TilesetId', () => {
    expect(() => decodeTilesetId('tileset-without-uuid')).toThrow();
  });

  it('rejects raw strings for branded AutotileRuleId', () => {
    expect(() => decodeAutotileRuleId('autotile-rule-without-uuid')).toThrow();
  });

  it('rejects raw strings for branded VariantFilterId', () => {
    expect(() => decodeVariantFilterId('variant-filter-without-uuid')).toThrow();
  });

  it('rejects raw strings for branded AnimationId', () => {
    expect(() => decodeAnimationId('animation-without-uuid')).toThrow();
  });
});
