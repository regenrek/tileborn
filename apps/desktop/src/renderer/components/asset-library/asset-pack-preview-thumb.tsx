import { buildFrameIndex } from '@tileborne/sdk-tileset/renderer';
import { Skeleton, cn } from '@tileborne/ui';
import { useMemo } from 'react';

import { useTilesetPack } from '@/hooks/queries';
import { LibraryPreviewThumb } from './library-preview-thumb';

interface AssetPackPreviewThumbProps {
  readonly packId: string;
  readonly className?: string;
}

const PACK_PREVIEW_THUMBNAIL_SIZE = 96;

export function AssetPackPreviewThumb({ packId, className }: AssetPackPreviewThumbProps) {
  const packQuery = useTilesetPack(packId);
  const pack = packQuery.data;
  const previewFrame = useMemo(() => {
    if (pack === undefined) {
      return undefined;
    }
    const firstTile = pack.tilesets[0]?.tiles[0];
    if (firstTile !== undefined) {
      return buildFrameIndex(pack).lookup(firstTile.id);
    }
    return pack.placeables?.[0]?.frames[0];
  }, [pack]);
  const previewAssetPath = (() => {
    if (previewFrame === undefined) {
      return undefined;
    }
    if ('sourceAssetPaths' in previewFrame) {
      return previewFrame.sourceAssetPaths[0];
    }
    return pack?.assets.find((asset) => asset.id === previewFrame.assetId)?.path;
  })();
  const preview =
    previewFrame === undefined || previewAssetPath === undefined
      ? undefined
      : {
          assetPath: previewAssetPath,
          x: previewFrame.uv.x,
          y: previewFrame.uv.y,
          width: previewFrame.uv.w,
          height: previewFrame.uv.h,
        };

  return (
    <div
      className={cn(
        'flex aspect-square items-center justify-center overflow-hidden rounded-md bg-muted/40',
        className,
      )}
    >
      {packQuery.isLoading ? (
        <Skeleton className="size-12" />
      ) : preview === undefined ? (
        <Skeleton className="size-12 opacity-50" />
      ) : (
        <LibraryPreviewThumb
          packId={packId}
          preview={preview}
          sizePx={PACK_PREVIEW_THUMBNAIL_SIZE}
          testId="asset-pack-preview-thumb"
          eager
        />
      )}
    </div>
  );
}
