import { Skeleton, cn } from '@tileborne/ui';
import { useEffect, useRef, useState } from 'react';

import { assetThumbnailUrl } from '@/lib/asset-url';
import type { LibraryPreviewRef } from '@/lib/asset-library-bridge';

interface LibraryPreviewThumbProps {
  readonly packId: string;
  readonly preview: LibraryPreviewRef;
  /**
   * Fixed square box in px. Omit to fill the parent (the caller sizes it via
   * `className`, e.g. an auto-sized grid cell).
   */
  readonly sizePx?: number | undefined;
  readonly testId?: string | undefined;
  readonly className?: string | undefined;
  readonly alt?: string | undefined;
  readonly integrityHash?: string | undefined;
  readonly eager?: boolean | undefined;
}

/**
 * Canonical preview thumbnail: a plain, fixed-size `<img>` pointing at a
 * precomputed small thumbnail served by the `tileborne-asset://thumb` protocol.
 * The main process crops + downscales the source atlas once and disk-caches the
 * result, so the renderer never decodes full-resolution atlases or CSS-crops
 * them. Rendering is in-view gated so large grids don't request every offscreen
 * thumbnail at once. A `Skeleton` placeholder is shown until the image loads.
 */
export function LibraryPreviewThumb({
  packId,
  preview,
  sizePx,
  testId,
  className,
  alt,
  integrityHash,
  eager = false,
}: LibraryPreviewThumbProps) {
  const [inView, setInView] = useState(eager);
  const [loaded, setLoaded] = useState(false);
  const containerRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (eager) {
      return;
    }
    const node = containerRef.current;
    if (node === null) {
      return;
    }
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '320px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [eager]);

  const src = inView ? assetThumbnailUrl(packId, preview, integrityHash) : undefined;

  return (
    <span
      ref={containerRef}
      className={cn('relative block overflow-hidden rounded bg-muted/40', className)}
      style={sizePx === undefined ? undefined : { width: sizePx, height: sizePx }}
    >
      {src !== undefined ? (
        <img
          data-testid={testId}
          src={src}
          alt={alt ?? ''}
          decoding="async"
          onLoad={() => setLoaded(true)}
          className="absolute inset-0 h-full w-full select-none"
          style={{ imageRendering: 'pixelated', objectFit: 'contain' }}
        />
      ) : null}
      {loaded ? null : <Skeleton className="absolute inset-0 h-full w-full" />}
    </span>
  );
}

interface LibraryPreviewMosaicProps {
  readonly packId: string;
  readonly previews: readonly LibraryPreviewRef[];
  readonly sizePx: number;
  readonly testId?: string | undefined;
  readonly integrityHash?: string | undefined;
  readonly eager?: boolean | undefined;
}

/**
 * Compact 2x2 mosaic preview used for groups (terrain class / autotile rule)
 * where a single tile doesn't tell the story.
 */
export function LibraryPreviewMosaic({
  packId,
  previews,
  sizePx,
  testId,
  integrityHash,
  eager,
}: LibraryPreviewMosaicProps) {
  if (previews.length === 0) {
    return (
      <span
        data-testid={testId ? `${testId}-placeholder` : undefined}
        aria-hidden
        className="flex items-center justify-center rounded bg-muted/40"
        style={{ width: sizePx, height: sizePx }}
      >
        <span className="grid size-5 grid-cols-2 gap-0.5 opacity-70">
          {[0, 1, 2, 3].map((index) => (
            <span
              key={`mosaic-placeholder-${index}`}
              className="rounded-[2px] border border-muted-foreground/50"
            />
          ))}
        </span>
      </span>
    );
  }
  if (previews.length === 1) {
    return (
      <LibraryPreviewThumb
        packId={packId}
        preview={previews[0]!}
        sizePx={sizePx}
        testId={testId}
        integrityHash={integrityHash}
        eager={eager}
      />
    );
  }
  const cellSize = Math.floor((sizePx - 2) / 2);
  return (
    <span
      className="grid gap-0.5 rounded bg-muted/40 p-0.5"
      style={{ width: sizePx, height: sizePx, gridTemplateColumns: 'repeat(2, 1fr)' }}
    >
      {previews.slice(0, 4).map((preview, index) => (
        <LibraryPreviewThumb
          key={`mosaic-${index}-${preview.assetPath}-${preview.x}-${preview.y}`}
          packId={packId}
          preview={preview}
          sizePx={cellSize}
          testId={testId}
          integrityHash={integrityHash}
          eager={eager}
        />
      ))}
    </span>
  );
}
