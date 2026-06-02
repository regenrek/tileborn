import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  ScrollArea,
  Separator,
  Switch,
  cn,
} from '@tileborne/ui';
import { sliceAtlas } from '@tileborne/sdk-tileset/atlas';
import { compileClipTimeline, resolveClipFrameIndex } from '@tileborne/sdk-tileset/animation';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useImportSpriteSheet } from '@/hooks/mutations';
import { notifyError, notifySuccess } from '@/stores/app-notifications-store';

interface SpriteAnimationStudioProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

interface LoadedImage {
  readonly fileName: string;
  readonly mime: string;
  readonly base64: string;
  readonly dataUrl: string;
  readonly width: number;
  readonly height: number;
  readonly element: HTMLImageElement;
}

interface SliceConfig {
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly margin: number;
  readonly spacing: number;
  readonly columns?: number | undefined;
}

interface ClipDraft {
  readonly id: string;
  readonly name: string;
  readonly fromFrame: number;
  readonly toFrame: number;
  readonly fps: number;
  readonly loop: boolean;
}

type SpriteAnchor = 'top-left' | 'center' | 'bottom-left';

const ANCHOR_OPTIONS: readonly { readonly value: SpriteAnchor; readonly label: string }[] = [
  { value: 'top-left', label: 'Top-left' },
  { value: 'center', label: 'Center' },
  { value: 'bottom-left', label: 'Bottom-left' },
];

const DEFAULT_SLICE: SliceConfig = { cellWidth: 32, cellHeight: 32, margin: 0, spacing: 0 };

const fpsToDurationMs = (fps: number): number => Math.max(1, Math.round(1000 / Math.max(1, fps)));

const readImageFile = (file: File): Promise<LoadedImage> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const base64 = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl;
      const element = new Image();
      element.onload = () =>
        resolve({
          fileName: file.name,
          mime: file.type || 'image/png',
          base64,
          dataUrl,
          width: element.naturalWidth,
          height: element.naturalHeight,
          element,
        });
      element.onerror = () => reject(new Error('Failed to decode image'));
      element.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });

export function SpriteAnimationStudio({ open, onOpenChange }: SpriteAnimationStudioProps) {
  const importSpriteSheet = useImportSpriteSheet();

  const [image, setImage] = useState<LoadedImage | undefined>();
  const [slice, setSlice] = useState<SliceConfig>(DEFAULT_SLICE);
  const [spriteName, setSpriteName] = useState('Sprite');
  const [anchor, setAnchor] = useState<SpriteAnchor>('top-left');
  const [clips, setClips] = useState<readonly ClipDraft[]>([]);
  const [activeClipId, setActiveClipId] = useState<string | undefined>();
  const [playing, setPlaying] = useState(true);

  const gridCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setImage(undefined);
    setSlice(DEFAULT_SLICE);
    setSpriteName('Sprite');
    setAnchor('top-left');
    setClips([]);
    setActiveClipId(undefined);
    setPlaying(true);
  }, []);

  // Sliced frame rectangles for the current image + slice config.
  const frames = useMemo(() => {
    if (image === undefined) {
      return [] as { x: number; y: number; w: number; h: number }[];
    }
    const result = sliceAtlas({
      imageWidth: image.width,
      imageHeight: image.height,
      cellWidth: slice.cellWidth,
      cellHeight: slice.cellHeight,
      margin: slice.margin,
      spacing: slice.spacing,
      ...(slice.columns === undefined ? {} : { columns: slice.columns }),
    });
    return result.value === undefined ? [] : result.value.tiles.map((uv) => ({ ...uv }));
  }, [image, slice]);

  // When the image (re)loads, seed a single default clip across all frames.
  useEffect(() => {
    if (image === undefined || frames.length === 0) {
      return;
    }
    setClips((current) => {
      if (current.length > 0) {
        return current;
      }
      const defaultClip: ClipDraft = {
        id: 'clip-default',
        name: 'default',
        fromFrame: 0,
        toFrame: frames.length - 1,
        fps: 10,
        loop: true,
      };
      setActiveClipId(defaultClip.id);
      return [defaultClip];
    });
  }, [image, frames.length]);

  const activeClip = useMemo(
    () => clips.find((clip) => clip.id === activeClipId) ?? clips[0],
    [clips, activeClipId],
  );

  // Draw the image with a slice grid overlay.
  useEffect(() => {
    const canvas = gridCanvasRef.current;
    if (canvas === null || image === undefined) {
      return;
    }
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    if (ctx === null) {
      return;
    }
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image.element, 0, 0);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)';
    ctx.lineWidth = 1;
    for (const frame of frames) {
      ctx.strokeRect(frame.x + 0.5, frame.y + 0.5, frame.w - 1, frame.h - 1);
    }
  }, [image, frames]);

  // Ticker-driven preview of the active clip (shared clip math with the editor).
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (canvas === null || image === undefined || activeClip === undefined || frames.length === 0) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (ctx === null) {
      return;
    }
    const clipFrameIndices: number[] = [];
    for (let index = activeClip.fromFrame; index <= activeClip.toFrame; index += 1) {
      if (index >= 0 && index < frames.length) {
        clipFrameIndices.push(index);
      }
    }
    if (clipFrameIndices.length === 0) {
      return;
    }
    const durationMs = fpsToDurationMs(activeClip.fps);
    const compiled = compileClipTimeline(
      clipFrameIndices.map(() => durationMs),
      { loop: activeClip.loop, defaultDurationMs: durationMs },
    );
    const cellW = frames[0]!.w;
    const cellH = frames[0]!.h;
    canvas.width = cellW;
    canvas.height = cellH;
    ctx.imageSmoothingEnabled = false;

    let raf = 0;
    const start = performance.now();
    const render = () => {
      const clockMs = playing ? performance.now() - start : 0;
      const localIndex = resolveClipFrameIndex(compiled, clockMs);
      const frame = frames[clipFrameIndices[localIndex] ?? clipFrameIndices[0]!]!;
      ctx.clearRect(0, 0, cellW, cellH);
      ctx.drawImage(image.element, frame.x, frame.y, frame.w, frame.h, 0, 0, cellW, cellH);
      if (playing) {
        raf = requestAnimationFrame(render);
      }
    };
    render();
    return () => {
      if (raf !== 0) {
        cancelAnimationFrame(raf);
      }
    };
  }, [image, activeClip, frames, playing]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      reset();
    }
    onOpenChange(nextOpen);
  };

  const handleFile = async (file: File | undefined) => {
    if (file === undefined) {
      return;
    }
    try {
      const loaded = await readImageFile(file);
      reset();
      setImage(loaded);
      setSpriteName(file.name.replace(/\.[^.]+$/, ''));
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Failed to load image');
    }
  };

  const updateClip = (id: string, patch: Partial<ClipDraft>) => {
    setClips((current) => current.map((clip) => (clip.id === id ? { ...clip, ...patch } : clip)));
  };

  const addClip = () => {
    const id = `clip-${Date.now()}`;
    setClips((current) => [
      ...current,
      {
        id,
        name: `clip-${current.length + 1}`,
        fromFrame: 0,
        toFrame: Math.max(0, frames.length - 1),
        fps: 10,
        loop: true,
      },
    ]);
    setActiveClipId(id);
  };

  const removeClip = (id: string) => {
    setClips((current) => current.filter((clip) => clip.id !== id));
  };

  const handleSave = async () => {
    if (image === undefined || frames.length === 0) {
      notifyError('Load a sprite sheet and configure slicing first.');
      return;
    }
    try {
      await importSpriteSheet.mutateAsync({
        imageBase64: image.base64,
        imageFileName: image.fileName,
        mime: image.mime,
        imageWidth: image.width,
        imageHeight: image.height,
        slice: {
          cellWidth: slice.cellWidth,
          cellHeight: slice.cellHeight,
          margin: slice.margin,
          spacing: slice.spacing,
          ...(slice.columns === undefined ? {} : { columns: slice.columns }),
        },
        spriteName,
        anchor,
        packName: `${spriteName} Pack`,
        clips: clips.map((clip) => ({
          name: clip.name,
          frameIndices: Array.from(
            { length: Math.max(0, clip.toFrame - clip.fromFrame + 1) },
            (_, offset) => clip.fromFrame + offset,
          ),
          loop: clip.loop,
          defaultDurationMs: fpsToDurationMs(clip.fps),
        })),
      });
      notifySuccess('Sprite sheet imported as an animated pack.');
      handleOpenChange(false);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Sprite import failed');
    }
  };

  const numberField = (
    label: string,
    value: number,
    onChange: (next: number) => void,
    min = 0,
  ) => (
    <div className="flex flex-col gap-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        min={min}
        value={value}
        onChange={(event) => {
          const next = Number.parseInt(event.target.value, 10);
          onChange(Number.isFinite(next) ? next : 0);
        }}
        className="h-8"
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Sprite / Animation Studio</DialogTitle>
          <DialogDescription>
            Import a PNG/WebP sprite sheet, slice it into a grid, and author named animation clips.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/webp"
          className="hidden"
          onChange={(event) => void handleFile(event.target.files?.[0] ?? undefined)}
        />

        {image === undefined ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-md border border-dashed">
            <p className="text-sm text-muted-foreground">No sprite sheet loaded.</p>
            <Button onClick={() => fileInputRef.current?.click()}>Choose image…</Button>
          </div>
        ) : (
          <div className="grid grid-cols-[1fr_320px] gap-4">
            <div className="flex flex-col gap-3">
              <div className="overflow-auto rounded-md border bg-[#0b1220] p-2" style={{ maxHeight: 320 }}>
                <canvas
                  ref={gridCanvasRef}
                  className="block"
                  style={{ imageRendering: 'pixelated', width: '100%', height: 'auto' }}
                />
              </div>
              <div className="grid grid-cols-4 gap-2">
                {numberField('Cell W', slice.cellWidth, (cellWidth) =>
                  setSlice((s) => ({ ...s, cellWidth: Math.max(1, cellWidth) })),
                )}
                {numberField('Cell H', slice.cellHeight, (cellHeight) =>
                  setSlice((s) => ({ ...s, cellHeight: Math.max(1, cellHeight) })),
                )}
                {numberField('Margin', slice.margin, (margin) =>
                  setSlice((s) => ({ ...s, margin })),
                )}
                {numberField('Spacing', slice.spacing, (spacing) =>
                  setSlice((s) => ({ ...s, spacing })),
                )}
              </div>
              <p className="text-xs text-muted-foreground">{frames.length} frames sliced</p>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Sprite name</Label>
                <Input
                  value={spriteName}
                  onChange={(event) => setSpriteName(event.target.value)}
                  className="h-8"
                />
              </div>

              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Anchor / pivot</Label>
                <div className="grid grid-cols-3 gap-1" data-testid="sprite-anchor-picker">
                  {ANCHOR_OPTIONS.map((option) => (
                    <Button
                      key={option.value}
                      type="button"
                      size="sm"
                      variant={anchor === option.value ? 'default' : 'outline'}
                      className="h-8 px-1 text-xs"
                      data-testid={`sprite-anchor-${option.value}`}
                      data-active={anchor === option.value ? 'true' : 'false'}
                      onClick={() => setAnchor(option.value)}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col items-center gap-2 rounded-md border bg-[#0b1220] p-3">
                <canvas
                  ref={previewCanvasRef}
                  style={{ imageRendering: 'pixelated', width: 96, height: 96 }}
                />
                <Button size="sm" variant="outline" onClick={() => setPlaying((value) => !value)}>
                  {playing ? 'Pause' : 'Play'}
                </Button>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <Label className="text-xs uppercase text-muted-foreground">Clips</Label>
                <Button size="sm" variant="ghost" onClick={addClip} disabled={frames.length === 0}>
                  <PlusIcon className="size-4" /> Add
                </Button>
              </div>

              <ScrollArea className="h-48">
                <div className="flex flex-col gap-2 pr-2">
                  {clips.map((clip) => (
                    <div
                      key={clip.id}
                      className={cn(
                        'flex flex-col gap-2 rounded-md border p-2',
                        clip.id === activeClipId && 'border-sky-500',
                      )}
                      onClick={() => setActiveClipId(clip.id)}
                    >
                      <div className="flex items-center gap-2">
                        <Input
                          value={clip.name}
                          onChange={(event) => updateClip(clip.id, { name: event.target.value })}
                          className="h-7"
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7 shrink-0"
                          onClick={() => removeClip(clip.id)}
                        >
                          <Trash2Icon className="size-4" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {numberField('From', clip.fromFrame, (fromFrame) =>
                          updateClip(clip.id, { fromFrame: Math.max(0, fromFrame) }),
                        )}
                        {numberField('To', clip.toFrame, (toFrame) =>
                          updateClip(clip.id, { toFrame: Math.max(0, toFrame) }),
                        )}
                        {numberField('FPS', clip.fps, (fps) =>
                          updateClip(clip.id, { fps: Math.max(1, fps) }),
                          1,
                        )}
                      </div>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Switch
                          checked={clip.loop}
                          onCheckedChange={(loop) => updateClip(clip.id, { loop })}
                        />
                        Loop
                      </label>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </div>
        )}

        <DialogFooter>
          {image !== undefined && (
            <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
              Replace image…
            </Button>
          )}
          <Button
            onClick={() => void handleSave()}
            disabled={image === undefined || frames.length === 0 || importSpriteSheet.isPending}
          >
            {importSpriteSheet.isPending ? 'Importing…' : 'Save sprite pack'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
