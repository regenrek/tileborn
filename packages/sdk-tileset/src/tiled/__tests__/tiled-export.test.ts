import { describe, expect, it } from 'vitest';

import { decodeTiledGid, encodeTiledGid, tiledGidForTileborneTileIndex } from '../gid.js';
import { buildTilesetWindows } from '../compile-map.js';
import {
  exportTiledMapToTmj,
  metadataToTiledProperties,
  type TmjExportTileset,
} from '../export-tmj.js';
import { parseTmjSync } from '../tmj-parse.js';
import type { TiledJsonMap, TiledJsonTileLayer, TiledMapImport } from '../types.js';

const PROJECT_ROOT = '/project';
const PACK_SEED = 'test-pack';
const FLIPPED_H = (0x80000000 + 1) >>> 0;
const FLIPPED_V = (0x40000000 + 1) >>> 0;
const FLIPPED_D = (0x20000000 + 1) >>> 0;

const inlineTileset = {
  name: 'terrain',
  tilewidth: 16,
  tileheight: 16,
  tilecount: 4,
  columns: 2,
  margin: 0,
  spacing: 0,
  imagewidth: 32,
  imageheight: 32,
  image: 'terrain.png',
};

const importOptions = (sourcePath: string) => ({
  packIdSeed: PACK_SEED,
  projectRoot: PROJECT_ROOT,
  sourcePath,
});

const tilesetsFromRaw = (raw: string): readonly TmjExportTileset[] =>
  (JSON.parse(raw) as TiledJsonMap).tilesets.map((ref) => ref as unknown as TmjExportTileset);

const parse = (raw: string, sourcePath: string) => {
  const result = parseTmjSync(raw, importOptions(sourcePath));
  if (!result.value)
    throw new Error(`fixture failed to import: ${JSON.stringify(result.diagnostics)}`);
  return result.value;
};

const tileLayer = (tmj: TiledJsonMap, name: string): TiledJsonTileLayer => {
  const layer = tmj.layers.find((entry) => entry.type === 'tilelayer' && entry.name === name);
  if (!layer || layer.type !== 'tilelayer') throw new Error(`missing tile layer ${name}`);
  return layer;
};

describe('tiled export gid inverse helpers', () => {
  it('encodeTiledGid is the exact inverse of decodeTiledGid for flip flags', () => {
    for (const raw of [0, 1, 42, FLIPPED_H, FLIPPED_V, FLIPPED_D, (0xe0000000 | 7) >>> 0]) {
      expect(encodeTiledGid(decodeTiledGid(raw))).toBe(raw);
    }
  });

  it('tiledGidForTileborneTileIndex inverts tile-index allocation across windows', () => {
    const windows = buildTilesetWindows([
      { firstgid: 1, tilecount: 4, tileborneTileCount: 4, name: 'a' },
      { firstgid: 100, tilecount: 2, tileborneTileCount: 2, name: 'b' },
    ]);
    expect(tiledGidForTileborneTileIndex(0, windows)).toBe(0);
    expect(tiledGidForTileborneTileIndex(1, windows)).toBe(1);
    expect(tiledGidForTileborneTileIndex(4, windows)).toBe(4);
    expect(tiledGidForTileborneTileIndex(5, windows)).toBe(100);
    expect(tiledGidForTileborneTileIndex(6, windows)).toBe(101);
    expect(tiledGidForTileborneTileIndex(7, windows)).toBe(0);
  });
});

describe('metadataToTiledProperties', () => {
  it('infers Tiled property types from primitive carriers and sorts keys', () => {
    expect(metadataToTiledProperties({ flag: true, ratio: 0.5, count: 3, label: 'hi' })).toEqual([
      { name: 'count', type: 'int', value: 3 },
      { name: 'flag', type: 'bool', value: true },
      { name: 'label', type: 'string', value: 'hi' },
      { name: 'ratio', type: 'float', value: 0.5 },
    ]);
  });
});

describe('tiled TMJ export round-trip', () => {
  const basicTmj = JSON.stringify({
    type: 'map',
    version: '1.10',
    orientation: 'orthogonal',
    width: 2,
    height: 2,
    tilewidth: 16,
    tileheight: 16,
    tilesets: [{ firstgid: 1, ...inlineTileset }],
    layers: [{ type: 'tilelayer', name: 'ground', width: 2, height: 2, data: [3, 0, 0, 1] }],
  });

  it('re-emits tile-layer gids and empty tiles structurally', () => {
    const imported = parse(basicTmj, `${PROJECT_ROOT}/maps/basic.tmj`);
    const { tmj, diagnostics } = exportTiledMapToTmj({
      map: imported.tiledMap,
      tilesets: tilesetsFromRaw(basicTmj),
    });

    expect(diagnostics).toEqual([]);
    expect(tmj.width).toBe(2);
    expect(tmj.height).toBe(2);
    expect(tmj.tilewidth).toBe(16);
    expect(tmj.orientation).toBe('orthogonal');
    expect(tmj.tilesets[0]).toMatchObject({ firstgid: 1, name: 'terrain' });
    expect(tileLayer(tmj, 'ground').data).toEqual([3, 0, 0, 1]);
  });

  it.each([
    ['horizontal', FLIPPED_H],
    ['vertical', FLIPPED_V],
    ['diagonal', FLIPPED_D],
  ])('preserves %s flip flags through export', (_label, rawGid) => {
    const raw = JSON.stringify({
      type: 'map',
      version: '1.10',
      orientation: 'orthogonal',
      width: 1,
      height: 1,
      tilewidth: 16,
      tileheight: 16,
      tilesets: [{ firstgid: 1, ...inlineTileset }],
      layers: [{ type: 'tilelayer', name: 'ground', width: 1, height: 1, data: [rawGid] }],
    });
    const imported = parse(raw, `${PROJECT_ROOT}/maps/flip.tmj`);
    const { tmj } = exportTiledMapToTmj({ map: imported.tiledMap, tilesets: tilesetsFromRaw(raw) });
    expect(tileLayer(tmj, 'ground').data).toEqual([rawGid]);
    expect(decodeTiledGid(tileLayer(tmj, 'ground').data[0]!).gid).toBe(1);
  });

  it('preserves multiple tilesets with gapped firstgids', () => {
    const raw = JSON.stringify({
      type: 'map',
      version: '1.10',
      orientation: 'orthogonal',
      width: 2,
      height: 1,
      tilewidth: 16,
      tileheight: 16,
      tilesets: [
        {
          firstgid: 1,
          name: 'a',
          tilewidth: 16,
          tileheight: 16,
          tilecount: 1,
          columns: 1,
          image: 'a.png',
          imagewidth: 16,
          imageheight: 16,
        },
        {
          firstgid: 100,
          name: 'b',
          tilewidth: 16,
          tileheight: 16,
          tilecount: 1,
          columns: 1,
          image: 'b.png',
          imagewidth: 16,
          imageheight: 16,
        },
      ],
      layers: [{ type: 'tilelayer', name: 'ground', width: 2, height: 1, data: [1, 100] }],
    });
    const imported = parse(raw, `${PROJECT_ROOT}/maps/multi.tmj`);
    const { tmj } = exportTiledMapToTmj({ map: imported.tiledMap, tilesets: tilesetsFromRaw(raw) });
    expect(tmj.tilesets.map((ref) => ref.firstgid)).toEqual([1, 100]);
    expect(tileLayer(tmj, 'ground').data).toEqual([1, 100]);
  });

  it('round-trips map/layer custom properties', () => {
    const raw = JSON.stringify({
      type: 'map',
      version: '1.10',
      orientation: 'orthogonal',
      width: 1,
      height: 1,
      tilewidth: 16,
      tileheight: 16,
      tilesets: [{ firstgid: 1, ...inlineTileset }],
      properties: [
        { name: 'author', type: 'string', value: 'me' },
        { name: 'rounds', type: 'int', value: 3 },
        { name: 'ratio', type: 'float', value: 0.25 },
        { name: 'ranked', type: 'bool', value: true },
      ],
      layers: [
        {
          type: 'tilelayer',
          name: 'ground',
          width: 1,
          height: 1,
          data: [1],
          properties: [{ name: 'collision', type: 'string', value: 'solid' }],
        },
      ],
    });
    const imported = parse(raw, `${PROJECT_ROOT}/maps/props.tmj`);
    const { tmj } = exportTiledMapToTmj({ map: imported.tiledMap, tilesets: tilesetsFromRaw(raw) });

    expect(tmj.properties).toEqual([
      { name: 'author', type: 'string', value: 'me' },
      { name: 'ranked', type: 'bool', value: true },
      { name: 'ratio', type: 'float', value: 0.25 },
      { name: 'rounds', type: 'int', value: 3 },
    ]);
    expect(tileLayer(tmj, 'ground').properties).toEqual([
      { name: 'collision', type: 'string', value: 'solid' },
    ]);
  });

  it('re-emits tile objects as bottom-left anchored gid objects', () => {
    const raw = JSON.stringify({
      type: 'map',
      version: '1.10',
      orientation: 'orthogonal',
      width: 2,
      height: 2,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [
        {
          firstgid: 1,
          name: 'objects',
          tilewidth: 32,
          tileheight: 32,
          tilecount: 1,
          columns: 0,
          tiles: [{ id: 0, type: 'statue', image: 'statue.png', imagewidth: 96, imageheight: 128 }],
        },
      ],
      layers: [
        {
          type: 'objectgroup',
          name: 'props',
          objects: [{ id: 1, gid: 1, x: 64, y: 160, width: 96, height: 128, type: 'statue' }],
        },
      ],
    });
    const imported = parse(raw, `${PROJECT_ROOT}/maps/objects.tmj`);
    const { tmj } = exportTiledMapToTmj({ map: imported.tiledMap, tilesets: tilesetsFromRaw(raw) });

    const group = tmj.layers.find((layer) => layer.type === 'objectgroup');
    expect(group?.type).toBe('objectgroup');
    if (group?.type === 'objectgroup') {
      expect(group.name).toBe('props');
      expect(group.objects).toEqual([
        { id: 1, x: 64, y: 160, gid: 1, width: 96, height: 128, type: 'statue', name: 'object-1' },
      ]);
    }
  });
});

describe('tiled TMJ semantic round-trip (import the export)', () => {
  const semanticFixtures: ReadonlyArray<readonly [string, string]> = [
    [
      'tile layer with flips, empty cells, properties, and wang tileset',
      JSON.stringify({
        type: 'map',
        version: '1.10',
        orientation: 'orthogonal',
        width: 2,
        height: 2,
        tilewidth: 16,
        tileheight: 16,
        tilesets: [
          {
            firstgid: 1,
            ...inlineTileset,
            tiles: [{ id: 1, properties: [{ name: 'terrain', type: 'string', value: 'grass' }] }],
            wangsets: [
              {
                name: 'ground',
                type: 'corner',
                colors: [{ name: 'grass', color: '#00ff00', tile: 0 }],
                wangtiles: [{ tileid: 1, wangid: [0, 1, 0, 1, 0, 1, 0, 1] }],
              },
            ],
          },
        ],
        properties: [{ name: 'author', type: 'string', value: 'tileborne' }],
        layers: [
          { type: 'tilelayer', name: 'ground', width: 2, height: 2, data: [FLIPPED_H, 0, 2, 1] },
        ],
      }),
    ],
    [
      'image-collection tile objects',
      JSON.stringify({
        type: 'map',
        version: '1.10',
        orientation: 'orthogonal',
        width: 2,
        height: 2,
        tilewidth: 32,
        tileheight: 32,
        tilesets: [
          {
            firstgid: 1,
            name: 'objects',
            tilewidth: 32,
            tileheight: 32,
            tilecount: 1,
            columns: 0,
            tiles: [
              { id: 0, type: 'statue', image: 'statue.png', imagewidth: 96, imageheight: 128 },
            ],
          },
        ],
        layers: [
          {
            type: 'objectgroup',
            name: 'props',
            objects: [{ id: 1, gid: 1, x: 64, y: 160, width: 96, height: 128, type: 'statue' }],
          },
        ],
      }),
    ],
  ];

  it.each(semanticFixtures)('import → export → import is stable for %s', (_label, raw) => {
    const sourcePath = `${PROJECT_ROOT}/maps/semantic.tmj`;
    const first = parse(raw, sourcePath);
    const { tmj } = exportTiledMapToTmj({
      map: first.tiledMap,
      tilesets: tilesetsFromRaw(raw),
      version: '1.10',
    });
    const second = parse(JSON.stringify(tmj), sourcePath);

    expect(second.map).toStrictEqual(first.map);
  });
});

describe('tiled TMJ export firstgid assignment', () => {
  it('assigns sequential firstgids when omitted', () => {
    const map: TiledMapImport = {
      width: 1,
      height: 1,
      tileWidth: 16,
      tileHeight: 16,
      orientation: 'orthogonal',
      layers: [],
      properties: {},
    };
    const tilesets: readonly TmjExportTileset[] = [
      { name: 'a', tilewidth: 16, tileheight: 16, tilecount: 4, columns: 2 },
      { name: 'b', tilewidth: 16, tileheight: 16, tilecount: 3, columns: 3 },
    ];
    const { tmj } = exportTiledMapToTmj({ map, tilesets });
    expect(tmj.tilesets.map((ref) => ref.firstgid)).toEqual([1, 5]);
  });
});
