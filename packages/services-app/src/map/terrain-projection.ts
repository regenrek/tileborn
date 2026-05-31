import { TileChunk, TileLayer, type JsonObject, type MapLayer } from '@tileborne/core';
import type {
  AssetSemanticRole,
  AssetSemanticRoleNameType,
  Tile,
  TileIdType,
  Tileset,
  TilesetIdType,
  TilesetPack,
} from '@tileborne/sdk-tileset/schemas';

export type GeneratedTerrainSemantic = Extract<AssetSemanticRoleNameType, 'floor' | 'wall' | 'path'>;

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
  readonly roles: readonly AssetSemanticRole[];
}

const semanticValue = (tileValue: number): GeneratedTerrainSemantic | undefined => {
  if (tileValue === 1) return 'floor';
  if (tileValue === 2) return 'wall';
  if (tileValue > 2) return 'path';
  return undefined;
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

const rolePriority = (role: AssetSemanticRole): number =>
  role.source === 'user' ? role.confidence + 1 : role.confidence;

const chooseTile = (
  semantic: GeneratedTerrainSemantic,
  candidates: readonly TileCandidate[],
): ProjectedTerrainTile | undefined => {
  const ranked = candidates
    .flatMap((candidate) =>
      candidate.roles
        .filter((role) => role.role === semantic)
        .map((role) => ({ candidate, score: rolePriority(role) })),
    )
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
  const rolesByTileId = new Map<string, AssetSemanticRole[]>();
  for (const role of pack.semanticRoles ?? []) {
    const key = String(role.tileId);
    const roles = rolesByTileId.get(key) ?? [];
    roles.push(role);
    rolesByTileId.set(key, roles);
  }
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
        roles: rolesByTileId.get(String(tile.id)) ?? [],
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
      message: 'Could not resolve a floor semantic role from the selected pack.',
    });
  }
  if (required.has('wall') && wall === undefined) {
    diagnostics.push({
      severity: 'error',
      code: 'TERRAIN_PROJECTION.no-wall-tile',
      message: 'Could not resolve a wall semantic role from the selected pack.',
    });
  }
  if (required.has('path') && path === undefined) {
    diagnostics.push({
      severity: 'warning',
      code: 'TERRAIN_PROJECTION.no-path-tile',
      message: 'Could not resolve a path semantic role; generated path cells will use the floor role.',
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
