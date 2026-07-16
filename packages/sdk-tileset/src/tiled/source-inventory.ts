import type {
  TiledJsonMap,
  TiledJsonTileset,
  TiledSourceInventory,
  TiledSourceInventoryRule,
  TilesetFrameIndex,
} from './types.js';

export type TiledInventoryTilesetInput = {
  readonly tileset: TiledJsonTileset;
  readonly source?: string;
};

const explicitTiles = (
  tileset: TiledJsonTileset,
): ReadonlyMap<number, NonNullable<TiledJsonTileset['tiles']>[number]> =>
  new Map((tileset.tiles ?? []).map((tile) => [tile.id, tile] as const));

const wangSetNamesByTile = (tileset: TiledJsonTileset): ReadonlyMap<number, readonly string[]> => {
  const names = new Map<number, string[]>();
  for (const wangSet of tileset.wangsets ?? []) {
    for (const tile of wangSet.wangtiles) {
      const current = names.get(tile.tileid) ?? [];
      current.push(wangSet.name);
      names.set(tile.tileid, current);
    }
  }
  return new Map([...names.entries()].map(([tileId, values]) => [tileId, values.sort()] as const));
};

const frameIndexForTileset = (input: TiledInventoryTilesetInput): readonly TilesetFrameIndex[] => {
  const explicit = explicitTiles(input.tileset);
  const wangSetNames = wangSetNamesByTile(input.tileset);
  return Array.from({ length: input.tileset.tilecount }, (_, localTileId) => {
    const tile = explicit.get(localTileId);
    return {
      tilesetName: input.tileset.name,
      ...(input.source === undefined ? {} : { tilesetPath: input.source }),
      localTileId,
      ...(tile?.image === undefined ? {} : { image: tile.image }),
      ...(tile?.probability === undefined ? {} : { probability: tile.probability }),
      animationFrameCount: tile?.animation?.length ?? 0,
      collisionObjectCount: tile?.objectgroup?.objects.length ?? 0,
      wangSetNames: wangSetNames.get(localTileId) ?? [],
    };
  });
};

const rulesIndexKind = (path: string): TiledSourceInventoryRule['kind'] =>
  path.toLowerCase().endsWith('/rules.txt') || path.toLowerCase() === 'rules.txt'
    ? 'rules-index'
    : 'rule-map';

export const buildTiledSourceInventory = (input: {
  readonly tilesets: readonly TiledInventoryTilesetInput[];
  readonly rules?: readonly TiledSourceInventoryRule[] | readonly string[];
  readonly exampleMaps?: readonly {
    readonly path: string;
    readonly width: number;
    readonly height: number;
    readonly tileWidth: number;
    readonly tileHeight: number;
  }[];
}): TiledSourceInventory => {
  const tilesets = input.tilesets
    .map(({ tileset, source }) => {
      const tileProbabilityCount = (tileset.tiles ?? []).filter(
        (tile) => tile.probability !== undefined,
      ).length;
      const animationFrameCount = (tileset.tiles ?? []).reduce(
        (sum, tile) => sum + (tile.animation?.length ?? 0),
        0,
      );
      const collisionObjectCount = (tileset.tiles ?? []).reduce(
        (sum, tile) => sum + (tile.objectgroup?.objects.length ?? 0),
        0,
      );
      const wangColorProbabilityCount = (tileset.wangsets ?? []).reduce(
        (sum, wangSet) =>
          sum + wangSet.colors.filter((color) => color.probability !== undefined).length,
        0,
      );
      return {
        name: tileset.name,
        ...(source === undefined ? {} : { path: source }),
        kind: tileset.columns === 0 ? ('image-collection' as const) : ('grid' as const),
        tileCount: tileset.tilecount,
        frameCount: tileset.tilecount,
        imageCollectionTileCount:
          tileset.columns === 0
            ? (tileset.tiles ?? []).filter((tile) => tile.image !== undefined).length
            : 0,
        wangSetCount: tileset.wangsets?.length ?? 0,
        animationCount: (tileset.tiles ?? []).filter((tile) => (tile.animation?.length ?? 0) > 0)
          .length,
        animationFrameCount,
        tileProbabilityCount,
        wangColorProbabilityCount,
        collisionObjectCount,
      };
    })
    .sort((left, right) => (left.path ?? left.name).localeCompare(right.path ?? right.name));
  const frames = input.tilesets
    .flatMap(frameIndexForTileset)
    .sort(
      (left, right) =>
        (left.tilesetPath ?? left.tilesetName).localeCompare(
          right.tilesetPath ?? right.tilesetName,
        ) || left.localTileId - right.localTileId,
    );
  const rules = (input.rules ?? [])
    .map((rule) => (typeof rule === 'string' ? { path: rule, kind: rulesIndexKind(rule) } : rule))
    .sort((left, right) => left.path.localeCompare(right.path));
  const exampleMaps = [...(input.exampleMaps ?? [])].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  return {
    summary: {
      tilesetCount: tilesets.length,
      tileCount: tilesets.reduce((sum, tileset) => sum + tileset.tileCount, 0),
      frameCount: frames.length,
      imageCollectionTileCount: tilesets.reduce(
        (sum, tileset) => sum + tileset.imageCollectionTileCount,
        0,
      ),
      wangSetCount: tilesets.reduce((sum, tileset) => sum + tileset.wangSetCount, 0),
      animationCount: tilesets.reduce((sum, tileset) => sum + tileset.animationCount, 0),
      animationFrameCount: tilesets.reduce((sum, tileset) => sum + tileset.animationFrameCount, 0),
      tileProbabilityCount: tilesets.reduce(
        (sum, tileset) => sum + tileset.tileProbabilityCount,
        0,
      ),
      wangColorProbabilityCount: tilesets.reduce(
        (sum, tileset) => sum + tileset.wangColorProbabilityCount,
        0,
      ),
      collisionObjectCount: tilesets.reduce(
        (sum, tileset) => sum + tileset.collisionObjectCount,
        0,
      ),
      ruleMapCount: rules.filter((rule) => rule.kind === 'rule-map').length,
      rulesIndexCount: rules.filter((rule) => rule.kind === 'rules-index').length,
      exampleMapCount: exampleMaps.length,
    },
    tilesets,
    frames,
    rules,
    exampleMaps,
  };
};

export const mapInventoryEntry = (path: string, map: TiledJsonMap) => ({
  path,
  width: map.width,
  height: map.height,
  tileWidth: map.tilewidth,
  tileHeight: map.tileheight,
});
