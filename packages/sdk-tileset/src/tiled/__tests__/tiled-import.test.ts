import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { decodeTiledGid } from '../gid.js';
import { decodeTileLayerDataAsync, decodeTileLayerDataSync } from '../tile-data.js';
import { resolveExternalPath } from '../external-resolve.js';
import { wangIdToMaskKey } from '../compile-wang.js';
import { parseTsj } from '../tsj-parse.js';
import { applyImportPlan, buildImportPlan, importTiled } from '../import.js';
import { parseTmj, parseTmjSync } from '../tmj-parse.js';
import { parseTmx } from '../tmx-parse.js';
import { scanTiledSource } from '../scan.js';
import { Wang2CornerAutotileRule } from '../../schemas/autotile-rule.js';
import type { TiledSourcePackImport, TiledTilesetPackImport } from '../types.js';

const PROJECT_ROOT = '/project';
const PACK_SEED = 'test-pack';
const FLIPPED_H = 0x80000000 + 1;
const FLIPPED_V = 0x40000000 + 1;
const FLIPPED_D = 0x20000000 + 1;
const COMPRESSED_GZIP_GIDS_1_2_3_4 = 'H4sIAAAAAAAAE2NkYGBgAmJmIGYBYgDv1AWvEAAAAA==';
const COMPRESSED_ZLIB_GIDS_1_2_3_4 = 'eJxjZGBgYAJiZiBmAWIAAGAACw==';

const tileLayerBase64 = (gids: readonly number[]): string => {
  const bytes = new Uint8Array(gids.length * 4);
  const view = new DataView(bytes.buffer);
  gids.forEach((gid, index) => view.setUint32(index * 4, gid, true));
  return Buffer.from(bytes).toString('base64');
};

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
  tiles: [
    {
      id: 1,
      probability: 0.25,
      animation: [
        { tileid: 2, duration: 100 },
        { tileid: 3, duration: 150 },
      ],
      properties: [{ name: 'terrain', type: 'string', value: 'grass' }],
    },
  ],
  wangsets: [
    {
      name: 'ground',
      type: 'corner',
      colors: [{ name: 'grass', color: '#00ff00', tile: 0 }],
      wangtiles: [{ tileid: 1, wangid: [0, 1, 0, 1, 0, 1, 0, 1] }],
    },
  ],
};

const basicTmj = JSON.stringify({
  type: 'map',
  version: '1.10',
  orientation: 'orthogonal',
  width: 2,
  height: 2,
  tilewidth: 16,
  tileheight: 16,
  tilesets: [{ firstgid: 1, ...inlineTileset }],
  layers: [
    {
      type: 'tilelayer',
      name: 'ground',
      width: 2,
      height: 2,
      encoding: 'csv',
      data: [3, 0, 0, 1],
    },
  ],
});

const basicTmx = `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.10" orientation="orthogonal" width="2" height="2" tilewidth="16" tileheight="16">
  <tileset firstgid="1" name="terrain" tilewidth="16" tileheight="16" tilecount="4" columns="2">
    <image source="terrain.png" width="32" height="32"/>
  </tileset>
  <layer id="1" name="ground" width="2" height="2">
    <data encoding="csv">3,0,0,1</data>
  </layer>
</map>`;

const externalTsx = `<?xml version="1.0" encoding="UTF-8"?>
<tileset name="external" tilewidth="16" tileheight="16" tilecount="1" columns="1">
  <image source="external.png" width="16" height="16"/>
</tileset>`;

const externalTmj = JSON.stringify({
  type: 'map',
  version: '1.10',
  orientation: 'orthogonal',
  width: 1,
  height: 1,
  tilewidth: 16,
  tileheight: 16,
  tilesets: [{ firstgid: 1, source: 'tilesets/external.tsx' }],
  layers: [{ type: 'tilelayer', name: 'ground', width: 1, height: 1, data: [1] }],
});

const largePlaceableTmj = JSON.stringify({
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
        {
          id: 0,
          type: 'statue',
          image: 'statue.png',
          imagewidth: 96,
          imageheight: 128,
        },
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
});

const hintedAtlasTmj = JSON.stringify({
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
      name: 'atlas',
      tilewidth: 32,
      tileheight: 32,
      tilecount: 4,
      columns: 2,
      image: 'atlas.png',
      imagewidth: 64,
      imageheight: 64,
      tiles: [
        {
          id: 0,
          type: 'tree',
          properties: [
            { name: 'tileborne.placeable', type: 'bool', value: true },
            { name: 'tileborne.paintable', type: 'bool', value: false },
            { name: 'tileborne.objectWidth', type: 'int', value: 64 },
            { name: 'tileborne.objectHeight', type: 'int', value: 64 },
            { name: 'tileborne.category', type: 'string', value: 'foliage' },
          ],
        },
      ],
    },
  ],
  layers: [
    {
      type: 'objectgroup',
      name: 'objects',
      objects: [{ id: 1, gid: 1, x: 32, y: 96, width: 64, height: 64, type: 'tree' }],
    },
  ],
});

const anchoredObjectsTmj = JSON.stringify({
  type: 'map',
  version: '1.10',
  orientation: 'orthogonal',
  width: 4,
  height: 4,
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
        {
          id: 0,
          type: 'tree',
          image: 'tree.png',
          imagewidth: 96,
          imageheight: 128,
        },
      ],
    },
  ],
  layers: [
    {
      type: 'objectgroup',
      name: 'props',
      objects: [
        {
          id: 1,
          gid: 1,
          x: 64,
          y: 160,
          width: 96,
          height: 128,
          type: 'tree',
          properties: [{ name: 'tileborne.anchor', type: 'string', value: 'center' }],
        },
        {
          id: 2,
          gid: 1,
          x: 64,
          y: 160,
          width: 96,
          height: 128,
          type: 'tree',
          properties: [{ name: 'tileborne.anchor', type: 'string', value: 'top-left' }],
        },
      ],
    },
  ],
});

const tiledMapWith = (overrides: Record<string, unknown>) =>
  JSON.stringify({
    type: 'map',
    version: '1.10',
    orientation: 'orthogonal',
    width: 1,
    height: 1,
    tilewidth: 16,
    tileheight: 16,
    tilesets: [{ firstgid: 1, ...inlineTileset }],
    layers: [{ type: 'tilelayer', name: 'ground', width: 1, height: 1, data: [1] }],
    ...overrides,
  });

const ambiguousAtlasTmj = JSON.stringify({
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
      name: 'atlas',
      tilewidth: 32,
      tileheight: 32,
      tilecount: 4,
      columns: 2,
      image: 'atlas.png',
      imagewidth: 64,
      imageheight: 64,
    },
  ],
  layers: [
    {
      type: 'objectgroup',
      name: 'objects',
      objects: [{ id: 1, gid: 1, x: 32, y: 96, width: 64, height: 64, type: 'tree' }],
    },
  ],
});

const imageCollectionTmx = (imageSource: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.10" orientation="orthogonal" width="1" height="1" tilewidth="16" tileheight="16">
  <tileset firstgid="1" name="objects" tilewidth="16" tileheight="16" tilecount="1" columns="0">
    <tile id="0">
      <image source="${imageSource}" width="16" height="16"/>
    </tile>
  </tileset>
  <objectgroup id="1" name="objects">
    <object id="1" gid="1" x="0" y="16" width="16" height="16"/>
  </objectgroup>
</map>`;

const atlasPropsTsx = `<?xml version="1.0" encoding="UTF-8"?>
<tileset version="1.10" tiledversion="1.11.0" name="Atlas-Props" tilewidth="16" tileheight="16" tilecount="4" columns="2">
  <image source="../Images/Atlas-Props.png" width="32" height="32"/>
  <tile id="1" probability="0.25">
    <properties>
      <property name="terrain" value="stone"/>
    </properties>
    <objectgroup draworder="index" id="2">
      <object id="1" x="0" y="0" width="16" height="16"/>
    </objectgroup>
    <animation>
      <frame tileid="2" duration="100"/>
      <frame tileid="3" duration="150"/>
    </animation>
  </tile>
  <wangsets>
    <wangset name="ground" type="corner" tile="0">
      <wangcolor name="stone" color="#777777" tile="0" probability="1"/>
      <wangtile tileid="1" wangid="0,1,0,1,0,1,0,1"/>
    </wangset>
  </wangsets>
</tileset>`;

const atlasPropsSpritesTsx = `<?xml version="1.0" encoding="UTF-8"?>
<tileset version="1.10" tiledversion="1.11.0" name="Atlas-Props-Sprites" tilewidth="16" tileheight="16" tilecount="2" columns="0">
  <tile id="1618" type="crate">
    <image source="../Images/Props/crate.png" width="24" height="24"/>
  </tile>
  <tile id="2258" class="torch">
    <properties>
      <property name="tileborne.category" value="lights"/>
    </properties>
    <image source="../Images/Props/torch.png" width="16" height="32"/>
  </tile>
</tileset>`;

const atlasPropsTsj = JSON.stringify({
  type: 'tileset',
  name: 'Atlas-Props-Json',
  tilewidth: 16,
  tileheight: 16,
  tilecount: 1,
  columns: 1,
  image: '../Images/Atlas-Props-Json.png',
  imagewidth: 16,
  imageheight: 16,
});

describe('tiled import', () => {
  it('loads a basic TMJ map into TilesetPack and map layers', () => {
    const result = parseTmjSync(basicTmj, {
      packIdSeed: PACK_SEED,
      projectRoot: PROJECT_ROOT,
      sourcePath: `${PROJECT_ROOT}/maps/test.tmj`,
    });

    expect(result.value).toBeDefined();
    expect(result.value!.pack.tilesets).toHaveLength(1);
    expect(result.value!.pack.assets.some((asset) => asset.path === 'terrain.png')).toBe(true);
    expect(result.value!.tiledMap.layers).toHaveLength(1);
    const layer = result.value!.tiledMap.layers[0];
    expect(layer?.kind).toBe('tile');
    if (layer?.kind === 'tile') {
      expect(layer.cells).toHaveLength(4);
    }
  });

  it('loads a basic TMX map', async () => {
    const result = await parseTmx(basicTmx, {
      packIdSeed: PACK_SEED,
      projectRoot: PROJECT_ROOT,
      sourcePath: `${PROJECT_ROOT}/maps/test.tmx`,
    });

    expect(result.value).toBeDefined();
    expect(result.value!.map.size.width).toBe(2);
    expect(result.value!.pack.tilesets[0]?.name).toBe('terrain');
  });

  it('preserves supported image-layer semantics without unsupported diagnostics', async () => {
    const raw = tiledMapWith({
      layers: [
        { type: 'tilelayer', name: 'ground', width: 1, height: 1, data: [1] },
        {
          type: 'imagelayer',
          name: 'backdrop',
          image: 'images/backdrop.png',
          x: 12,
          y: 24,
          opacity: 0.5,
          properties: [{ name: 'theme', type: 'string', value: 'forest' }],
        },
      ],
    });

    const scanned = await scanTiledSource({
      sourcePath: `${PROJECT_ROOT}/maps/image-layer.tmj`,
      projectRoot: PROJECT_ROOT,
      raw,
    });
    const imported = await importTiled(
      { sourcePath: `${PROJECT_ROOT}/maps/image-layer.tmj`, projectRoot: PROJECT_ROOT, raw },
      { packIdSeed: PACK_SEED, profile: 'standard' },
    );

    expect(scanned.scan?.unsupportedFeatures).toEqual([]);
    expect(scanned.diagnostics).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ feature: 'image-layer' })]),
    );
    expect(imported.value?.tiledMap.layers[1]).toMatchObject({
      kind: 'image',
      name: 'backdrop',
      image: 'images/backdrop.png',
      assetId: expect.stringMatching(/^asset:/),
      x: 12,
      y: 24,
      opacity: 0.5,
      properties: { theme: 'forest' },
    });
    expect(imported.value?.pack.assets.map((asset) => asset.path)).toContain('images/backdrop.png');
    expect(imported.value?.map.layers[1]).toMatchObject({
      _tag: 'image',
      name: 'backdrop',
      assetId:
        imported.value?.tiledMap.layers[1]?.kind === 'image'
          ? imported.value.tiledMap.layers[1].assetId
          : undefined,
      x: 12,
      y: 24,
      opacity: 0.5,
    });
  });

  it('writes Tileborne map chunks in pack tile-index space, not raw Tiled GIDs', () => {
    const result = parseTmjSync(
      JSON.stringify({
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
            name: 'terrain-a',
            tilewidth: 16,
            tileheight: 16,
            tilecount: 1,
            columns: 1,
            imagewidth: 16,
            imageheight: 16,
            image: 'terrain-a.png',
          },
          {
            firstgid: 100,
            name: 'terrain-b',
            tilewidth: 16,
            tileheight: 16,
            tilecount: 1,
            columns: 1,
            imagewidth: 16,
            imageheight: 16,
            image: 'terrain-b.png',
          },
        ],
        layers: [
          {
            type: 'tilelayer',
            name: 'ground',
            width: 2,
            height: 1,
            data: [1, 100],
          },
        ],
      }),
      {
        packIdSeed: PACK_SEED,
        projectRoot: PROJECT_ROOT,
        sourcePath: `${PROJECT_ROOT}/maps/gapped-firstgid.tmj`,
      },
    );

    expect(result.value).toBeDefined();
    const tiledLayer = result.value!.tiledMap.layers[0];
    expect(tiledLayer?.kind).toBe('tile');
    if (tiledLayer?.kind === 'tile') {
      expect(tiledLayer.cells.map((cell) => cell.gid)).toEqual([1, 100]);
      expect(tiledLayer.cells.map((cell) => cell.tileIndex)).toEqual([1, 2]);
    }
    const coreLayer = result.value!.map.layers[0];
    expect(coreLayer?._tag).toBe('tile');
    if (coreLayer?._tag === 'tile') {
      expect(coreLayer.chunks[0]?.tiles).toEqual([1, 2]);
    }
  });

  it('resolves external TSX through mocked readFile', async () => {
    const reads: string[] = [];
    const result = await parseTmj(JSON.stringify(JSON.parse(externalTmj)), {
      packIdSeed: PACK_SEED,
      projectRoot: PROJECT_ROOT,
      sourcePath: `${PROJECT_ROOT}/maps/with-external.tmj`,
      reader: {
        readFile: (path) => {
          reads.push(path);
          if (path.endsWith('external.tsx')) return externalTsx;
          throw new Error(`unexpected read: ${path}`);
        },
      },
    });

    expect(reads.some((path) => path.endsWith('tilesets/external.tsx'))).toBe(true);
    expect(result.value?.pack.tilesets[0]?.name).toBe('external');
  });

  it('keeps large image-collection tile objects as placeables instead of split cells', () => {
    const result = parseTmjSync(largePlaceableTmj, {
      packIdSeed: PACK_SEED,
      projectRoot: PROJECT_ROOT,
      sourcePath: `${PROJECT_ROOT}/maps/objects.tmj`,
    });

    expect(result.value).toBeDefined();
    const pack = result.value!.pack;
    const tileset = pack.tilesets[0]!;
    expect(tileset.tiles).toHaveLength(0);
    expect(pack.placeables).toHaveLength(1);
    expect(pack.placeables?.[0]?.size).toMatchObject({ width: 96, height: 128 });
    expect(pack.placeables?.[0]?.source.localTileId).toBe(0);
    expect(pack.placeables?.[0]?.source.properties).toMatchObject({
      'tileborne.anchor': 'top-left',
    });
    expect(pack.placeables?.[0]?.placementMode).toBe('object');

    const object = result.value!.tiledMap.layers.find((layer) => layer.kind === 'object');
    expect(object?.kind).toBe('object');
    if (object?.kind === 'object') {
      expect(object.tileRef).toMatchObject({
        gid: 1,
        localTileIndex: 0,
        tilesetName: 'objects',
      });
      expect(object.placement).toMatchObject({
        placeableId: pack.placeables?.[0]?.id,
        source: 'tiled-object',
        assetId: pack.placeables?.[0]?.frames[0]?.assetId,
        tileId: pack.placeables?.[0]?.frames[0]?.tileId,
        gid: 1,
        anchor: 'top-left',
      });
      expect(object.y).toBe(32);
      expect(object.width).toBe(96);
      expect(object.height).toBe(128);
      expect(object.anchor).toBe('top-left');
    }
  });

  it('returns a Core TileborneMap with MapObjectPlacement for image-collection gid objects', async () => {
    const result = await importTiled(
      {
        sourcePath: `${PROJECT_ROOT}/maps/objects.tmj`,
        projectRoot: PROJECT_ROOT,
        raw: largePlaceableTmj,
      },
      { packIdSeed: PACK_SEED },
    );

    expect(result.value?.map.objects).toHaveLength(1);
    expect(result.value?.map.objects[0]?.placement?.placeableId).toBe(
      result.value?.pack.placeables?.[0]?.id,
    );
    expect(result.value?.map.objects[0]?.placement?.packId).toStrictEqual(
      Option.some(result.value!.pack.id),
    );
    expect(result.value?.map.objects[0]?.y).toBe(32);
    expect(result.value?.map.objects[0]?.properties).toMatchObject({
      'tileborne.anchor': 'top-left',
    });
  });

  it('imports standalone Atlas-Props-style TSX grid tilesets as tileset packs', async () => {
    const result = await importTiled(
      {
        sourcePath: `${PROJECT_ROOT}/TiledMap Editor/Tilesets/Atlas-Props.tsx` as const,
        projectRoot: PROJECT_ROOT,
        raw: atlasPropsTsx,
      },
      { packIdSeed: PACK_SEED },
    );

    const value = result.value as TiledTilesetPackImport | undefined;
    expect(value?.kind).toBe('tileset-pack');
    expect(value?.scan.sourceKind).toBe('tileset');
    expect(value?.pack.tilesets[0]?.name).toBe('Atlas-Props');
    expect(value?.pack.assets.map((asset) => asset.path)).toContain(
      'TiledMap Editor/Images/Atlas-Props.png',
    );
    const tileset = value?.pack.tilesets[0];
    expect(tileset?.tiles).toHaveLength(4);
    expect(tileset?.autotileRules).toHaveLength(1);
    expect(tileset?.variantFilters).toHaveLength(1);
    expect(Option.isSome(tileset?.tiles[1]?.animation ?? Option.none())).toBe(true);
    expect(Option.isSome(tileset?.tiles[1]?.collisionMask ?? Option.none())).toBe(true);
  });

  it('imports standalone TSX files with directory-capable readers as tileset packs', async () => {
    const sourcePath = `${PROJECT_ROOT}/TiledMap Editor/Tilesets/Atlas-Props.tsx` as const;
    const result = await importTiled(
      {
        sourcePath,
        projectRoot: PROJECT_ROOT,
        reader: {
          readFile: (path) => {
            if (path !== sourcePath) throw new Error(`unexpected read: ${path}`);
            return atlasPropsTsx;
          },
          readDirectory: () => {
            throw new Error('standalone tileset import must not scan the file as a directory');
          },
        },
      },
      { packIdSeed: PACK_SEED },
    );

    const value = result.value as TiledTilesetPackImport | undefined;
    expect(value?.kind).toBe('tileset-pack');
    expect(value?.pack.tilesets[0]?.name).toBe('Atlas-Props');
  });

  it('imports standalone TSJ tilesets through the same SDK path', async () => {
    const result = await importTiled(
      {
        sourcePath: `${PROJECT_ROOT}/TiledMap Editor/Tilesets/Atlas-Props.tsj` as const,
        projectRoot: PROJECT_ROOT,
        raw: atlasPropsTsj,
      },
      { packIdSeed: PACK_SEED },
    );

    const value = result.value as TiledTilesetPackImport | undefined;
    expect(value?.kind).toBe('tileset-pack');
    expect(value?.pack.tilesets[0]?.name).toBe('Atlas-Props-Json');
    expect(value?.pack.assets.map((asset) => asset.path)).toContain(
      'TiledMap Editor/Images/Atlas-Props-Json.png',
    );
  });

  it('keeps Atlas-Props-Sprites-style sparse image-collection tile IDs', async () => {
    const result = await importTiled(
      {
        sourcePath: `${PROJECT_ROOT}/TiledMap Editor/Tilesets/Atlas-Props-Sprites.tsx` as const,
        projectRoot: PROJECT_ROOT,
        raw: atlasPropsSpritesTsx,
      },
      { packIdSeed: PACK_SEED },
    );

    const value = result.value as TiledTilesetPackImport | undefined;
    expect(value?.kind).toBe('tileset-pack');
    expect(value?.scan.placeableCandidates.map((candidate) => candidate.localTileId)).toEqual([
      1618, 2258,
    ]);
    expect(value?.pack.placeables?.map((placeable) => placeable.source.localTileId)).toEqual([
      1618, 2258,
    ]);
    expect(value?.pack.assets.map((asset) => asset.path)).toEqual([
      'TiledMap Editor/Images/Props/crate.png',
      'TiledMap Editor/Images/Props/torch.png',
    ]);
  });

  it('blocks standalone tileset image paths that escape the project root', async () => {
    const unsafe = atlasPropsSpritesTsx.replace(
      '../Images/Props/crate.png',
      '../../../outside/crate.png',
    );
    const result = await importTiled(
      {
        sourcePath: `${PROJECT_ROOT}/TiledMap Editor/Tilesets/Atlas-Props-Sprites.tsx` as const,
        projectRoot: PROJECT_ROOT,
        raw: unsafe,
      },
      { packIdSeed: PACK_SEED },
    );

    expect(result.value).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _tag: 'TiledExternalRefBlocked',
          severity: 'error',
          source: '../../../outside/crate.png',
        }),
      ]),
    );
  });

  it('imports raw Tiled source folders as source packs and preserves rules', async () => {
    const files = new Map<string, string>([
      [`${PROJECT_ROOT}/TiledMap Editor/Tilesets/Atlas-Props.tsx`, atlasPropsTsx],
      [`${PROJECT_ROOT}/TiledMap Editor/Tilesets/Atlas-Props-Sprites.tsx`, atlasPropsSpritesTsx],
      [`${PROJECT_ROOT}/TiledMap Editor/rules.txt`, 'Rules/walls.tmx\n'],
      [`${PROJECT_ROOT}/TiledMap Editor/Rules/walls.tmx`, basicTmx],
    ]);
    const directories = new Map<
      string,
      readonly { readonly name: string; readonly kind: 'file' | 'directory' }[]
    >([
      [
        `${PROJECT_ROOT}/TiledMap Editor`,
        [
          { name: 'Tilesets', kind: 'directory' },
          { name: 'Rules', kind: 'directory' },
          { name: 'rules.txt', kind: 'file' },
        ],
      ],
      [
        `${PROJECT_ROOT}/TiledMap Editor/Tilesets`,
        [
          { name: 'Atlas-Props.tsx', kind: 'file' },
          { name: 'Atlas-Props-Sprites.tsx', kind: 'file' },
        ],
      ],
      [`${PROJECT_ROOT}/TiledMap Editor/Rules`, [{ name: 'walls.tmx', kind: 'file' }]],
    ]);

    const result = await importTiled(
      {
        sourcePath: `${PROJECT_ROOT}/TiledMap Editor`,
        projectRoot: PROJECT_ROOT,
        reader: {
          readFile: (path) => {
            const value = files.get(path);
            if (value === undefined) throw new Error(`unexpected read: ${path}`);
            return value;
          },
          readDirectory: (path) => directories.get(path) ?? [],
        },
      },
      { packIdSeed: PACK_SEED },
    );

    const value = result.value as unknown as TiledSourcePackImport | undefined;
    expect(value?.kind).toBe('source-pack');
    expect(value?.scan.sourceKind).toBe('source-folder');
    expect(value?.pack.tilesets.map((tileset) => tileset.name).sort()).toEqual([
      'Atlas-Props',
      'Atlas-Props-Sprites',
    ]);
    expect(value?.pack.placeables?.map((placeable) => placeable.source.localTileId)).toEqual([
      1618, 2258,
    ]);
    expect(
      value?.rules.map((rule) => ({ kind: rule.kind, path: rule.path.replace(PROJECT_ROOT, '') })),
    ).toEqual(
      expect.arrayContaining([
        { kind: 'rule-map', path: '/TiledMap Editor/Rules/walls.tmx' },
        { kind: 'rules-index', path: '/TiledMap Editor/rules.txt' },
      ]),
    );
    expect(value?.rules.find((rule) => rule.kind === 'rules-index')?.raw).toBe('Rules/walls.tmx\n');
    expect(value?.scan.sourceInventory?.summary).toMatchObject({
      tilesetCount: 2,
      frameCount: 6,
      imageCollectionTileCount: 2,
      ruleMapCount: 1,
      rulesIndexCount: 1,
    });
    expect(value?.scan.sourceInventory?.rules.map((rule) => rule.kind).sort()).toEqual([
      'rule-map',
      'rules-index',
    ]);
  });

  it('converts default Tiled tile-object bottom-left coordinates to canonical top-left', () => {
    const result = parseTmjSync(largePlaceableTmj, {
      packIdSeed: PACK_SEED,
      projectRoot: PROJECT_ROOT,
      sourcePath: `${PROJECT_ROOT}/maps/objects.tmj`,
    });

    const object = result.value?.tiledMap.layers.find((layer) => layer.kind === 'object');
    expect(object?.kind).toBe('object');
    if (object?.kind === 'object') {
      expect(object.x).toBe(64);
      expect(object.y).toBe(32);
      expect(object.anchor).toBe('top-left');
    }
  });

  it('honors tileborne.anchor center and top-left under standard-plus-hints', async () => {
    const result = await importTiled(
      {
        sourcePath: `${PROJECT_ROOT}/maps/anchored.tmj`,
        projectRoot: PROJECT_ROOT,
        raw: anchoredObjectsTmj,
      },
      { packIdSeed: PACK_SEED, profile: 'standard-plus-hints' },
    );

    expect(result.value?.map.objects).toHaveLength(2);
    expect(result.value?.map.objects[0]).toMatchObject({ x: 16, y: 96 });
    expect(result.value?.map.objects[1]).toMatchObject({ x: 64, y: 160 });
    expect(
      result.value?.map.objects.every(
        (object) => object.properties['tileborne.anchor'] === 'top-left',
      ),
    ).toBe(true);
  });

  it.each([['../../outside.png'], ['/etc/passwd'], ['./a/../../b.png']])(
    'blocks escaping image-collection image source %s',
    async (imageSource) => {
      const result = await importTiled(
        {
          sourcePath: `${PROJECT_ROOT}/maps/objects.tmx`,
          projectRoot: PROJECT_ROOT,
          raw: imageCollectionTmx(imageSource),
        },
        { packIdSeed: PACK_SEED },
      );

      expect(result.value).toBeUndefined();
      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            _tag: 'TiledExternalRefBlocked',
            severity: 'error',
            source: imageSource,
          }),
        ]),
      );
    },
  );

  it('promotes hinted atlas tiles only under standard-plus-hints', async () => {
    const standard = await importTiled(
      {
        sourcePath: `${PROJECT_ROOT}/maps/hinted.tmj`,
        projectRoot: PROJECT_ROOT,
        raw: hintedAtlasTmj,
      },
      { packIdSeed: PACK_SEED, profile: 'standard' },
    );
    const hinted = await importTiled(
      {
        sourcePath: `${PROJECT_ROOT}/maps/hinted.tmj`,
        projectRoot: PROJECT_ROOT,
        raw: hintedAtlasTmj,
      },
      { packIdSeed: PACK_SEED, profile: 'standard-plus-hints' },
    );

    expect(standard.value?.pack.placeables ?? []).toHaveLength(0);
    expect(hinted.value?.pack.placeables?.[0]).toMatchObject({
      name: 'tree',
      size: { width: 64, height: 64 },
      placementMode: 'object',
    });
    expect(hinted.value?.map.objects[0]?.placement?.placeableId).toBe(
      hinted.value?.pack.placeables?.[0]?.id,
    );
  });

  it('keeps unhinted grid atlas and Wang tiles paintable under standard-plus-hints', async () => {
    const raw = JSON.stringify({
      type: 'map',
      version: '1.10',
      orientation: 'orthogonal',
      width: 2,
      height: 2,
      tilewidth: 16,
      tileheight: 16,
      tilesets: [{ firstgid: 1, ...inlineTileset }],
      layers: [
        { type: 'tilelayer', name: 'ground', width: 2, height: 2, data: [1, 2, 3, 4] },
        {
          type: 'objectgroup',
          name: 'objects',
          objects: [{ id: 1, gid: 1, x: 0, y: 32, width: 32, height: 32 }],
        },
      ],
    });

    const result = await importTiled(
      { sourcePath: `${PROJECT_ROOT}/maps/wang-atlas.tmj`, projectRoot: PROJECT_ROOT, raw },
      { packIdSeed: PACK_SEED, profile: 'standard-plus-hints' },
    );

    const tileset = result.value?.pack.tilesets[0];
    expect(tileset?.tiles).toHaveLength(4);
    expect(tileset?.autotileRules).toHaveLength(1);
    expect(result.value?.pack.placeables ?? []).toHaveLength(0);
  });

  it('diagnoses unmarked atlas object regions without auto-promoting them', async () => {
    const result = await importTiled(
      {
        sourcePath: `${PROJECT_ROOT}/maps/ambiguous.tmj`,
        projectRoot: PROJECT_ROOT,
        raw: ambiguousAtlasTmj,
      },
      { packIdSeed: PACK_SEED, profile: 'standard' },
    );

    expect(result.value?.pack.placeables ?? []).toHaveLength(0);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ _tag: 'TiledAmbiguousAtlasObject' })]),
    );
  });

  it.each([
    [
      'horizontal',
      FLIPPED_H,
      {
        flippedHorizontal: true,
        flippedVertical: false,
        flippedDiagonal: false,
        rotatedHexagonal120: false,
      },
    ],
    [
      'vertical',
      FLIPPED_V,
      {
        flippedHorizontal: false,
        flippedVertical: true,
        flippedDiagonal: false,
        rotatedHexagonal120: false,
      },
    ],
    [
      'diagonal',
      FLIPPED_D,
      {
        flippedHorizontal: false,
        flippedVertical: false,
        flippedDiagonal: true,
        rotatedHexagonal120: false,
      },
    ],
  ])(
    'preserves %s tile-layer flip flags in scan, SDK map, and Core chunks',
    async (_label, rawGid, transform) => {
      const raw = tiledMapWith({
        layers: [{ type: 'tilelayer', name: 'ground', width: 1, height: 1, data: [rawGid] }],
      });

      const scanned = await scanTiledSource({
        sourcePath: `${PROJECT_ROOT}/maps/flipped.tmj`,
        projectRoot: PROJECT_ROOT,
        raw,
      });
      const imported = await importTiled(
        { sourcePath: `${PROJECT_ROOT}/maps/flipped.tmj`, projectRoot: PROJECT_ROOT, raw },
        { packIdSeed: PACK_SEED, profile: 'standard' },
      );

      expect(scanned.scan?.featureFlags.flipFlags).toBe(true);
      expect(scanned.scan?.unsupportedFeatures).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ feature: 'flip-flags' })]),
      );
      expect(scanned.diagnostics).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ feature: 'flip-flags', severity: 'error' }),
        ]),
      );
      expect(imported.value?.tiledMap.layers[0]).toMatchObject({
        kind: 'tile',
        cells: [expect.objectContaining({ rawGid, gid: 1, tileIndex: 1, transform })],
      });
      expect(imported.value?.map.layers[0]).toMatchObject({
        _tag: 'tile',
        chunks: [expect.objectContaining({ tiles: [1], transforms: [transform] })],
      });
    },
  );

  it('preserves flipped tile objects in tile refs, placements, and Core object placement', async () => {
    const raw = tiledMapWith({
      tilesets: [
        {
          firstgid: 1,
          name: 'objects',
          tilewidth: 16,
          tileheight: 16,
          tilecount: 1,
          columns: 0,
          tiles: [{ id: 0, image: 'tree.png', imagewidth: 16, imageheight: 16 }],
        },
      ],
      layers: [
        {
          type: 'objectgroup',
          name: 'objects',
          objects: [{ id: 1, gid: FLIPPED_H, x: 0, y: 16, width: 16, height: 16 }],
        },
      ],
    });

    const scanned = await scanTiledSource({
      sourcePath: `${PROJECT_ROOT}/maps/flipped-object.tmj`,
      projectRoot: PROJECT_ROOT,
      raw,
    });
    const imported = await importTiled(
      { sourcePath: `${PROJECT_ROOT}/maps/flipped-object.tmj`, projectRoot: PROJECT_ROOT, raw },
      { packIdSeed: PACK_SEED, profile: 'standard-plus-hints' },
    );

    const transform = {
      flippedHorizontal: true,
      flippedVertical: false,
      flippedDiagonal: false,
      rotatedHexagonal120: false,
    };

    expect(scanned.scan?.featureFlags.flipFlags).toBe(true);
    expect(scanned.scan?.unsupportedFeatures).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ feature: 'flip-flags' })]),
    );
    expect(imported.value?.tiledMap.layers[0]).toMatchObject({
      kind: 'object',
      tileRef: expect.objectContaining({ rawGid: FLIPPED_H, gid: 1, transform }),
      placement: expect.objectContaining({ gid: 1, transform }),
    });
    expect(imported.value?.map.objects[0]?.placement).toMatchObject({
      gid: Option.some(1),
      transform,
    });
  });

  it.each([
    ['non-orthogonal orientation', tiledMapWith({ orientation: 'isometric' }), 'orientation'],
    [
      'infinite chunks',
      tiledMapWith({
        infinite: true,
        layers: [
          {
            type: 'tilelayer',
            name: 'ground',
            width: 1,
            height: 1,
            data: [1],
            chunks: [{ x: 0, y: 0, width: 1, height: 1, data: [1] }],
          },
        ],
      }),
      'infinite-chunks',
    ],
    [
      'templates',
      tiledMapWith({
        layers: [
          {
            type: 'objectgroup',
            name: 'objects',
            objects: [{ id: 1, x: 0, y: 0, template: 'tree.tx' }],
          },
        ],
      }),
      'templates',
    ],
    [
      'rotation',
      tiledMapWith({
        layers: [
          { type: 'objectgroup', name: 'objects', objects: [{ id: 1, x: 0, y: 0, rotation: 45 }] },
        ],
      }),
      'rotation',
    ],
    [
      'parallax',
      tiledMapWith({
        layers: [
          { type: 'tilelayer', name: 'ground', width: 1, height: 1, data: [1], parallaxx: 0.5 },
        ],
      }),
      'parallax',
    ],
    [
      'class typed custom properties',
      tiledMapWith({
        properties: [
          { name: 'spawnConfig', type: 'class', propertytype: 'SpawnConfig', value: { count: 2 } },
        ],
      }),
      'class-properties',
    ],
  ])('blocks unsupported %s in standard and standard-plus-hints', async (_label, raw, feature) => {
    const scanned = await scanTiledSource({
      sourcePath: `${PROJECT_ROOT}/maps/unsupported.tmj`,
      projectRoot: PROJECT_ROOT,
      raw,
    });

    expect(scanned.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _tag: 'TiledUnsupportedFeature',
          feature,
          severity: 'error',
          action: expect.any(String),
        }),
      ]),
    );
    expect(scanned.scan?.unsupportedFeatures).toEqual(
      expect.arrayContaining([expect.objectContaining({ feature, action: expect.any(String) })]),
    );

    for (const profile of ['standard', 'standard-plus-hints'] as const) {
      const imported = await importTiled(
        { sourcePath: `${PROJECT_ROOT}/maps/unsupported.tmj`, projectRoot: PROJECT_ROOT, raw },
        { packIdSeed: PACK_SEED, profile },
      );
      expect(imported.value).toBeUndefined();
    }
  });

  it('resolves object placeables through a multi-tileset lookup map', async () => {
    const raw = JSON.stringify({
      type: 'map',
      version: '1.10',
      orientation: 'orthogonal',
      width: 4,
      height: 4,
      tilewidth: 16,
      tileheight: 16,
      tilesets: [
        {
          firstgid: 1,
          name: 'trees',
          tilewidth: 16,
          tileheight: 16,
          tilecount: 1,
          columns: 0,
          tiles: [{ id: 0, type: 'oak', image: 'oak.png', imagewidth: 16, imageheight: 32 }],
        },
        {
          firstgid: 2,
          name: 'rocks',
          tilewidth: 16,
          tileheight: 16,
          tilecount: 1,
          columns: 0,
          tiles: [{ id: 0, type: 'stone', image: 'stone.png', imagewidth: 16, imageheight: 16 }],
        },
      ],
      layers: [
        {
          type: 'objectgroup',
          name: 'props',
          objects: Array.from({ length: 12 }, (_, index) => ({
            id: index + 1,
            gid: index % 2 === 0 ? 1 : 2,
            x: index * 4,
            y: 64,
            width: 16,
            height: index % 2 === 0 ? 32 : 16,
          })),
        },
      ],
    });

    const result = await importTiled(
      { sourcePath: `${PROJECT_ROOT}/maps/multi-objects.tmj`, projectRoot: PROJECT_ROOT, raw },
      { packIdSeed: PACK_SEED },
    );

    const [tree, rock] = result.value?.pack.placeables ?? [];
    expect(result.value?.map.objects).toHaveLength(12);
    expect(result.value?.map.objects.map((object) => object.placement?.placeableId)).toEqual(
      Array.from({ length: 12 }, (_, index) => (index % 2 === 0 ? tree?.id : rock?.id)),
    );
  });

  it('decodes GID flip flags', () => {
    const decoded = decodeTiledGid(2147483649);
    expect(decoded.gid).toBe(1);
    expect(decoded.transform.flippedHorizontal).toBe(true);
    expect(decoded.transform.flippedVertical).toBe(false);
    expect(decoded.transform.flippedDiagonal).toBe(false);
  });

  it('decodes the supported tile layer data matrix', async () => {
    const raw = decodeTileLayerDataSync({
      layerName: 'raw',
      width: 2,
      height: 2,
      data: [1, 2, 3, 4],
    });
    expect(raw).toMatchObject({ data: [1, 2, 3, 4], diagnostics: [] });

    const csv = decodeTileLayerDataSync({
      layerName: 'csv',
      width: 2,
      height: 2,
      encoding: 'csv',
      text: '1,2,3,4',
    });
    expect(csv).toMatchObject({ data: [1, 2, 3, 4], diagnostics: [] });

    const base64 = decodeTileLayerDataSync({
      layerName: 'base64',
      width: 2,
      height: 2,
      encoding: 'base64',
      text: tileLayerBase64([1, 2, 3, 4]),
    });
    expect(base64).toMatchObject({ data: [1, 2, 3, 4], diagnostics: [] });

    const gzip = await decodeTileLayerDataAsync({
      layerName: 'gzip',
      width: 2,
      height: 2,
      encoding: 'base64',
      compression: 'gzip',
      text: COMPRESSED_GZIP_GIDS_1_2_3_4,
    });
    expect(gzip).toMatchObject({ data: [1, 2, 3, 4], diagnostics: [] });

    const zlib = await decodeTileLayerDataAsync({
      layerName: 'zlib',
      width: 2,
      height: 2,
      encoding: 'base64',
      compression: 'zlib',
      text: COMPRESSED_ZLIB_GIDS_1_2_3_4,
    });
    expect(zlib).toMatchObject({ data: [1, 2, 3, 4], diagnostics: [] });
  });

  it('returns a typed diagnostic for zstd tile-layer compression without decoding', async () => {
    const result = await decodeTileLayerDataAsync({
      layerName: 'zstd',
      width: 2,
      height: 2,
      encoding: 'base64',
      compression: 'zstd',
      text: tileLayerBase64([1, 2, 3, 4]),
    });

    expect(result.data).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        _tag: 'TiledUnsupportedCompression',
        layerName: 'zstd',
        compression: 'zstd',
        path: '/layers/zstd/data',
        severity: 'warning',
      }),
    ]);
  });

  it('converts wang sets to AutotileRule', () => {
    const tsj = parseTsj(JSON.stringify(inlineTileset), {
      packIdSeed: PACK_SEED,
      tilesetSeed: 'terrain',
    });
    const rule = tsj.value?.tileset.autotileRules[0];
    expect(rule).toBeInstanceOf(Wang2CornerAutotileRule);
    expect(wangIdToMaskKey([0, 1, 0, 1, 0, 1, 0, 1], 'wang2corner')).toBe('1111');
  });

  it('skips out-of-bounds wang tiles instead of emitting invalid manifest refs', () => {
    const tsj = parseTsj(
      JSON.stringify({
        ...inlineTileset,
        tilecount: 4,
        wangsets: [
          {
            name: 'ground',
            type: 'corner',
            colors: [{ name: 'grass', color: '#00ff00', tile: 0 }],
            wangtiles: [
              { tileid: 1, wangid: [0, 1, 0, 1, 0, 1, 0, 1] },
              { tileid: 99, wangid: [0, 1, 0, 1, 0, 1, 0, 1] },
            ],
          },
        ],
      }),
      {
        packIdSeed: PACK_SEED,
        tilesetSeed: 'terrain',
      },
    );

    expect(tsj.value?.tileset.autotileRules[0]?.maskToTileIds['1111']).toHaveLength(1);
    expect(tsj.diagnostics.some((diagnostic) => diagnostic.path.includes('wangtiles/99'))).toBe(
      true,
    );

    const tileIds = new Set(tsj.value?.tileset.tiles.map((tile) => String(tile.id)));
    const ruleIds = Object.values(tsj.value?.tileset.autotileRules[0]?.maskToTileIds ?? {}).flat();
    expect(ruleIds.every((tileId) => tileIds.has(String(tileId)))).toBe(true);
  });

  it('parses tile animations', () => {
    const tsj = parseTsj(JSON.stringify(inlineTileset), {
      packIdSeed: PACK_SEED,
      tilesetSeed: 'terrain',
    });
    const animated = tsj.value?.tileset.tiles.find((tile) => Option.isSome(tile.animation));
    expect(Option.isSome(animated?.animation ?? Option.none())).toBe(true);
  });

  it('blocks path traversal for external refs', async () => {
    const result = await resolveExternalPath({
      projectRoot: PROJECT_ROOT,
      basePath: `${PROJECT_ROOT}/maps/test.tmj`,
      source: '../../outside.tsx',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic._tag).toBe('TiledExternalRefBlocked');
    }
  });

  it('returns schema diagnostics for malformed TMJ layer and tileset shapes', () => {
    const cases = [
      {
        name: 'wrong layer type',
        patch: {
          layers: [{ type: 'badlayer', name: 'ground', width: 1, height: 1, data: [1] }],
        },
      },
      {
        name: 'missing tileset firstgid',
        patch: {
          tilesets: [{ ...inlineTileset }],
        },
      },
      {
        name: 'non-array tile data',
        patch: {
          layers: [{ type: 'tilelayer', name: 'ground', width: 1, height: 1, data: '1' }],
        },
      },
      {
        name: 'bad property type',
        patch: {
          tilesets: [
            {
              firstgid: 1,
              ...inlineTileset,
              properties: [{ name: 'terrain', type: 'unsupported', value: 'grass' }],
            },
          ],
        },
      },
    ];

    for (const entry of cases) {
      const result = parseTmjSync(
        JSON.stringify({
          type: 'map',
          version: '1.10',
          orientation: 'orthogonal',
          width: 1,
          height: 1,
          tilewidth: 16,
          tileheight: 16,
          tilesets: [{ firstgid: 1, ...inlineTileset }],
          layers: [{ type: 'tilelayer', name: 'ground', width: 1, height: 1, data: [1] }],
          ...entry.patch,
        }),
        {
          packIdSeed: PACK_SEED,
          projectRoot: PROJECT_ROOT,
          sourcePath: `${PROJECT_ROOT}/maps/malformed.tmj`,
        },
      );

      expect(result.value, entry.name).toBeUndefined();
      expect(result.diagnostics, entry.name).toEqual([
        expect.objectContaining({
          _tag: 'TiledParseError',
          severity: 'error',
          format: 'tmj',
        }),
      ]);
      expect(result.diagnostics[0]?.message, entry.name).toContain('schema error');
    }
  });

  it('marks spawn/prop objectgroups by class', () => {
    const tmj = JSON.stringify({
      type: 'map',
      version: '1.10',
      orientation: 'orthogonal',
      width: 1,
      height: 1,
      tilewidth: 16,
      tileheight: 16,
      tilesets: [{ firstgid: 1, ...inlineTileset }],
      layers: [
        {
          type: 'objectgroup',
          name: 'objects',
          class: 'spawn',
          objects: [{ id: 1, x: 8, y: 8, class: 'player_spawn' }],
        },
      ],
    });

    const result = parseTmjSync(tmj, {
      packIdSeed: PACK_SEED,
      projectRoot: PROJECT_ROOT,
      sourcePath: `${PROJECT_ROOT}/maps/spawns.tmj`,
    });

    const objectLayer = result.value?.tiledMap.layers.find((layer) => layer.kind === 'object');
    expect(objectLayer?.kind).toBe('object');
    if (objectLayer?.kind === 'object') {
      expect(objectLayer.role).toBe('spawn');
    }
  });

  it('builds deterministic import plans and isolates assistive inference until accepted', async () => {
    const scanned = await scanTiledSource({
      sourcePath: `${PROJECT_ROOT}/maps/ambiguous.tmj`,
      projectRoot: PROJECT_ROOT,
      raw: ambiguousAtlasTmj,
    });
    expect(scanned.scan).toBeDefined();

    const standard = buildImportPlan(scanned.scan!, 'standard');
    const assistive = buildImportPlan(scanned.scan!, 'assistive-infer');
    const accepted = buildImportPlan(scanned.scan!, 'assistive-infer', {
      acceptedSuggestionIds: [assistive.suggestions[0]!.id],
    });

    expect(JSON.stringify(buildImportPlan(scanned.scan!, 'standard'))).toBe(
      JSON.stringify(standard),
    );
    expect(standard.suggestions).toEqual([]);
    expect(assistive.suggestions[0]).toEqual(
      expect.objectContaining({
        source: 'assistive-infer',
        confidence: expect.any(Number),
      }),
    );
    expect(applyImportPlan(assistive).acceptedSuggestions).toEqual([]);
    expect(applyImportPlan(accepted).acceptedSuggestions).toHaveLength(1);
  });

  it('adds SDK-owned source role recommendations to scans and plans', async () => {
    const grid = await scanTiledSource({
      sourcePath: `${PROJECT_ROOT}/tilesets/grid.tsj`,
      projectRoot: PROJECT_ROOT,
      raw: atlasPropsTsj,
    });
    const imageCollection = await scanTiledSource({
      sourcePath: `${PROJECT_ROOT}/tilesets/objects.tsx`,
      projectRoot: PROJECT_ROOT,
      raw: atlasPropsSpritesTsx,
    });
    const hinted = await scanTiledSource({
      sourcePath: `${PROJECT_ROOT}/maps/hinted.tmj`,
      projectRoot: PROJECT_ROOT,
      raw: hintedAtlasTmj,
    });
    const objectLayer = await scanTiledSource({
      sourcePath: `${PROJECT_ROOT}/maps/objects.tmj`,
      projectRoot: PROJECT_ROOT,
      raw: largePlaceableTmj,
    });
    const ambiguous = await scanTiledSource({
      sourcePath: `${PROJECT_ROOT}/maps/ambiguous.tmj`,
      projectRoot: PROJECT_ROOT,
      raw: ambiguousAtlasTmj,
    });

    expect(grid.scan?.sourceRoles).toEqual([
      expect.objectContaining({
        kind: 'paintable-tileset',
        evidence: 'grid-tileset',
        browseTarget: 'tilesets',
        reviewRequired: false,
      }),
    ]);
    expect(grid.scan?.importRecommendation).toMatchObject({
      recommendedProfile: 'standard',
      primaryAction: 'import-paintable-tilesets',
      browseTarget: 'tilesets',
      reviewRequired: false,
    });

    expect(imageCollection.scan?.sourceRoles).toEqual([
      expect.objectContaining({
        kind: 'placeable-object',
        evidence: 'image-collection',
        browseTarget: 'objects',
        reviewRequired: false,
      }),
      expect.objectContaining({
        kind: 'placeable-object',
        evidence: 'image-collection',
        browseTarget: 'objects',
        reviewRequired: false,
      }),
    ]);
    expect(imageCollection.scan?.importRecommendation).toMatchObject({
      recommendedProfile: 'standard',
      primaryAction: 'import-placeable-objects',
      browseTarget: 'objects',
      reviewRequired: false,
    });

    expect(hinted.scan?.importRecommendation).toMatchObject({
      recommendedProfile: 'standard-plus-hints',
      primaryAction: 'import-mixed-assets',
      browseTarget: 'tilesets',
      reviewRequired: false,
    });
    expect(hinted.scan?.sourceRoles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'paintable-tileset', evidence: 'grid-tileset' }),
        expect.objectContaining({ kind: 'placeable-object', evidence: 'tileborne-placeable-hint' }),
        expect.objectContaining({ kind: 'map-context', evidence: 'object-layer' }),
      ]),
    );

    expect(objectLayer.scan?.sourceRoles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'placeable-object', evidence: 'image-collection' }),
        expect.objectContaining({
          kind: 'map-context',
          evidence: 'object-layer',
          reviewRequired: false,
        }),
      ]),
    );

    expect(ambiguous.scan?.importRecommendation).toMatchObject({
      recommendedProfile: 'standard-plus-hints',
      primaryAction: 'review-before-import',
      browseTarget: 'review',
      reviewRequired: true,
    });
    expect(ambiguous.scan?.sourceRoles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'paintable-tileset', evidence: 'grid-tileset' }),
        expect.objectContaining({
          kind: 'review-required',
          evidence: 'ambiguous-atlas-object',
          reviewRequired: true,
        }),
      ]),
    );

    const plan = buildImportPlan(ambiguous.scan!, 'standard-plus-hints');
    expect(plan.importRecommendation).toBe(ambiguous.scan?.importRecommendation);
    expect(applyImportPlan(plan).importRecommendation).toBe(plan.importRecommendation);
  });

  it('recommends mixed source folders without adding a second import owner', async () => {
    const files = new Map<string, string>([
      [`${PROJECT_ROOT}/Source/Tilesets/grid.tsj`, atlasPropsTsj],
      [`${PROJECT_ROOT}/Source/Tilesets/objects.tsx`, atlasPropsSpritesTsx],
    ]);
    const directories = new Map<
      string,
      readonly { readonly name: string; readonly kind: 'file' | 'directory' }[]
    >([
      [`${PROJECT_ROOT}/Source`, [{ name: 'Tilesets', kind: 'directory' }]],
      [
        `${PROJECT_ROOT}/Source/Tilesets`,
        [
          { name: 'grid.tsj', kind: 'file' },
          { name: 'objects.tsx', kind: 'file' },
        ],
      ],
    ]);

    const scanned = await scanTiledSource({
      sourcePath: `${PROJECT_ROOT}/Source`,
      projectRoot: PROJECT_ROOT,
      reader: {
        readFile: (path) => {
          const value = files.get(path);
          if (value === undefined) throw new Error(`unexpected read: ${path}`);
          return value;
        },
        readDirectory: (path) => directories.get(path) ?? [],
      },
    });

    expect(scanned.scan?.importRecommendation).toMatchObject({
      recommendedProfile: 'standard',
      primaryAction: 'import-mixed-assets',
      browseTarget: 'tilesets',
      reviewRequired: false,
    });
    expect(scanned.scan?.sourceRoles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'paintable-tileset', evidence: 'grid-tileset' }),
        expect.objectContaining({ kind: 'placeable-object', evidence: 'image-collection' }),
      ]),
    );
  });

  it('diagnoses Tiled project files in source-folder scans', async () => {
    const files = new Map<string, string>([
      [`${PROJECT_ROOT}/Source/Tilesets/grid.tsj`, atlasPropsTsj],
      [`${PROJECT_ROOT}/Source/project.tiled`, JSON.stringify({ propertyTypes: [] })],
    ]);
    const directories = new Map<
      string,
      readonly { readonly name: string; readonly kind: 'file' | 'directory' }[]
    >([
      [
        `${PROJECT_ROOT}/Source`,
        [
          { name: 'Tilesets', kind: 'directory' },
          { name: 'project.tiled', kind: 'file' },
        ],
      ],
      [`${PROJECT_ROOT}/Source/Tilesets`, [{ name: 'grid.tsj', kind: 'file' }]],
    ]);

    const scanned = await scanTiledSource({
      sourcePath: `${PROJECT_ROOT}/Source`,
      projectRoot: PROJECT_ROOT,
      reader: {
        readFile: (path) => {
          const value = files.get(path);
          if (value === undefined) throw new Error(`unexpected read: ${path}`);
          return value;
        },
        readDirectory: (path) => directories.get(path) ?? [],
      },
    });

    expect(scanned.scan?.unsupportedFeatures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          feature: 'project-files',
          path: `${PROJECT_ROOT}/Source/project.tiled`,
        }),
      ]),
    );
    expect(scanned.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          feature: 'project-files',
          severity: 'error',
          action: expect.any(String),
        }),
      ]),
    );
  });
});
