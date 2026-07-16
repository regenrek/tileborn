import type { TerrainClass } from '../schemas/terrain-class.js';
import type { TileId } from '../schemas/ids.js';
import type { TilesetPack } from '../schemas/tileset-pack.js';
import type { UVRect } from '../schemas/uv-rect.js';
import type { VariantContext } from '../variants/select.js';

import { buildFrameIndex } from './frame-index.js';
import type { FrameLookupResult } from './types.js';

export type RenderGridCell = {
  readonly x: number;
  readonly y: number;
  readonly tileId: TileId;
  readonly flipH?: boolean;
  readonly flipV?: boolean;
  readonly flipD?: boolean;
};

export type RenderTileLayoutOptions = {
  readonly mapSeed?: number | string;
  readonly layerId?: string;
  readonly terrainClass?: TerrainClass;
  readonly useVariants?: boolean;
};

export type LayoutCellSnapshot = {
  readonly x: number;
  readonly y: number;
  readonly tileId: string;
  readonly resolvedTileId: string;
  readonly imageAssetId: string;
  readonly uv: UVRect;
  readonly flipH?: boolean;
  readonly flipV?: boolean;
  readonly flipD?: boolean;
  readonly animationId?: string;
  readonly sourceAssetPaths: readonly string[];
};

export type LayoutSnapshot = {
  readonly width: number;
  readonly height: number;
  readonly cells: readonly LayoutCellSnapshot[];
};

const compareCells = (left: RenderGridCell, right: RenderGridCell): number =>
  left.y === right.y ? left.x - right.x : left.y - right.y;

const withFlips = (frame: FrameLookupResult, cell: RenderGridCell): FrameLookupResult => ({
  ...frame,
  ...(cell.flipH === undefined ? {} : { flipH: cell.flipH }),
  ...(cell.flipV === undefined ? {} : { flipV: cell.flipV }),
  ...(cell.flipD === undefined ? {} : { flipD: cell.flipD }),
});

const toLayoutCell = (
  cell: RenderGridCell,
  resolvedTileId: TileId,
  frame: FrameLookupResult,
): LayoutCellSnapshot => ({
  x: cell.x,
  y: cell.y,
  tileId: String(cell.tileId),
  resolvedTileId: String(resolvedTileId),
  imageAssetId: String(frame.imageAssetId),
  uv: {
    x: frame.uv.x,
    y: frame.uv.y,
    w: frame.uv.w,
    h: frame.uv.h,
  },
  ...(frame.flipH === undefined ? {} : { flipH: frame.flipH }),
  ...(frame.flipV === undefined ? {} : { flipV: frame.flipV }),
  ...(frame.flipD === undefined ? {} : { flipD: frame.flipD }),
  ...(frame.animationId === undefined ? {} : { animationId: String(frame.animationId) }),
  sourceAssetPaths: [...frame.sourceAssetPaths],
});

/** Produce deterministic JSON describing the frames that would render for grid cells. */
export const renderTileLayout = (
  pack: TilesetPack,
  gridCells: readonly RenderGridCell[],
  options: RenderTileLayoutOptions = {},
): LayoutSnapshot => {
  const index = buildFrameIndex(pack);
  const sortedCells = [...gridCells].sort(compareCells);
  const useVariants = options.useVariants ?? false;

  const width = sortedCells.length === 0 ? 0 : Math.max(...sortedCells.map((cell) => cell.x)) + 1;
  const height = sortedCells.length === 0 ? 0 : Math.max(...sortedCells.map((cell) => cell.y)) + 1;

  const cells: LayoutCellSnapshot[] = [];

  for (const cell of sortedCells) {
    const context: VariantContext = {
      mapSeed: options.mapSeed ?? 0,
      layerId: options.layerId ?? 'layer-0',
      cellX: cell.x,
      cellY: cell.y,
      ...(options.terrainClass === undefined ? {} : { terrainClass: options.terrainClass }),
    };

    const resolvedTileId = useVariants
      ? index.resolveVariantTileId(cell.tileId, context)
      : cell.tileId;
    const frame = index.lookup(resolvedTileId);

    if (frame === undefined) {
      continue;
    }

    cells.push(toLayoutCell(cell, resolvedTileId, withFlips(frame, cell)));
  }

  return { width, height, cells };
};
