import type { TileborneMap } from '@tileborne/core';

import type { ViewportCamera } from './viewport-navigation';

export interface MinimapPan {
  readonly panX: number;
  readonly panY: number;
}

export interface MinimapViewportRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const mapPixelSize = (
  map: TileborneMap,
): { readonly width: number; readonly height: number } => ({
  width: map.size.width * map.tileSize.width,
  height: map.size.height * map.tileSize.height,
});

export const mapPointFromMinimapPosition = (
  minimapX: number,
  minimapY: number,
  minimapWidth: number,
  minimapHeight: number,
  mapWidth: number,
  mapHeight: number,
): { readonly x: number; readonly y: number } => ({
  x: Math.max(0, Math.min(mapWidth, (minimapX / minimapWidth) * mapWidth)),
  y: Math.max(0, Math.min(mapHeight, (minimapY / minimapHeight) * mapHeight)),
});

export const minimapPanForMapPoint = (
  mapX: number,
  mapY: number,
  viewportWidth: number,
  viewportHeight: number,
  zoom: number,
): MinimapPan => ({
  panX: viewportWidth / 2 - mapX * zoom,
  panY: viewportHeight / 2 - mapY * zoom,
});

export const minimapViewportRect = (
  viewportWidth: number,
  viewportHeight: number,
  mapWidth: number,
  mapHeight: number,
  camera: ViewportCamera,
  minimapWidth: number,
  minimapHeight: number,
): MinimapViewportRect | null => {
  if (
    viewportWidth <= 0 ||
    viewportHeight <= 0 ||
    mapWidth <= 0 ||
    mapHeight <= 0 ||
    camera.zoom <= 0
  ) {
    return null;
  }

  const visibleX0 = Math.max(0, -camera.panX / camera.zoom);
  const visibleY0 = Math.max(0, -camera.panY / camera.zoom);
  const visibleX1 = Math.min(mapWidth, (viewportWidth - camera.panX) / camera.zoom);
  const visibleY1 = Math.min(mapHeight, (viewportHeight - camera.panY) / camera.zoom);
  if (visibleX1 <= visibleX0 || visibleY1 <= visibleY0) {
    return null;
  }

  return {
    x: (visibleX0 / mapWidth) * minimapWidth,
    y: (visibleY0 / mapHeight) * minimapHeight,
    width: Math.max(2, ((visibleX1 - visibleX0) / mapWidth) * minimapWidth),
    height: Math.max(2, ((visibleY1 - visibleY0) / mapHeight) * minimapHeight),
  };
};

const MINIMAP_TILE_COLORS = [
  '#2f5130',
  '#3d6d39',
  '#5f7f46',
  '#8c744c',
  '#4f7485',
  '#8e6046',
  '#684e7f',
  '#bd974d',
] as const;

const tileColor = (tileIndex: number): string =>
  MINIMAP_TILE_COLORS[Math.abs(tileIndex) % MINIMAP_TILE_COLORS.length] ?? '#455047';

export const paintTileborneMinimap = (
  ctx: CanvasRenderingContext2D,
  map: TileborneMap,
  width: number,
  height: number,
): void => {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0f141f';
  ctx.fillRect(0, 0, width, height);

  const cellW = width / Math.max(1, map.size.width);
  const cellH = height / Math.max(1, map.size.height);

  for (const layer of map.layers) {
    if (layer._tag !== 'tile' || !layer.visible) {
      continue;
    }
    for (const chunk of layer.chunks) {
      for (let localY = 0; localY < chunk.height; localY += 1) {
        for (let localX = 0; localX < chunk.width; localX += 1) {
          const tileIndex = chunk.tiles[localY * chunk.width + localX] ?? 0;
          if (tileIndex <= 0) {
            continue;
          }
          const tileX = chunk.x + localX;
          const tileY = chunk.y + localY;
          if (tileX < 0 || tileY < 0 || tileX >= map.size.width || tileY >= map.size.height) {
            continue;
          }
          ctx.fillStyle = tileColor(tileIndex);
          ctx.fillRect(tileX * cellW, tileY * cellH, Math.ceil(cellW), Math.ceil(cellH));
        }
      }
    }
  }

  ctx.fillStyle = '#f59e0b';
  for (const object of map.objects) {
    const x = (object.x / (map.size.width * map.tileSize.width)) * width;
    const y = (object.y / (map.size.height * map.tileSize.height)) * height;
    ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
  }
};
