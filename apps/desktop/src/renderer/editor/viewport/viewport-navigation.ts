import { clampZoom } from '@/editor/toolbar/zoom';

export interface ViewportCamera {
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
}

export interface ViewportBounds {
  readonly left: number;
  readonly top: number;
}

export const wheelDeltaPixels = (delta: number, deltaMode: number): number => {
  if (deltaMode === 1) {
    return delta * 16;
  }
  if (deltaMode === 2) {
    return delta * 800;
  }
  return delta;
};

export const zoomCameraAtClientPoint = (
  camera: ViewportCamera,
  bounds: ViewportBounds,
  clientX: number,
  clientY: number,
  nextZoomInput: number,
): ViewportCamera => {
  const nextZoom = clampZoom(nextZoomInput);
  const localX = clientX - bounds.left;
  const localY = clientY - bounds.top;
  const worldX = (localX - camera.panX) / camera.zoom;
  const worldY = (localY - camera.panY) / camera.zoom;

  return {
    zoom: nextZoom,
    panX: localX - worldX * nextZoom,
    panY: localY - worldY * nextZoom,
  };
};

export const zoomCameraByWheel = (
  camera: ViewportCamera,
  bounds: ViewportBounds,
  clientX: number,
  clientY: number,
  deltaY: number,
): ViewportCamera => {
  const zoomMultiplier = Math.exp(-deltaY * 0.002);
  return zoomCameraAtClientPoint(camera, bounds, clientX, clientY, camera.zoom * zoomMultiplier);
};
