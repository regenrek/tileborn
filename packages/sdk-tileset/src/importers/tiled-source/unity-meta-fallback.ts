import { Option } from 'effect';

import { Animation, AnimationFrame } from '../../schemas/animation.js';
import { Tile } from '../../schemas/tile.js';
import { Tileset } from '../../schemas/tileset.js';
import type { TiledJsonTileset } from '../../tiled/types.js';
import { deterministicAnimationId } from '../../tiled/deterministic-ids.js';
import type { UnityMetaSprite } from '../../metadata/types.js';

type PartialSprite = {
  name?: string;
  rect?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
};

const pushCompleteSprite = (
  sprites: UnityMetaSprite[],
  current: PartialSprite | undefined,
): void => {
  if (
    current?.name === undefined ||
    current.rect?.x === undefined ||
    current.rect.y === undefined ||
    current.rect.width === undefined ||
    current.rect.height === undefined
  ) {
    return;
  }

  sprites.push({
    name: current.name,
    rect: {
      x: current.rect.x,
      y: current.rect.y,
      width: current.rect.width,
      height: current.rect.height,
    },
  });
};

const readNumber = (line: string, key: string): number | undefined => {
  const match = new RegExp(`^\\s*${key}:\\s*(-?\\d+(?:\\.\\d+)?)\\s*$`).exec(line);
  return match?.[1] === undefined ? undefined : Number(match[1]);
};

/** Parse the subset of Unity TextureImporter `.meta` files needed for sprite slicing fallback. */
export const parseUnityMetaSprites = (raw: string): readonly UnityMetaSprite[] => {
  const sprites: UnityMetaSprite[] = [];
  let inSprites = false;
  let inRect = false;
  let current: PartialSprite | undefined;

  for (const line of raw.split(/\r?\n/)) {
    if (/^\s*sprites:\s*$/.test(line)) {
      inSprites = true;
      continue;
    }
    if (!inSprites) {
      continue;
    }
    if (/^\s*outline:/.test(line) || /^\s*physicsShape:/.test(line)) {
      inRect = false;
    }
    if (/^\s*-\s+serializedVersion:/.test(line)) {
      pushCompleteSprite(sprites, current);
      current = {};
      inRect = false;
      continue;
    }
    const nameMatch = /^\s*name:\s*(.+?)\s*$/.exec(line);
    if (nameMatch?.[1] !== undefined && current !== undefined) {
      current.name = nameMatch[1];
      continue;
    }
    if (/^\s*rect:\s*$/.test(line) && current !== undefined) {
      current.rect = {};
      inRect = true;
      continue;
    }
    if (!inRect || current?.rect === undefined) {
      continue;
    }

    const x = readNumber(line, 'x');
    const y = readNumber(line, 'y');
    const width = readNumber(line, 'width');
    const height = readNumber(line, 'height');
    if (x !== undefined) current.rect.x = x;
    if (y !== undefined) current.rect.y = y;
    if (width !== undefined) current.rect.width = width;
    if (height !== undefined) current.rect.height = height;
  }

  pushCompleteSprite(sprites, current);
  return sprites;
};

const animationGroupKey = (
  name: string,
): { readonly prefix: string; readonly order: number } | undefined => {
  const match = /^(.*?)[_\-\s]?(\d+)$/.exec(name);
  if (match?.[1] === undefined || match[2] === undefined) {
    return undefined;
  }
  return { prefix: match[1] || name, order: Number(match[2]) };
};

const localTileIndexForSprite = (
  sprite: UnityMetaSprite,
  source: TiledJsonTileset,
): number | undefined => {
  if (source.columns <= 0 || source.imageheight === undefined) {
    return undefined;
  }

  const margin = source.margin ?? 0;
  const spacing = source.spacing ?? 0;
  const strideX = source.tilewidth + spacing;
  const strideY = source.tileheight + spacing;
  const topLeftY = source.imageheight - sprite.rect.y - sprite.rect.height;
  const column = Math.round((sprite.rect.x - margin) / strideX);
  const row = Math.round((topLeftY - margin) / strideY);
  const index = row * source.columns + column;

  return Number.isSafeInteger(index) && index >= 0 && index < source.tilecount ? index : undefined;
};

const tileHasAnimation = (tile: Tile): boolean =>
  Option.match(tile.animation, {
    onNone: () => false,
    onSome: () => true,
  });

export const applyUnityMetaAnimationFallback = (input: {
  readonly tileset: Tileset;
  readonly source: TiledJsonTileset;
  readonly sourcePath: string;
  readonly sprites: readonly UnityMetaSprite[];
}): { readonly tileset: Tileset; readonly applied: number } => {
  const tileByIndex = new Map(input.tileset.tiles.map((tile, index) => [index, tile] as const));
  const groups = new Map<string, Array<{ readonly order: number; readonly localTileId: number }>>();

  for (const sprite of input.sprites) {
    const group = animationGroupKey(sprite.name);
    const localTileId = localTileIndexForSprite(sprite, input.source);
    if (group === undefined || localTileId === undefined) {
      continue;
    }
    const entries = groups.get(group.prefix) ?? [];
    entries.push({ order: group.order, localTileId });
    groups.set(group.prefix, entries);
  }

  const animationByTileIndex = new Map<number, Animation>();
  for (const [prefix, entries] of groups) {
    const sorted = [...entries].sort((left, right) => left.order - right.order);
    if (sorted.length < 2) {
      continue;
    }
    const firstTile = tileByIndex.get(sorted[0]!.localTileId);
    if (firstTile === undefined || tileHasAnimation(firstTile)) {
      continue;
    }
    const frames = sorted.flatMap((entry) => {
      const tile = tileByIndex.get(entry.localTileId);
      return tile === undefined ? [] : [new AnimationFrame({ tileId: tile.id, durationMs: 100 })];
    });
    if (frames.length === 0) {
      continue;
    }
    animationByTileIndex.set(
      sorted[0]!.localTileId,
      new Animation({
        id: deterministicAnimationId(`${input.sourcePath}/unity-meta/${prefix}`),
        loop: true,
        frames: frames as [AnimationFrame, ...AnimationFrame[]],
      }),
    );
  }

  if (animationByTileIndex.size === 0) {
    return { tileset: input.tileset, applied: 0 };
  }

  return {
    applied: animationByTileIndex.size,
    tileset: new Tileset({
      id: input.tileset.id,
      name: input.tileset.name,
      atlasAssetId: input.tileset.atlasAssetId,
      cellSize: input.tileset.cellSize,
      margin: input.tileset.margin,
      spacing: input.tileset.spacing,
      tiles: input.tileset.tiles.map((tile, localTileId) => {
        const animation = animationByTileIndex.get(localTileId);
        return animation === undefined
          ? tile
          : new Tile({
              id: tile.id,
              uv: tile.uv,
              tags: tile.tags,
              terrainClass: tile.terrainClass,
              collisionMask: tile.collisionMask,
              animation: Option.some(animation),
            });
      }),
      autotileRules: input.tileset.autotileRules,
      variantFilters: input.tileset.variantFilters,
      terrainTransitions: input.tileset.terrainTransitions,
    }),
  };
};
