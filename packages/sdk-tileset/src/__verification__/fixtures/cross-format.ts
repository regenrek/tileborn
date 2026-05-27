export const VERIFICATION_PROJECT_ROOT = "/verification/cross-format";
export const VERIFICATION_PACK_SEED = "verification-cross-format";

/** 2×2 checkerboard: grass (gid 2) and water (gid 3) on a 2-tile 16×16 atlas. */
export const crossFormatInlineTileset = {
  name: "terrain",
  tilewidth: 16,
  tileheight: 16,
  tilecount: 4,
  columns: 2,
  margin: 0,
  spacing: 0,
  imagewidth: 32,
  imageheight: 32,
  image: "terrain.png",
  tiles: [
    {
      id: 1,
      properties: [{ name: "terrain", type: "string", value: "grass" }],
      objectgroup: {
        type: "objectgroup",
        objects: [
          {
            id: 1,
            x: 0,
            y: 0,
            width: 16,
            height: 16,
          },
        ],
      },
    },
    {
      id: 2,
      properties: [{ name: "terrain", type: "string", value: "water" }],
    },
  ],
} as const;

export const crossFormatTmj = JSON.stringify({
  type: "map",
  version: "1.10",
  orientation: "orthogonal",
  width: 2,
  height: 2,
  tilewidth: 16,
  tileheight: 16,
  tilesets: [{ firstgid: 1, ...crossFormatInlineTileset }],
  layers: [
    {
      type: "tilelayer",
      name: "ground",
      width: 2,
      height: 2,
      encoding: "csv",
      data: [2, 3, 3, 2],
    },
  ],
});

export const crossFormatTmx = `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.10" orientation="orthogonal" width="2" height="2" tilewidth="16" tileheight="16">
  <tileset firstgid="1" name="terrain" tilewidth="16" tileheight="16" tilecount="4" columns="2">
    <image source="terrain.png" width="32" height="32"/>
    <tile id="1">
      <properties>
        <property name="terrain" type="string" value="grass"/>
      </properties>
      <objectgroup>
        <object id="1" x="0" y="0" width="16" height="16"/>
      </objectgroup>
    </tile>
    <tile id="2">
      <properties>
        <property name="terrain" type="string" value="water"/>
      </properties>
    </tile>
  </tileset>
  <layer id="1" name="ground" width="2" height="2">
    <data encoding="csv">2,3,3,2</data>
  </layer>
</map>`;

export const crossFormatLdtkProject = {
  jsonVersion: "1.5.3",
  iid: "verification-proj",
  identifier: "VerificationWorld",
  externalLevels: false,
  defs: {
    tags: [],
    enums: [],
    tilesets: [
      {
        uid: 1,
        identifier: "Terrain",
        relPath: "terrain.png",
        tileGridSize: 16,
        padding: 0,
        spacing: 0,
        __cWid: 2,
        __cHei: 2,
        pxWid: 32,
        pxHei: 32,
        tags: [],
        enumTags: [],
        customData: [],
        savedSelections: [],
      },
    ],
    layers: [
      {
        __type: "IntGrid",
        uid: 100,
        identifier: "TerrainGrid",
        gridSize: 16,
        intGridValues: [
          { value: 1, identifier: "grass", color: "#00ff00" },
          { value: 2, identifier: "water", color: "#0000ff" },
        ],
      },
      {
        __type: "Tiles",
        uid: 101,
        identifier: "Ground",
        gridSize: 16,
        tilesetDefUid: 1,
      },
    ],
    entities: [],
  },
  levels: [
    {
      identifier: "Level_0",
      uid: 1000,
      pxWid: 32,
      pxHei: 32,
      iid: "level-verification",
      worldDepth: 0,
      worldX: 0,
      worldY: 0,
      __bgColor: "#000000",
      __neighbours: [],
      fieldInstances: [],
      __smartColor: "#ffffff",
      bgPivotX: 0.5,
      bgPivotY: 0.5,
      useAutoIdentifier: true,
      layerInstances: [
        {
          __identifier: "TerrainGrid",
          __type: "IntGrid",
          __uid: 100,
          __gridSize: 16,
          __cWid: 2,
          __cHei: 2,
          intGridCsv: [1, 2, 2, 1],
        },
        {
          __identifier: "Ground",
          __type: "Tiles",
          __uid: 101,
          __gridSize: 16,
          __tilesetDefUid: 1,
          gridTiles: [
            { px: [0, 0], src: [16, 0], f: 0, d: [0] },
            { px: [16, 0], src: [0, 16], f: 0, d: [0] },
            { px: [0, 16], src: [0, 16], f: 0, d: [0] },
            { px: [16, 16], src: [16, 0], f: 0, d: [0] },
          ],
        },
      ],
    },
  ],
} as const;

export const crossFormatManifest = {
  schemaVersion: 1,
  id: "pack:62656465-0000-4000-8000-000000000100",
  name: "Verification Pack",
  version: "1.0.0",
  license: { spdxId: "CC0-1.0" },
  assets: [
    {
      id: "asset:62656465-0000-4000-8000-000000000101",
      path: "terrain.png",
      mime: "image/png",
    },
  ],
  terrainClasses: ["grass", "water"],
  tilesets: [
    {
      id: "tileset:62656465-0000-4000-8000-000000000102",
      name: "Terrain",
      atlasAssetId: "asset:62656465-0000-4000-8000-000000000101",
      cellSize: { width: 16, height: 16 },
      margin: 0,
      spacing: 0,
    },
  ],
  tiles: [
    {
      id: "tile:62656465-0000-4000-8000-000000000103",
      tilesetId: "tileset:62656465-0000-4000-8000-000000000102",
      uv: { x: 16, y: 0, w: 16, h: 16 },
      tags: ["grass"],
      terrainClass: "grass",
    },
    {
      id: "tile:62656465-0000-4000-8000-000000000104",
      tilesetId: "tileset:62656465-0000-4000-8000-000000000102",
      uv: { x: 0, y: 16, w: 16, h: 16 },
      tags: ["water"],
      terrainClass: "water",
    },
  ],
  animations: [],
  collisionMasks: [
    {
      tileId: "tile:62656465-0000-4000-8000-000000000103",
      mask: { _tag: "polygon", edges: [{ x1: 0, y1: 0, x2: 16, y2: 0 }], passable: false, blocksMovement: true, blocksProjectiles: true },
    },
  ],
  autotileRules: [],
  variantFilters: [],
  terrainTransitions: [],
} as const;

export const tiledSourceVerificationTsx = `<?xml version="1.0" encoding="UTF-8"?>
<tileset name="verification" tilewidth="16" tileheight="16" tilecount="4" columns="2">
  <image source="../../Tilesets/terrain.png" width="32" height="32"/>
  <tile id="1">
    <properties>
      <property name="terrain" type="string" value="grass"/>
    </properties>
  </tile>
  <tile id="2">
    <properties>
      <property name="terrain" type="string" value="water"/>
    </properties>
  </tile>
</tileset>`;

export const tiledSourceVerificationMap = `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.10" orientation="orthogonal" width="2" height="2" tilewidth="16" tileheight="16">
  <tileset firstgid="1" source="Tilesets/verification.tsx"/>
  <layer id="1" name="ground" width="2" height="2">
    <data encoding="csv">2,3,3,2</data>
  </layer>
</map>`;

export const tiledWallRuleTmx = `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.10" orientation="orthogonal" width="3" height="3" tilewidth="16" tileheight="16">
  <tileset firstgid="1" source="../Tilesets/verification.tsx"/>
  <layer id="1" name="input_walls" width="3" height="3">
    <data encoding="csv">0,1,0,1,1,1,0,1,0</data>
  </layer>
  <layer id="2" name="output_walls" width="3" height="3">
    <data encoding="csv">0,0,0,0,2,0,0,0,0</data>
  </layer>
</map>`;

export const runtimePackagingManifest = {
  schemaVersion: 1,
  id: "pack:62656465-0000-4000-8000-000000000200",
  name: "Runtime Packaging Pack",
  version: "1.0.0",
  license: { spdxId: "CC0-1.0" },
  assets: [
    {
      id: "asset:62656465-0000-4000-8000-000000000201",
      path: "atlases/large.png",
      mime: "image/png",
    },
  ],
  terrainClasses: ["grass"],
  tilesets: [
    {
      id: "tileset:62656465-0000-4000-8000-000000000202",
      name: "Large",
      atlasAssetId: "asset:62656465-0000-4000-8000-000000000201",
      cellSize: { width: 16, height: 16 },
      margin: 0,
      spacing: 0,
    },
  ],
  tiles: Array.from({ length: 12 }, (_, index) => ({
    id: `tile:62656465-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    tilesetId: "tileset:62656465-0000-4000-8000-000000000202",
    uv: { x: (index % 4) * 16, y: Math.floor(index / 4) * 16, w: 16, h: 16 },
    tags: ["grass"],
    terrainClass: "grass",
    ...(index === 0
      ? { animationId: "animation:62656465-0000-4000-8000-000000000210" }
      : {}),
  })),
  animations: [
    {
      id: "animation:62656465-0000-4000-8000-000000000210",
      frames: [
        {
          tileId: "tile:62656465-0000-4000-8000-000000000001",
          durationMs: 100,
        },
        {
          tileId: "tile:62656465-0000-4000-8000-000000000002",
          durationMs: 100,
        },
      ],
      loop: true,
    },
  ],
  collisionMasks: [],
  autotileRules: [
    {
      _tag: "wang2corner",
      tilesetId: "tileset:62656465-0000-4000-8000-000000000202",
      id: "autotile-rule:62656465-0000-4000-8000-000000000211",
      name: "grass-corner",
      terrainClasses: ["grass"],
      maskToTileIds: { "0001": ["tile:62656465-0000-4000-8000-000000000003"] },
    },
  ],
  variantFilters: [
    {
      id: "variant-filter:62656465-0000-4000-8000-000000000212",
      tilesetId: "tileset:62656465-0000-4000-8000-000000000202",
      terrainClass: "grass",
      tileIds: [
        "tile:62656465-0000-4000-8000-000000000004",
        "tile:62656465-0000-4000-8000-000000000005",
      ],
      weights: [1, 1],
      seedSalt: "layer-0",
      stableAcrossAnimationFrames: true,
    },
  ],
  terrainTransitions: [],
} as const;

export const tinyMapTileRefs = [
  "tile:62656465-0000-4000-8000-000000000001",
  "tile:62656465-0000-4000-8000-000000000002",
  "tile:62656465-0000-4000-8000-000000000003",
  "tile:62656465-0000-4000-8000-000000000004",
  "tile:62656465-0000-4000-8000-000000000005",
] as const;

export const largeMapTileRefs = [
  "tile:62656465-0000-4000-8000-000000000001",
  "tile:62656465-0000-4000-8000-000000000006",
] as const;
