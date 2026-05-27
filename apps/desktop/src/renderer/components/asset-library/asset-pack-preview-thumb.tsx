import { buildFrameIndex } from '@tileborne/sdk-tileset/renderer';
import { Skeleton, cn } from '@tileborne/ui';
import { useMemo } from 'react';

import { useAssetDataUrl, useTilesetPack } from '@/hooks/queries';

interface AssetPackPreviewThumbProps {
  readonly packId: string;
  readonly className?: string;
}

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
  const previewAssetPath =
    previewFrame === undefined
      ? undefined
      : 'sourceAssetPaths' in previewFrame
        ? previewFrame.sourceAssetPaths[0]
        : pack?.assets.find((asset) => asset.id === previewFrame.assetId)?.path;
  const dataUrlQuery = useAssetDataUrl(packId, previewAssetPath);

  const loading = packQuery.isLoading || (previewAssetPath !== undefined && dataUrlQuery.isLoading);

  return (
    <div
      className={cn(
        'flex aspect-square items-center justify-center overflow-hidden rounded-md bg-muted/40',
        className,
      )}
    >
      {loading ? (
        <Skeleton className="size-12" />
      ) : dataUrlQuery.data?.dataUrl ? (
        <img
          data-testid="asset-pack-preview-thumb"
          src={dataUrlQuery.data.dataUrl}
          alt=""
          className="max-h-full max-w-full object-contain"
        />
      ) : (
        <Skeleton className="size-12 opacity-50" />
      )}
    </div>
  );
}
