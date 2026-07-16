import type { PointerEvent as ReactPointerEvent } from 'react';
import { useMemo, useState } from 'react';
import { Button, Input, Label, cn, typography } from '@tileborne/ui';
import { RotateCcwIcon, ZoomInIcon, ZoomOutIcon } from 'lucide-react';

export interface NormalizedPoint {
  readonly x: number;
  readonly y: number;
}

export interface NormalizedRect extends NormalizedPoint {
  readonly width: number;
  readonly height: number;
}

export type SpriteGeometryHandleKind = 'pivot' | 'hand' | 'anchor';

export interface SpriteGeometryHandle {
  readonly id: string;
  readonly label: string;
  readonly kind: SpriteGeometryHandleKind;
  readonly point: NormalizedPoint;
  /** Optional authored facing/attachment direction, visualized from the handle. */
  readonly rotationDeg?: number | undefined;
}

export type SpriteGeometryRectKind = 'hitbox' | 'footprint';

export interface SpriteGeometryRect {
  readonly id: string;
  readonly label: string;
  readonly kind: SpriteGeometryRectKind;
  readonly rect: NormalizedRect;
}

export interface SpriteGeometryFrameOption {
  readonly id: string;
  readonly label: string;
}

interface ViewportState {
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
}

export interface SpriteGeometryCanvasProps {
  readonly title: string;
  readonly imageUrl?: string | undefined;
  readonly handles: readonly SpriteGeometryHandle[];
  readonly rects?: readonly SpriteGeometryRect[] | undefined;
  readonly frames?: readonly SpriteGeometryFrameOption[] | undefined;
  readonly activeFrameId?: string | undefined;
  readonly snapStep?: number | undefined;
  readonly onHandleChange: (id: string, point: NormalizedPoint) => void;
  readonly onHandleRotationChange?: (id: string, rotationDeg: number) => void;
  readonly onRectChange?: (id: string, rect: NormalizedRect) => void;
  readonly onFrameChange?: (frameId: string) => void;
  readonly onResetDefaults?: () => void;
}

const HANDLE_COLORS: Record<SpriteGeometryHandleKind, string> = {
  pivot: '#38bdf8',
  hand: '#f97316',
  anchor: '#a78bfa',
};

const RECT_COLORS: Record<SpriteGeometryRectKind, string> = {
  hitbox: '#22c55e',
  footprint: '#eab308',
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const clampZoom = (value: number): number => Math.max(0.5, Math.min(8, value));

const snap = (value: number, step: number | undefined): number => {
  if (step === undefined || step <= 0) {
    return value;
  }
  return Math.round(value / step) * step;
};

const percent = (value: number): number => clamp01(value) * 100;

const numberFromInput = (value: string, min: number, max: number): number => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : min;
};

const rectPatch = (
  rect: NormalizedRect,
  patch: Partial<NormalizedRect>,
): NormalizedRect => {
  const next = {
    ...rect,
    ...patch,
  };
  return {
    x: clamp01(next.x),
    y: clamp01(next.y),
    width: clamp01(next.width),
    height: clamp01(next.height),
  };
};

export function SpriteGeometryCanvas({
  title,
  imageUrl,
  handles,
  rects = [],
  frames = [],
  activeFrameId,
  snapStep,
  onHandleChange,
  onHandleRotationChange,
  onRectChange,
  onFrameChange,
  onResetDefaults,
}: SpriteGeometryCanvasProps) {
  const [dragHandleId, setDragHandleId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<ViewportState>({ zoom: 1, panX: 0, panY: 0 });
  const viewBox = useMemo(() => {
    const size = 100 / viewport.zoom;
    const origin = (100 - size) / 2;
    return `${origin + viewport.panX} ${origin + viewport.panY} ${size} ${size}`;
  }, [viewport]);

  const pointFromPointer = (event: ReactPointerEvent<SVGSVGElement>): NormalizedPoint => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const size = 100 / viewport.zoom;
    const origin = (100 - size) / 2;
    const rawX = origin + viewport.panX + ((event.clientX - bounds.left) / bounds.width) * size;
    const rawY = origin + viewport.panY + ((event.clientY - bounds.top) / bounds.height) * size;
    return {
      x: clamp01(snap(rawX / 100, snapStep)),
      y: clamp01(snap(rawY / 100, snapStep)),
    };
  };

  const updateZoom = (delta: number) => {
    setViewport((current) => ({ ...current, zoom: clampZoom(current.zoom + delta) }));
  };

  const updatePan = (patch: Partial<Pick<ViewportState, 'panX' | 'panY'>>) => {
    setViewport((current) => ({ ...current, ...patch }));
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGElement>, id: string) => {
    event.preventDefault();
    setDragHandleId(id);
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic test events may not have a browser pointer capture target.
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (dragHandleId === null) {
      return;
    }
    onHandleChange(dragHandleId, pointFromPointer(event));
  };

  const releasePointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    setDragHandleId(null);
    try {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // See pointer capture note in handlePointerDown.
    }
  };

  return (
    <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(20rem,1fr)_18rem]" data-testid="sprite-geometry-canvas">
      <div className="flex min-h-[26rem] min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
          <div className="min-w-0">
            <h2 className={typography.panelTitle}>{title}</h2>
            <p className={typography.rowMeta}>Zoom {viewport.zoom.toFixed(2)}x</p>
          </div>
          <div className="flex items-center gap-1">
            {frames.length > 0 ? (
              <select
                value={activeFrameId ?? frames[0]?.id ?? ''}
                onChange={(event) => onFrameChange?.(event.currentTarget.value)}
                className="h-7 rounded-md border border-input bg-background px-2 text-xs"
                data-testid="sprite-geometry-frame"
                aria-label="Frame"
              >
                {frames.map((frame) => (
                  <option key={frame.id} value={frame.id}>
                    {frame.label}
                  </option>
                ))}
              </select>
            ) : null}
            <Button type="button" variant="outline" size="icon-sm" onClick={() => updateZoom(-0.25)} aria-label="Zoom out">
              <ZoomOutIcon className="size-3.5" aria-hidden />
            </Button>
            <Button type="button" variant="outline" size="icon-sm" onClick={() => updateZoom(0.25)} aria-label="Zoom in">
              <ZoomInIcon className="size-3.5" aria-hidden />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={onResetDefaults}
              disabled={onResetDefaults === undefined}
              aria-label="Reset defaults"
              data-testid="sprite-geometry-reset"
            >
              <RotateCcwIcon className="size-3.5" aria-hidden />
            </Button>
          </div>
        </div>

        <div
          className="relative min-h-0 flex-1 touch-none overflow-hidden"
          style={{
            backgroundColor: 'hsl(var(--muted))',
            backgroundImage:
              'linear-gradient(45deg, rgba(255,255,255,.08) 25%, transparent 25%), linear-gradient(-45deg, rgba(255,255,255,.08) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(255,255,255,.08) 75%), linear-gradient(-45deg, transparent 75%, rgba(255,255,255,.08) 75%)',
            backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
            backgroundSize: '16px 16px',
          }}
        >
          <svg
            role="img"
            aria-label={`${title} geometry canvas`}
            viewBox={viewBox}
            className="h-full w-full"
            data-testid="sprite-geometry-stage"
            onPointerMove={handlePointerMove}
            onPointerUp={releasePointer}
            onPointerCancel={releasePointer}
            onWheel={(event) => {
              event.preventDefault();
              updateZoom(event.deltaY < 0 ? 0.25 : -0.25);
            }}
          >
            <rect x="0" y="0" width="100" height="100" fill="rgba(12, 16, 24, 0.88)" />
            {imageUrl === undefined ? null : (
              <image href={imageUrl} x="0" y="0" width="100" height="100" preserveAspectRatio="xMidYMid meet" />
            )}
            <rect x="0" y="0" width="100" height="100" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="0.5" />
            {rects.map((entry) => (
              <rect
                key={entry.id}
                x={percent(entry.rect.x)}
                y={percent(entry.rect.y)}
                width={percent(entry.rect.width)}
                height={percent(entry.rect.height)}
                fill={`${RECT_COLORS[entry.kind]}33`}
                stroke={RECT_COLORS[entry.kind]}
                strokeWidth="1"
                data-testid={`sprite-geometry-rect-${entry.id}`}
              />
            ))}
            {handles.map((handle) => {
              const radians = ((handle.rotationDeg ?? 0) * Math.PI) / 180;
              const originX = percent(handle.point.x);
              const originY = percent(handle.point.y);
              const directionX = originX + Math.cos(radians) * 12;
              const directionY = originY + Math.sin(radians) * 12;
              return (
              <g key={handle.id} data-testid={`sprite-geometry-handle-${handle.id}`}>
                <line
                  x1={percent(handle.point.x)}
                  y1="0"
                  x2={percent(handle.point.x)}
                  y2="100"
                  stroke={HANDLE_COLORS[handle.kind]}
                  strokeOpacity="0.35"
                  strokeWidth="0.35"
                />
                <line
                  x1="0"
                  y1={percent(handle.point.y)}
                  x2="100"
                  y2={percent(handle.point.y)}
                  stroke={HANDLE_COLORS[handle.kind]}
                  strokeOpacity="0.35"
                  strokeWidth="0.35"
                />
                <circle
                  cx={percent(handle.point.x)}
                  cy={percent(handle.point.y)}
                  r="2.5"
                  fill={HANDLE_COLORS[handle.kind]}
                  stroke="rgba(0,0,0,.65)"
                  strokeWidth="0.65"
                  onPointerDown={(event) => handlePointerDown(event, handle.id)}
                  className="cursor-grab active:cursor-grabbing"
                />
                {handle.rotationDeg === undefined ? null : (
                  <g data-testid={`sprite-geometry-direction-${handle.id}`}>
                    <line
                      x1={originX}
                      y1={originY}
                      x2={directionX}
                      y2={directionY}
                      stroke={HANDLE_COLORS[handle.kind]}
                      strokeWidth="1.2"
                    />
                    <circle cx={directionX} cy={directionY} r="1.4" fill={HANDLE_COLORS[handle.kind]} />
                  </g>
                )}
              </g>
              );
            })}
          </svg>
        </div>
      </div>

      <aside className="min-w-0 space-y-3 rounded-md border border-border bg-card p-3" data-testid="sprite-geometry-fields">
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Pan X" value={viewport.panX} min={-50} max={50} step={1} onChange={(panX) => updatePan({ panX })} />
          <NumberField label="Pan Y" value={viewport.panY} min={-50} max={50} step={1} onChange={(panY) => updatePan({ panY })} />
        </div>

        <div className="space-y-2">
          <p className={typography.sectionLabelMicro}>Handles</p>
          {handles.map((handle) => (
            <div key={handle.id} className="rounded-md border border-border bg-background p-2">
              <p className={cn('truncate', typography.rowTitle)}>{handle.label}</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <NumberField
                  label="X"
                  value={handle.point.x}
                  min={0}
                  max={1}
                  step={snapStep ?? 0.01}
                  onChange={(x) => onHandleChange(handle.id, { ...handle.point, x })}
                />
                <NumberField
                  label="Y"
                  value={handle.point.y}
                  min={0}
                  max={1}
                  step={snapStep ?? 0.01}
                  onChange={(y) => onHandleChange(handle.id, { ...handle.point, y })}
                />
                {handle.rotationDeg === undefined ? null : (
                  <div className="col-span-2">
                    <NumberField
                      label="Rotation deg"
                      value={handle.rotationDeg}
                      min={-360}
                      max={360}
                      step={1}
                      onChange={(rotationDeg) =>
                        onHandleRotationChange?.(handle.id, rotationDeg)
                      }
                    />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {rects.length === 0 ? null : (
          <div className="space-y-2">
            <p className={typography.sectionLabelMicro}>Rects</p>
            {rects.map((entry) => (
              <div key={entry.id} className="rounded-md border border-border bg-background p-2">
                <p className={cn('truncate', typography.rowTitle)}>{entry.label}</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <NumberField label="X" value={entry.rect.x} min={0} max={1} step={snapStep ?? 0.01} onChange={(x) => onRectChange?.(entry.id, rectPatch(entry.rect, { x }))} />
                  <NumberField label="Y" value={entry.rect.y} min={0} max={1} step={snapStep ?? 0.01} onChange={(y) => onRectChange?.(entry.id, rectPatch(entry.rect, { y }))} />
                  <NumberField label="W" value={entry.rect.width} min={0} max={1} step={snapStep ?? 0.01} onChange={(width) => onRectChange?.(entry.id, rectPatch(entry.rect, { width }))} />
                  <NumberField label="H" value={entry.rect.height} min={0} max={1} step={snapStep ?? 0.01} onChange={(height) => onRectChange?.(entry.id, rectPatch(entry.rect, { height }))} />
                </div>
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}

interface NumberFieldProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly onChange: (value: number) => void;
}

function NumberField({ label, value, min, max, step, onChange }: NumberFieldProps) {
  return (
    <div className="min-w-0 space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(numberFromInput(event.currentTarget.value, min, max))}
        className="h-8"
      />
    </div>
  );
}
