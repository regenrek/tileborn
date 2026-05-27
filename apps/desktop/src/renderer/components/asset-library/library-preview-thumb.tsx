import { Skeleton, cn } from '@tileborne/ui';
import { useEffect, useRef, useState } from 'react';

import { useAssetThumbnailDataUrl } from '@/hooks/queries';
import type { LibraryPreviewRef } from '@/lib/asset-library-bridge';

interface LibraryPreviewThumbProps {
  readonly packId: string;
  readonly preview: LibraryPreviewRef;
  readonly sizePx: number;
  readonly testId?: string | undefined;
  readonly className?: string | undefined;
  readonly alt?: string | undefined;
  readonly integrityHash?: string | undefined;
  readonly cacheVersion?: string | undefined;
}

/**
 * Lazy, viewport-aware preview thumb. Only requests the asset data URL once
 * the thumb is near the viewport, so a 29k-tile pack doesn't kick off 29k
 * IPC `getAssetDataUrl` calls when the user opens the asset library.
 */
export function LibraryPreviewThumb({
  packId,
  preview,
  sizePx,
  testId,
  className,
  alt,
  integrityHash,
  cacheVersion,
}: LibraryPreviewThumbProps) {
  const [inView, setInView] = useState(false);
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
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
          observerRef.current = null;
        }
      },
      { rootMargin: '320px' },
    );
    observer.observe(node);
    observerRef.current = observer;
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, []);

  const dataUrlQuery = useAssetThumbnailDataUrl(packId, inView ? preview : undefined, {
    integrityHash,
    sizePx,
    cacheVersion,
  });
  const inner = sizePx - 4;
  const scale = Math.min(inner / preview.width, inner / preview.height, 1);

  return (
    <span
      ref={containerRef}
      className={cn('relative block overflow-hidden rounded bg-muted/40', className)}
      style={{ width: sizePx, height: sizePx }}
    >
      {dataUrlQuery.data?.dataUrl ? (
        <img
          data-testid={testId}
          src={dataUrlQuery.data.dataUrl}
          alt={alt ?? ''}
          className="absolute left-0.5 top-0.5 max-w-none select-none"
          style={{
            imageRendering: 'pixelated',
            transform: `translate(${-preview.x * scale}px, ${-preview.y * scale}px) scale(${scale})`,
            transformOrigin: 'top left',
          }}
        />
      ) : (
        <Skeleton className="h-full w-full" />
      )}
    </span>
  );
}

interface LibraryPreviewMosaicProps {
  readonly packId: string;
  readonly previews: readonly LibraryPreviewRef[];
  readonly sizePx: number;
  readonly testId?: string | undefined;
  readonly integrityHash?: string | undefined;
  readonly cacheVersion?: string | undefined;
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
  cacheVersion,
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
        cacheVersion={cacheVersion}
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
          cacheVersion={cacheVersion}
        />
      ))}
    </span>
  );
}
