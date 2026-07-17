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
import { CheckIcon, FolderOpenIcon, Link2Icon, PaletteIcon, Trash2Icon } from 'lucide-react';
import { useNavigate, useParams } from '@tanstack/react-router';
import type { MapId, PackId, ProjectId } from '@tileborne/core';
import { useState } from 'react';

import { AssetPackBrowserDialog } from '@/components/asset-library/asset-pack-browser-dialog';
import { useRemoveAssetPack, useSetMapTilesetPack } from '@/hooks/mutations';
import { useAssetPack, useAssetPackUseSites } from '@/hooks/queries';
import { notifySuccess } from '@/stores/app-notifications-store';
import { useEditorUiStore } from '@/stores/editor-ui-store';

import { AssetPackPreviewThumb } from './asset-pack-preview-thumb';
import { usePackTileStats } from './use-pack-tile-stats';

interface AssetPackDetailsPaneProps {
  readonly packId: string;
}

export function AssetPackDetailsPane({ packId }: AssetPackDetailsPaneProps) {
  const { projectId, mapId } = useParams({ strict: false });
  const navigate = useNavigate();
  const packQuery = useAssetPack(packId);
  const useSitesQuery = useAssetPackUseSites(projectId, packId);
  const { tileCount, tileSize, loading: statsLoading } = usePackTileStats(packId);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const activePalettePackId = useEditorUiStore((state) => state.activePalettePackId);
  const setActivePalettePackId = useEditorUiStore((state) => state.setActivePalettePackId);
  const setSelection = useEditorUiStore((state) => state.setSelection);
  const selectTool = useEditorUiStore((state) => state.selectTool);
  const setCatalogTargetObjectTypeId = useEditorUiStore(
    (state) => state.setCatalogTargetObjectTypeId,
  );
  const setMapTilesetPack = useSetMapTilesetPack();
  const removePack = useRemoveAssetPack();
  const pack = packQuery.data?.pack;
  const useSites = useSitesQuery.data?.useSites ?? [];
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
  const navigateToUseSite = (index: number) => {
    const target = useSites[index]?.navigation;
    if (target === undefined) {
      return;
    }
    switch (target.kind) {
      case 'project-settings':
        void navigate({
          to: '/projects/$projectId/settings',
          params: { projectId: target.projectId },
        });
        return;
      case 'map':
      case 'map-object':
        if (target.mapId === undefined) {
          return;
        }
        if (target.kind === 'map-object' && target.objectId !== undefined) {
          setSelection(new Set([target.objectId]));
          selectTool('select');
        }
        void navigate({
          to: '/projects/$projectId/maps/$mapId',
          params: { projectId: target.projectId, mapId: target.mapId },
        });
        return;
      case 'catalog':
        setCatalogTargetObjectTypeId(target.objectTypeId ?? null);
        void navigate({
          to: '/projects/$projectId/entities',
          params: { projectId: target.projectId },
        });
        return;
      case 'player-model':
        void navigate({
          to: '/projects/$projectId/player-models',
          params: { projectId: target.projectId },
          search: {
            ...(target.modelId === undefined ? {} : { modelId: target.modelId }),
            ...(target.path === undefined ? {} : { path: target.path }),
          },
        });
        return;
      case 'asset-library':
        void navigate({
          to: '/projects/$projectId/assets',
          params: { projectId: target.projectId },
        });
        return;
    }
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
        <div
          className="mt-4 rounded-md border border-border/80 bg-muted/25 p-2"
          data-testid="asset-pack-use-sites"
        >
          <p className={cn('flex items-center gap-1.5', typography.rowTitle)}>
            <Link2Icon className="size-3.5" aria-hidden />
            Dependencies & use sites
          </p>
          {useSitesQuery.isLoading ? (
            <p className={cn('mt-1.5 text-muted-foreground', typography.bodyMicro)}>
              Resolving project consumers…
            </p>
          ) : useSites.length === 0 ? (
            <p className={cn('mt-1.5 text-muted-foreground', typography.bodyMicro)}>
              No player model, entity, map, object, or animation currently uses this pack.
            </p>
          ) : (
            <ul className="mt-1.5 max-h-56 space-y-1 overflow-y-auto">
              {useSites.map((site, index) => (
                <li key={site.id}>
                  <button
                    type="button"
                    className="w-full rounded px-1.5 py-1 text-left hover:bg-accent/40"
                    onClick={() => navigateToUseSite(index)}
                    data-testid={`asset-pack-use-site-${site.kind}`}
                  >
                    <span className={cn('block text-foreground', typography.rowMeta)}>
                      {site.label}
                    </span>
                    <span className={cn('block text-muted-foreground', typography.bodyMicro)}>
                      {site.detail}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {useSitesQuery.data?.truncated ? (
            <p className={cn('mt-1.5 text-muted-foreground', typography.bodyMicro)}>
              Showing {useSites.length} of at least {useSitesQuery.data.total} bounded results.
            </p>
          ) : null}
        </div>
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
