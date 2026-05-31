import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { TileborneMap } from '@tileborne/core';
import { cn, elevation, typography } from '@tileborne/ui';

import {
  mapPixelSize,
  mapPointFromMinimapPosition,
  minimapPanForMapPoint,
  minimapViewportRect,
  paintTileborneMinimap,
} from '@/editor/viewport/editor-minimap';
import type { ViewportCamera } from '@/editor/viewport/viewport-navigation';

interface MapEditorMinimapProps {
  readonly map: TileborneMap;
  readonly camera: ViewportCamera;
  readonly viewportRef: RefObject<HTMLDivElement | null>;
  readonly onCameraChange: (camera: Partial<ViewportCamera>) => void;
}

const MINIMAP_WIDTH = 156;
const MINIMAP_HEIGHT = 118;

export function MapEditorMinimap({
  map,
  camera,
  viewportRef,
  onCameraChange,
}: MapEditorMinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });

  const mapSize = useMemo(() => mapPixelSize(map), [map]);
  const viewportRect = minimapViewportRect(
    viewportSize.width,
    viewportSize.height,
    mapSize.width,
    mapSize.height,
    camera,
    MINIMAP_WIDTH,
    MINIMAP_HEIGHT,
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      setViewportSize({ width: 0, height: 0 });
      return;
    }

    const update = () => {
      setViewportSize({ width: viewport.clientWidth, height: viewport.clientHeight });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [viewportRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) {
      return;
    }
    paintTileborneMinimap(ctx, map, MINIMAP_WIDTH, MINIMAP_HEIGHT);
  }, [map]);

  const panFromEvent = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (viewportSize.width <= 0 || viewportSize.height <= 0) {
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = mapPointFromMinimapPosition(
      event.clientX - bounds.left,
      event.clientY - bounds.top,
      MINIMAP_WIDTH,
      MINIMAP_HEIGHT,
      mapSize.width,
      mapSize.height,
    );
    onCameraChange(
      minimapPanForMapPoint(
        point.x,
        point.y,
        viewportSize.width,
        viewportSize.height,
        camera.zoom,
      ),
    );
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dragPointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    panFromEvent(event);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragPointerIdRef.current !== event.pointerId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    panFromEvent(event);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragPointerIdRef.current !== event.pointerId) {
      return;
    }
    dragPointerIdRef.current = null;
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      className={cn(
        'pointer-events-auto absolute right-4 top-4 z-10 overflow-hidden rounded-xl border border-border bg-sidebar/90 p-1.5 shadow-md backdrop-blur-sm',
        elevation.md,
      )}
      data-viewport-overlay="minimap"
      data-testid="map-editor-minimap"
      title="Minimap - click or drag to jump the view"
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="relative">
        <canvas
          ref={canvasRef}
          width={MINIMAP_WIDTH}
          height={MINIMAP_HEIGHT}
          className="block rounded-md border border-border/70 bg-muted/40"
          aria-label="Map minimap"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
        {viewportRect ? (
          <span
            className="pointer-events-none absolute rounded-sm border border-primary bg-primary/15 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
            style={{
              left: viewportRect.x,
              top: viewportRect.y,
              width: viewportRect.width,
              height: viewportRect.height,
            }}
          />
        ) : null}
        <span
          className={cn(
            'pointer-events-none absolute bottom-1 left-1 rounded bg-background/80 px-1 text-foreground/80',
            typography.micro,
          )}
        >
          MAP
        </span>
      </div>
    </div>
  );
}
