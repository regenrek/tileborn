import { Link } from '@tanstack/react-router';
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
import { LayersIcon, PackageOpenIcon, PaletteIcon, PaintbrushIcon } from 'lucide-react';
import { useMemo } from 'react';

import { SidebarPluginContributions } from '@/components/sidebar/plugin-contribution-zone';
import { SidebarEmptyState } from '@/components/sidebar/sidebar-empty-state';
import { SidebarListSkeleton } from '@/components/sidebar/sidebar-list-skeleton';
import { WorkingPaletteSidebar } from '@/components/sidebar/working-palette-sidebar';
import { useAssetPacks, useMap } from '@/hooks/queries';
import { pickPaintablePackId, usePackCapabilities } from '@/lib/pack-capability-client';
import { useEditorUiStore } from '@/stores/editor-ui-store';

interface WorkingPaletteTabProps {
  readonly projectId: string | undefined;
  readonly mapId?: string | undefined;
}

interface InstalledPackSummary {
  readonly id: string;
  readonly name: string;
  readonly assetCount: number;
}

export function WorkingPaletteTab({ projectId, mapId }: WorkingPaletteTabProps) {
  const assetPacksQuery = useAssetPacks();
  const mapQuery = useMap(projectId, mapId);
  const activePalettePackId = useEditorUiStore((s) => s.activePalettePackId);
  const installedPacks: readonly InstalledPackSummary[] = useMemo(
    () => assetPacksQuery.data?.packs ?? [],
    [assetPacksQuery.data?.packs],
  );
  const { byId: capabilityById, isLoading: capabilitiesLoading } = usePackCapabilities();

  const mapTilesetPackId =
    typeof mapQuery.data?.map.properties.tilesetPackId === 'string'
      ? mapQuery.data.map.properties.tilesetPackId
      : undefined;

  const palettePackId = useMemo(
    () =>
      pickPaintablePackId(
        installedPacks,
        capabilityById,
        mapTilesetPackId ?? activePalettePackId ?? undefined,
      ),
    [installedPacks, capabilityById, mapTilesetPackId, activePalettePackId],
  );

  const paintableCount = useMemo(
    () => installedPacks.filter((pack) => capabilityById.get(pack.id)?.paintable === true).length,
    [installedPacks, capabilityById],
  );

  const activePack = installedPacks.find((pack) => pack.id === palettePackId);
  const loading = assetPacksQuery.isLoading || capabilitiesLoading;

  return (
    <ScrollArea className="h-full min-h-0">
      <div className="flex flex-col gap-3 py-2">
        <div className="flex flex-col gap-2 px-2">
          <div className="rounded-md border border-border bg-card p-2">
            <div className="flex items-center justify-between gap-2">
              <p className={typography.sectionLabelMicro}>Build palette</p>
              {paintableCount > 0 ? (
                <Badge
                  variant="secondary"
                  className={cn('px-1.5 py-0 font-normal', typography.rowMeta)}
                >
                  {paintableCount} paintable
                </Badge>
              ) : null}
            </div>
            <p className={cn('mt-1', typography.bodyCompact)}>
              Keep this panel small and project-specific. Import packs in Assets, then curate tiles,
              terrain, objects, spawn markers, and models here.
            </p>
          </div>
        </div>

        <SidebarPluginContributions zone="working-palette" title="Plugin palette tools" />

        {loading ? (
          <SidebarListSkeleton rows={4} />
        ) : installedPacks.length === 0 ? (
          <SidebarEmptyState
            icon={PackageOpenIcon}
            title="No asset packs"
            description="Open Assets to import a pack, then add items to your Working Palette."
          />
        ) : paintableCount === 0 ? (
          <SidebarEmptyState
            icon={LayersIcon}
            title="No paintable packs"
            description="Open Assets to import a Tileborne pack with tilesets, objects, or terrain brushes."
          />
        ) : activePack === undefined ? (
          <SidebarEmptyState
            icon={PaletteIcon}
            title="No build pack selected"
            description="Open Assets and choose a paintable pack before curating your Working Palette."
          />
        ) : (
          <WorkingPaletteSidebar
            projectId={projectId ?? null}
            packId={activePack.id}
            packName={activePack.name}
            libraryLink={
              projectId !== undefined ? (
                <Link
                  to="/projects/$projectId/assets"
                  params={{ projectId }}
                  data-testid="working-palette-sidebar-open-library"
                  className={cn('text-primary hover:underline', typography.bodyMicro)}
                >
                  Open asset library
                </Link>
              ) : undefined
            }
          />
        )}
      </div>
    </ScrollArea>
  );
}

export function WorkingPaletteTabCollapsedHint({ onClick }: { readonly onClick?: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="Working Palette" onClick={onClick}>
            <PaintbrushIcon className="size-4 text-muted-foreground" aria-hidden />
          </Button>
        }
      />
      <TooltipContent side="right">Working palette</TooltipContent>
    </Tooltip>
  );
}
