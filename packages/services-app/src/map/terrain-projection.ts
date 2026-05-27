import { TileChunk, TileLayer, type JsonObject, type MapLayer } from '@tileborne/core';
import type {
  Tile,
  TileIdType,
  Tileset,
  TilesetIdType,
  TilesetPack,
} from '@tileborne/sdk-tileset/schemas';

export type GeneratedTerrainSemantic = 'floor' | 'wall' | 'path';

export interface TerrainProjectionDiagnostic {
  readonly severity: 'warning' | 'error';
  readonly code: string;
  readonly message: string;
}

export interface ProjectedTerrainTile {
  readonly semantic: GeneratedTerrainSemantic;
  readonly tileIndex: number;
  readonly tileId: TileIdType;
  readonly tilesetId: TilesetIdType;
  readonly tilesetName: string;
  readonly atlasAssetPath: string;
}

export interface GeneratedTerrainProjection {
  readonly layers: readonly MapLayer[];
  readonly properties: JsonObject;
  readonly floor: ProjectedTerrainTile | undefined;
  readonly wall: ProjectedTerrainTile | undefined;
  readonly path: ProjectedTerrainTile | undefined;
  readonly diagnostics: readonly TerrainProjectionDiagnostic[];
}

interface TileCandidate {
  readonly tile: Tile;
  readonly tileset: Tileset;
  readonly tileIndex: number;
  readonly atlasAssetPath: string;
  readonly searchText: string;
}

const semanticValue = (tileValue: number): GeneratedTerrainSemantic | undefined => {
  if (tileValue === 1) return 'floor';
  if (tileValue === 2) return 'wall';
  if (tileValue > 2) return 'path';
  return undefined;
};

const isTransparentLike = (text: string): boolean =>
  /\btransp\b|transparent|transparency|with transparency/.test(text);

const isPropLike = (text: string): boolean => /\bprop\b|\bprops\b|\bsprite\b|\bsprites\b/.test(text);

const isWaterLike = (text: string): boolean => /\bwater\b|\bwaterfall\b/.test(text);

const isAnimatedLike = (text: string): boolean => /\banimated\b|\bframes\b/.test(text);

const isWallLike = (text: string): boolean => /\bwall\b|wall-/.test(text);

const isTerrainLike = (text: string): boolean =>
  /\bterrain\b|\bfloor\b|\bground\b|\bpath\b|\bruin\b/.test(text);

const isAtlasOriginTile = (candidate: TileCandidate): boolean =>
  candidate.tile.uv.x === 0 && candidate.tile.uv.y === 0;

const hasBlockingTerrainPenalty = (candidate: TileCandidate): boolean =>
  isPropLike(candidate.searchText) ||
  isTransparentLike(candidate.searchText) ||
  isWaterLike(candidate.searchText);

const scoreFloor = (candidate: TileCandidate): number => {
  if (hasBlockingTerrainPenalty(candidate) || isWallLike(candidate.searchText)) {
    return Number.NEGATIVE_INFINITY;
  }
  let score = 0;
  if (isTerrainLike(candidate.tileset.name.toLowerCase())) score += 120;
  if (isTerrainLike(candidate.searchText)) score += 40;
  if (!isAnimatedLike(candidate.searchText)) score += 20;
  if (isAtlasOriginTile(candidate)) score -= 5;
  return score;
};

const scoreWall = (candidate: TileCandidate): number => {
  if (
    isPropLike(candidate.searchText) ||
    isTransparentLike(candidate.searchText) ||
    isWaterLike(candidate.searchText) ||
    !isWallLike(candidate.searchText)
  ) {
    return Number.NEGATIVE_INFINITY;
  }
  let score = 100;
  const tilesetName = candidate.tileset.name.toLowerCase();
  if (/\bwall-?1\b/.test(tilesetName)) score += 40;
  if (/^wall\b|^wall-/.test(tilesetName)) score += 20;
  if (!isAnimatedLike(candidate.searchText)) score += 10;
  if (isAtlasOriginTile(candidate)) score -= 5;
  return score;
};

const toProjectedTile = (
  semantic: GeneratedTerrainSemantic,
  candidate: TileCandidate,
): ProjectedTerrainTile => ({
  semantic,
  tileIndex: candidate.tileIndex,
  tileId: candidate.tile.id,
  tilesetId: candidate.tileset.id,
  tilesetName: candidate.tileset.name,
  atlasAssetPath: candidate.atlasAssetPath,
});

const chooseTile = (
  semantic: GeneratedTerrainSemantic,
  candidates: readonly TileCandidate[],
): ProjectedTerrainTile | undefined => {
  const scorer = semantic === 'wall' ? scoreWall : scoreFloor;
  const ranked = candidates
    .map((candidate) => ({ candidate, score: scorer(candidate) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) =>
      right.score === left.score
        ? left.candidate.tileIndex - right.candidate.tileIndex
        : right.score - left.score,
    );
  const best = ranked[0]?.candidate;
  return best === undefined ? undefined : toProjectedTile(semantic, best);
};

const collectCandidates = (pack: TilesetPack): readonly TileCandidate[] => {
  const assetPathById = new Map(pack.assets.map((asset) => [String(asset.id), asset.path]));
  const candidates: TileCandidate[] = [];
  let tileIndex = 1;
  for (const tileset of pack.tilesets) {
    const atlasAssetPath = assetPathById.get(String(tileset.atlasAssetId)) ?? String(tileset.atlasAssetId);
    for (const tile of tileset.tiles) {
      candidates.push({
        tile,
        tileset,
        tileIndex,
        atlasAssetPath,
        searchText: [tileset.name, atlasAssetPath, ...tile.tags].join(' ').toLowerCase(),
      });
      tileIndex += 1;
    }
  }
  return candidates;
};

const collectRequiredSemantics = (layers: readonly MapLayer[]): ReadonlySet<GeneratedTerrainSemantic> => {
  const required = new Set<GeneratedTerrainSemantic>();
  for (const layer of layers) {
    if (layer._tag !== 'tile' || layer.name !== 'terrain') {
      continue;
    }
    for (const chunk of layer.chunks) {
      for (const tile of chunk.tiles) {
        const semantic = semanticValue(tile);
        if (semantic !== undefined) {
          required.add(semantic);
        }
      }
    }
  }
  return required;
};

const replaceTerrainTiles = (
  chunk: TileChunk,
  bySemantic: Readonly<Record<GeneratedTerrainSemantic, ProjectedTerrainTile | undefined>>,
): TileChunk =>
  new TileChunk({
    x: chunk.x,
    y: chunk.y,
    width: chunk.width,
    height: chunk.height,
    tiles: chunk.tiles.map((tile) => {
      const semantic = semanticValue(tile);
      return semantic === undefined ? tile : (bySemantic[semantic]?.tileIndex ?? 0);
    }),
  });

const projectionProperty = (input: {
  readonly packId: string;
  readonly preset: string;
  readonly seed: number;
  readonly floor: ProjectedTerrainTile | undefined;
  readonly wall: ProjectedTerrainTile | undefined;
  readonly path: ProjectedTerrainTile | undefined;
  readonly diagnostics: readonly TerrainProjectionDiagnostic[];
}): JsonObject => ({
  schemaVersion: 1,
  kind: 'generated-terrain-v1',
  tilesetPackId: input.packId,
  preset: input.preset,
  seed: input.seed,
  semantics: {
    ...(input.floor === undefined ? {} : { floor: input.floor as unknown as JsonObject }),
    ...(input.wall === undefined ? {} : { wall: input.wall as unknown as JsonObject }),
    ...(input.path === undefined ? {} : { path: input.path as unknown as JsonObject }),
  },
  diagnostics: input.diagnostics as unknown as readonly JsonObject[],
});

export const projectGeneratedTerrainLayers = (input: {
  readonly layers: readonly MapLayer[];
  readonly pack: TilesetPack;
  readonly preset: string;
  readonly seed: number;
}): GeneratedTerrainProjection => {
  const candidates = collectCandidates(input.pack);
  const floor = chooseTile('floor', candidates);
  const wall = chooseTile('wall', candidates);
  const path = chooseTile('path', candidates) ?? floor;
  const required = collectRequiredSemantics(input.layers);
  const diagnostics: TerrainProjectionDiagnostic[] = [];

  if (required.has('floor') && floor === undefined) {
    diagnostics.push({
      severity: 'error',
      code: 'TERRAIN_PROJECTION.no-floor-tile',
      message: 'Could not resolve a non-transparent terrain/floor tile from the selected pack.',
    });
  }
  if (required.has('wall') && wall === undefined) {
    diagnostics.push({
      severity: 'error',
      code: 'TERRAIN_PROJECTION.no-wall-tile',
      message: 'Could not resolve a non-transparent wall tile from the selected pack.',
    });
  }
  if (required.has('path') && path === undefined) {
    diagnostics.push({
      severity: 'warning',
      code: 'TERRAIN_PROJECTION.no-path-tile',
      message: 'Could not resolve a path tile; generated path cells will use the floor tile.',
    });
  }

  const bySemantic = { floor, wall, path };
  const canProject = !diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  const layers = canProject
    ? input.layers.map((layer) =>
        layer._tag === 'tile' && layer.name === 'terrain'
          ? new TileLayer({
              id: layer.id,
              name: layer.name,
              visible: layer.visible,
              opacity: layer.opacity,
              chunks: layer.chunks.map((chunk) => replaceTerrainTiles(chunk, bySemantic)),
            })
          : layer,
      )
    : input.layers;

  return {
    layers,
    floor,
    wall,
    path,
    diagnostics,
    properties: projectionProperty({
      packId: input.pack.id,
      preset: input.preset,
      seed: input.seed,
      floor,
      wall,
      path,
      diagnostics,
    }),
  };
};
