import { Link, useParams } from '@tanstack/react-router';
import type { MapId, PackId, ProjectId } from '@tileborne/core';
import {
  Badge,
  Button,
  ScrollArea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
  typography,
} from '@tileborne/ui';
import {
  CheckIcon,
  ImagesIcon,
  ImportIcon,
  LayersIcon,
  PackageIcon,
  PackageOpenIcon,
} from 'lucide-react';
import { useMemo } from 'react';

import { SidebarPluginContributions } from '@/components/sidebar/plugin-contribution-zone';
import { SidebarEmptyState } from '@/components/sidebar/sidebar-empty-state';
import { SidebarListSkeleton } from '@/components/sidebar/sidebar-list-skeleton';
import { useSetMapTilesetPack } from '@/hooks/mutations';
import { useAssetPacks } from '@/hooks/queries';
import {
  pickPaintablePackId,
  usePackCapabilities,
  type PackCapability,
} from '@/lib/pack-capability-client';
import { useEditorUiStore } from '@/stores/editor-ui-store';

interface AssetsTabProps {
  readonly projectId: string | undefined;
}

interface InstalledPackSummary {
  readonly id: string;
  readonly name: string;
  readonly assetCount: number;
}

function PackListItem({
  pack,
  capability,
  isActive,
  onActivate,
}: {
  readonly pack: InstalledPackSummary;
  readonly capability: PackCapability | undefined;
  readonly isActive: boolean;
  readonly onActivate: () => void;
}) {
  const paintable = capability?.paintable === true;
  const hasPlaceables = (capability?.placeableCount ?? 0) > 0;
  const browsable = paintable || hasPlaceables;
  const probing = capability === undefined;
  return (
    <button
      type="button"
      aria-pressed={isActive}
      onClick={onActivate}
      disabled={!browsable && !probing}
      data-testid={`sidebar-pack-${pack.id}`}
      className={cn(
        'flex w-full min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors',
        isActive
          ? 'border-primary bg-primary/10 text-foreground'
          : 'border-transparent hover:border-border hover:bg-accent/30',
        !browsable && !probing && 'cursor-not-allowed opacity-60',
      )}
    >
      {paintable ? (
        <LayersIcon
          aria-hidden
          className={cn('size-3.5 shrink-0', isActive ? 'text-primary' : 'text-muted-foreground')}
        />
      ) : (
        <ImagesIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn('min-w-0 truncate', typography.rowTitle)}>{pack.name}</span>
        <span className={typography.rowMeta}>
          {paintable
            ? `${capability!.tilesetCount} tilesets · ${capability!.tileCount} tiles · ${capability!.placeableCount} objects`
            : hasPlaceables
              ? `${pack.assetCount} assets · ${capability!.placeableCount} objects · no tilesets`
              : probing
                ? `${pack.assetCount} assets`
                : `${pack.assetCount} assets · no tilesets`}
        </span>
      </span>
      {isActive ? <CheckIcon aria-hidden className="size-3.5 shrink-0 text-primary" /> : null}
    </button>
  );
}

export function AssetsTab({ projectId }: AssetsTabProps) {
  const { mapId } = useParams({ strict: false });
  const assetPacksQuery = useAssetPacks();
  const setAssetImportDialogOpen = useEditorUiStore((s) => s.setAssetImportDialogOpen);
  const activePalettePackId = useEditorUiStore((s) => s.activePalettePackId);
  const setActivePalettePackId = useEditorUiStore((s) => s.setActivePalettePackId);
  const setMapTilesetPack = useSetMapTilesetPack();
  const installedPacks: readonly InstalledPackSummary[] = useMemo(
    () => assetPacksQuery.data?.packs ?? [],
    [assetPacksQuery.data?.packs],
  );
  const { byId: capabilityById, isLoading: capabilitiesLoading } = usePackCapabilities();

  const activePaintablePackId = useMemo(
    () => pickPaintablePackId(installedPacks, capabilityById, activePalettePackId ?? undefined),
    [installedPacks, capabilityById, activePalettePackId],
  );

  const paintableCount = useMemo(
    () => installedPacks.filter((pack) => capabilityById.get(pack.id)?.paintable === true).length,
    [installedPacks, capabilityById],
  );

  const handleActivatePack = (packId: string) => {
    setActivePalettePackId(packId);
    if (
      projectId !== undefined &&
      projectId.length > 0 &&
      mapId !== undefined &&
      mapId.length > 0 &&
      capabilityById.get(packId)?.paintable === true
    ) {
      setMapTilesetPack.mutate({
        projectId: projectId as ProjectId,
        mapId: mapId as MapId,
        packId: packId as PackId,
      });
    }
  };

  return (
    <ScrollArea className="h-full min-h-0">
      <div className="flex flex-col gap-3 py-2">
        <div className="px-2">
          <Button
            variant="default"
            size="sm"
            className="w-full"
            data-testid="sidebar-import"
            onClick={() => setAssetImportDialogOpen(true)}
          >
            <ImportIcon data-icon="inline-start" />
            Import
          </Button>
        </div>

        <SidebarPluginContributions zone="assets" title="Plugin asset panels" />

        <section className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2 px-2">
            <p className={typography.panelTitle}>Installed packs</p>
            {installedPacks.length > 0 ? (
              <Badge
                variant="secondary"
                className={cn('px-1.5 py-0 font-normal', typography.rowMeta)}
              >
                {installedPacks.length}
              </Badge>
            ) : null}
          </div>
          {assetPacksQuery.isLoading ? (
            <SidebarListSkeleton rows={3} />
          ) : installedPacks.length === 0 ? (
            <SidebarEmptyState
              icon={PackageOpenIcon}
              title="No asset packs"
              description="Import a tileset pack to paint tiles and browse thumbnails."
              actionLabel="Import"
              onAction={() => setAssetImportDialogOpen(true)}
            />
          ) : (
            <ul className="flex flex-col gap-1 px-1">
              {installedPacks.map((pack) => (
                <li key={`${pack.id}-${pack.id}`}>
                  <PackListItem
                    pack={pack}
                    capability={capabilityById.get(pack.id)}
                    isActive={pack.id === activePaintablePackId}
                    onActivate={() => handleActivatePack(pack.id)}
                  />
                </li>
              ))}
            </ul>
          )}
          {!capabilitiesLoading && installedPacks.length > 0 && paintableCount === 0 ? (
            <p className={cn('px-2', typography.rowMeta)}>
              None of the installed packs contain paintable tilesets. Import a Tileborne pack with a{' '}
              <code>tilesets</code> section to enable the brush.
            </p>
          ) : null}
        </section>

        <div className="px-2">
          {projectId ? (
            <Link
              to="/projects/$projectId/assets"
              params={{ projectId }}
              className={cn('inline-block', typography.caption, 'text-primary hover:underline')}
            >
              Open asset library
            </Link>
          ) : (
            <SidebarEmptyState
              icon={PackageIcon}
              title="No project open"
              description="Open a project to browse its asset library and tile palettes."
              className="py-4"
            />
          )}
        </div>
      </div>
    </ScrollArea>
  );
}

export function AssetsTabCollapsedHint({ onClick }: { readonly onClick?: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="Assets" onClick={onClick}>
            <PackageIcon className="size-4 text-muted-foreground" aria-hidden />
          </Button>
        }
      />
      <TooltipContent side="right">Asset packs & tilesets</TooltipContent>
    </Tooltip>
  );
}
