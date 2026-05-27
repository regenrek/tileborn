import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
  cn,
  typography,
} from '@tileborne/ui';
import { CheckIcon, FolderOpenIcon, PaletteIcon, Trash2Icon } from 'lucide-react';
import { useParams } from '@tanstack/react-router';
import type { MapId, PackId, ProjectId } from '@tileborne/core';
import { useState } from 'react';

import { AssetPackBrowserDialog } from '@/components/asset-library/asset-pack-browser-dialog';
import { useRemoveAssetPack, useSetMapTilesetPack } from '@/hooks/mutations';
import { useAssetPack } from '@/hooks/queries';
import { notifySuccess } from '@/stores/app-notifications-store';
import { useEditorUiStore } from '@/stores/editor-ui-store';

import { AssetPackPreviewThumb } from './asset-pack-preview-thumb';
import { usePackTileStats } from './use-pack-tile-stats';

interface AssetPackDetailsPaneProps {
  readonly packId: string;
}

export function AssetPackDetailsPane({ packId }: AssetPackDetailsPaneProps) {
  const { projectId, mapId } = useParams({ strict: false });
  const packQuery = useAssetPack(packId);
  const { tileCount, tileSize, loading: statsLoading } = usePackTileStats(packId);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const activePalettePackId = useEditorUiStore((state) => state.activePalettePackId);
  const setActivePalettePackId = useEditorUiStore((state) => state.setActivePalettePackId);
  const setMapTilesetPack = useSetMapTilesetPack();
  const removePack = useRemoveAssetPack();
  const pack = packQuery.data?.pack;
  const isActive = activePalettePackId === packId;
  const handleSetActive = () => {
    setActivePalettePackId(packId);
    if (
      pack &&
      pack.capability.paintable &&
      projectId !== undefined &&
      projectId.length > 0 &&
      mapId !== undefined &&
      mapId.length > 0
    ) {
      setMapTilesetPack.mutate({
        projectId: projectId as ProjectId,
        mapId: mapId as MapId,
        packId: packId as PackId,
      });
    }
    notifySuccess(`Set ${pack?.name ?? packId} as active palette`);
  };
  const handleRemovePack = async () => {
    await removePack.mutateAsync(packId);
    setConfirmRemoveOpen(false);
  };

  if (packQuery.isLoading || !pack) {
    return (
      <Card className="h-fit border-border/80">
        <CardHeader>
          <Skeleton className="aspect-square w-full rounded-md" />
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 4 }, (_, rowNumber) => `asset-pack-detail-row-${rowNumber}`).map(
            (rowKey) => (
              <Skeleton key={rowKey} className="h-4 w-full" />
            ),
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-fit border-border/80" data-testid="asset-pack-details-pane">
      <CardHeader className="gap-3">
        <AssetPackPreviewThumb packId={packId} className="w-full" />
        <div>
          <CardTitle>{pack.name}</CardTitle>
          <CardDescription className={typography.bodyCompact}>
            Manifest summary for the selected pack
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <dl className="space-y-2">
          <DetailRow label="Version" value={`v${pack.version}`} />
          <DetailRow label="License" value={pack.licenseSpdxId} />
          <DetailRow label="Tile count" value={statsLoading ? '…' : String(tileCount)} />
          <DetailRow label="Tile size" value={statsLoading ? '…' : (tileSize ?? '—')} />
          <DetailRow label="Total assets" value={String(pack.assetCount)} />
        </dl>
      </CardContent>
      <CardFooter className="flex-col gap-2 pt-0">
        <Button
          className="w-full"
          variant="default"
          data-testid="asset-pack-open-browser"
          onClick={() => setBrowserOpen(true)}
        >
          <FolderOpenIcon />
          Browse pack & curate palette
        </Button>
        <Button
          className="w-full"
          variant={isActive ? 'secondary' : 'outline'}
          disabled={isActive}
          data-testid="asset-pack-set-active"
          onClick={handleSetActive}
        >
          {isActive ? <CheckIcon /> : <PaletteIcon />}
          {isActive ? 'Active tile palette' : 'Set as active'}
        </Button>
        <Button
          className="w-full"
          variant="destructive"
          disabled={removePack.isPending}
          data-testid="asset-pack-remove"
          onClick={() => setConfirmRemoveOpen(true)}
        >
          <Trash2Icon />
          Remove asset pack
        </Button>
      </CardFooter>

      <AssetPackBrowserDialog
        open={browserOpen}
        onOpenChange={setBrowserOpen}
        packId={packId}
        packName={pack.name}
        projectId={projectId ?? null}
      />
      <Dialog
        open={confirmRemoveOpen}
        onOpenChange={(next) => {
          if (!removePack.isPending) {
            setConfirmRemoveOpen(next);
          }
        }}
      >
        <DialogContent className="sm:max-w-md" data-testid="asset-pack-remove-dialog">
          <DialogHeader>
            <DialogTitle>Remove asset pack?</DialogTitle>
            <DialogDescription>
              Remove <strong>{pack.name}</strong> from installed asset packs. Projects and maps stay
              in place; references to this pack will be cleared.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={removePack.isPending}
              onClick={() => setConfirmRemoveOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={removePack.isPending}
              data-testid="asset-pack-confirm-remove"
              onClick={() => void handleRemovePack()}
            >
              {removePack.isPending ? 'Removing…' : 'Remove pack'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function DetailRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={cn(typography.sectionLabelMicro, 'normal-case tracking-normal')}>{label}</dt>
      <dd className={cn('text-right', typography.caption, 'text-foreground')}>{value}</dd>
    </div>
  );
}
