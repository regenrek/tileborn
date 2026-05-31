import { Button, ScrollArea, Skeleton, cn, typography } from '@tileborne/ui';
import {
  EraserIcon,
  ImagesIcon,
  ShapesIcon,
  SproutIcon,
  TrashIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo } from 'react';

import { LibraryPreviewMosaic, LibraryPreviewThumb } from '@/components/asset-library/library-preview-thumb';
import { SidebarEmptyState } from '@/components/sidebar/sidebar-empty-state';
import { PaletteSwitcher } from '@/components/sidebar/palette-switcher';
import { useWorkingPalettePreviews } from '@/hooks/queries';
import type { LibraryPreviewRef } from '@/lib/asset-library-bridge';
import {
  brushIntentMatchesItem,
  workingPaletteItemKey,
  workingPaletteItemToBrushIntent,
  type WorkingPaletteItem,
} from '@/lib/working-palettes-bridge';
import {
  useActiveWorkingPalette,
  useWorkingPaletteActions,
} from '@/hooks/use-working-palettes';
import { useEditorUiStore } from '@/stores/editor-ui-store';

type PaletteItemKind = WorkingPaletteItem['ref']['kind'];

interface WorkingPaletteSidebarProps {
  readonly projectId: string | null | undefined;
  readonly packId: string;
  readonly packName: string;
  /** Rendered as the primary CTA in empty states / footer link. */
  readonly libraryLink?: ReactNode;
}

const KIND_ICON: Record<PaletteItemKind, LucideIcon> = {
  tile: ImagesIcon,
  autotile: ShapesIcon,
  terrain: SproutIcon,
  placeable: ImagesIcon,
};

const KIND_LABEL: Record<PaletteItemKind, string> = {
  tile: 'Tile',
  autotile: 'Autotile',
  terrain: 'Terrain class',
  placeable: 'Object',
};

const GRID_THUMB_PX = 32;

/**
 * Sidebar palette. Renders ONLY the items in the active working palette so
 * the sidebar never spams thousands of tiles from large packs. When no
 * palette exists yet, shows an empty state pointing users to the asset
 * library where they can curate one.
 *
 * Drawing/brush selection still goes through the same `selectBrush` action,
 * so painting, autotile, terrain, and object-place tools behave the same as
 * before — they just have a smaller, curated set of brushes to pick from.
 */
export function WorkingPaletteSidebar({
  projectId,
  packId,
  packName,
  libraryLink,
}: WorkingPaletteSidebarProps) {
  const activePalette = useActiveWorkingPalette(projectId);
  const paletteActions = useWorkingPaletteActions();
  const selectBrush = useEditorUiStore((state) => state.selectBrush);
  const paletteItems = activePalette?.items ?? [];
  const paletteRefs = useMemo(() => paletteItems.map((item) => item.ref), [paletteItems]);
  const { previewByKey, isLoading: previewsLoading } = useWorkingPalettePreviews(paletteRefs);

  return (
    <section className="flex flex-col gap-2 px-1" data-testid="working-palette-sidebar">
      <div className="flex items-center gap-1 px-1">
        <p className={cn(typography.sectionLabelMicro, 'flex-1')}>Working palette</p>
        <PaletteSwitcher
          projectId={projectId}
          packId={packId}
          packName={packName}
          variant="sidebar"
          testId="working-palette-sidebar-switcher"
        />
      </div>

      {activePalette === undefined ? (
        <SidebarEmptyState
          icon={ImagesIcon}
          title="No working palette"
          description="Open Assets to add tiles, autotiles, terrain classes, or objects to a small Working Palette."
          secondaryAction={libraryLink}
        />
      ) : activePalette.items.length === 0 ? (
        <SidebarEmptyState
          icon={ImagesIcon}
          title="Palette is empty"
          description="Open Assets or the asset library to add tiles, terrain brushes, objects, spawn markers, or models."
          secondaryAction={libraryLink}
        />
      ) : (
        <>
          <p className={cn('px-2', typography.bodyMicro)}>
            {activePalette.items.length} item{activePalette.items.length === 1 ? '' : 's'} ·{' '}
            <button
              type="button"
              className="underline-offset-2 hover:underline"
              data-testid="working-palette-sidebar-eraser"
              onClick={() => selectBrush({ kind: 'eraser' }, 'eraser')}
            >
              <span className="inline-flex items-center gap-1">
                <EraserIcon className="size-3" aria-hidden />
                Eraser
              </span>
            </button>
          </p>
          <ScrollArea className="max-h-[60vh]">
            <ul
              className="grid gap-1 px-1 pb-2"
              data-testid="working-palette-sidebar-grid"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(2.5rem, 1fr))' }}
            >
              {activePalette.items.map((item) => {
                const key = workingPaletteItemKey(item);
                const preview = previewByKey.get(key);
                return (
                  <WorkingPaletteSidebarItem
                    key={key}
                    item={item}
                    packLoading={preview === undefined && previewsLoading}
                    preview={preview}
                  />
                );
              })}
            </ul>
          </ScrollArea>
          <div className="flex items-center justify-between gap-2 px-1 pt-1">
            {libraryLink ?? <span />}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2"
              data-testid="working-palette-sidebar-clear"
              onClick={() =>
                void paletteActions.update({ projectId, paletteId: activePalette.id, items: [] })
              }
            >
              <TrashIcon className="size-3" />
              Clear
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

function WorkingPaletteSidebarItem({
  item,
  packLoading,
  preview,
}: {
  readonly item: WorkingPaletteItem;
  readonly packLoading: boolean;
  readonly preview: LibraryPreviewRef | undefined;
}) {
  const brushIntent = useEditorUiStore((state) => state.brushIntent);
  const selectBrush = useEditorUiStore((state) => state.selectBrush);
  const key = workingPaletteItemKey(item);
  const active = brushIntentMatchesItem(brushIntent, item);
  const kind = item.ref.kind;
  const Icon = KIND_ICON[kind];

  return (
    <li className="min-w-0">
      <button
        type="button"
        data-testid={`working-palette-sidebar-item-${key}`}
        data-active={active ? 'true' : 'false'}
        aria-pressed={active}
        aria-label={`${item.label} (${KIND_LABEL[kind]})`}
        title={`${item.label} (${KIND_LABEL[kind]})`}
        onClick={() => selectBrush(workingPaletteItemToBrushIntent(item))}
        className={cn(
          'flex aspect-square min-w-0 items-center justify-center overflow-hidden rounded-md border bg-card p-1 transition-colors hover:border-primary/70 hover:bg-accent/20',
          active ? 'border-primary ring-1 ring-primary/60' : 'border-border',
        )}
      >
        {packLoading ? (
          <Skeleton className="size-8" />
        ) : preview === undefined ? (
          <span
            aria-hidden
            className="flex shrink-0 items-center justify-center rounded bg-muted/40"
            style={{ width: GRID_THUMB_PX, height: GRID_THUMB_PX }}
          >
            <Icon className="size-4 text-muted-foreground" />
          </span>
        ) : kind === 'tile' || kind === 'placeable' ? (
          <LibraryPreviewThumb
            packId={item.ref.packId}
            preview={preview}
            sizePx={GRID_THUMB_PX}
            testId="working-palette-sidebar-thumb"
            eager
          />
        ) : (
          <LibraryPreviewMosaic
            packId={item.ref.packId}
            previews={[preview]}
            sizePx={GRID_THUMB_PX}
            testId="working-palette-sidebar-thumb"
            eager
          />
        )}
        <span className="sr-only">
          {item.label} ({KIND_LABEL[kind]})
        </span>
      </button>
    </li>
  );
}

