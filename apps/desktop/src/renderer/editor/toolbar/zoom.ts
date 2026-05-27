export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;
export const ZOOM_STEP = 0.25;

export const ZOOM_SHORTCUTS = {
  zoomIn: '⌘=',
  zoomOut: '⌘-',
  reset: '⌘0',
} as const;

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(zoom.toFixed(2))));
}

export function zoomInFrom(current: number): number {
  return clampZoom(current + ZOOM_STEP);
}

export function zoomOutFrom(current: number): number {
  return clampZoom(current - ZOOM_STEP);
}
