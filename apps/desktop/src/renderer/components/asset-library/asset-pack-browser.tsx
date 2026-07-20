import {
  Badge,
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
  DialogHeader,
  DialogTitle,
  Input,
  Progress,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
  typography,
} from '@tileborne/ui';
import type {
  AssetLibraryGroup,
  AssetLibraryGroupKind,
  AssetLibraryReference,
} from '@tileborne/core';
import { Option } from 'effect';
import {
  CheckIcon,
  LayersIcon,
  Maximize2Icon,
  PaintbrushIcon,
  PlusIcon,
  PuzzleIcon,
  RefreshCwIcon,
  SearchIcon,
  ShapesIcon,
  SproutIcon,
  FileImageIcon,
} from 'lucide-react';
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import { LibraryPreviewMosaic, LibraryPreviewThumb } from './library-preview-thumb';
import { PaletteSwitcher } from '@/components/sidebar/palette-switcher';
import { useReloadAssetLibraryCache } from '@/hooks/mutations';
import {
  ASSET_LIBRARY_PAGE_SIZE,
  useAssetLibraryCacheStatus,
  useAssetPack,
  useAssetPackLibraryPages,
  usePrefetchAssetLibraryPage,
  useTilesetPack,
  type AssetLibraryCacheStatus,
} from '@/hooks/queries';
import {
  buildLibraryPreviewIndex,
  libraryGroupPreviewRefs,
  libraryGroupPreviews,
  libraryGroupToPaletteDrafts,
} from '@/lib/asset-library-bridge';
import {
  ensureWorkingPalette,
  useActiveWorkingPalette,
  useWorkingPaletteActions,
} from '@/hooks/use-working-palettes';
import { notifySuccess } from '@/stores/app-notifications-store';
import {
  assetLibraryReferenceKey,
  workingPaletteItemKey,
  type WorkingPalette,
  type WorkingPaletteItem,
} from '@/lib/working-palettes-bridge';

interface AssetPackBrowserProps {
  readonly packId: string;
  readonly packName: string;
  readonly projectId: string | null | undefined;
  readonly initialSearch?: string | undefined;
  readonly variant?: 'embedded' | 'page';
}

const GRID_THUMB_PX = 40;
const GROUP_THUMB_PX = 36;
const PREVIEW_REF_RENDER_LIMIT = 4;
const GROUP_GRID_CELL_PX = 48;
const GROUP_GRID_GAP_PX = 6;
const GROUP_GRID_ROW_PX = GROUP_GRID_CELL_PX + GROUP_GRID_GAP_PX;
const VIRTUAL_ROW_HEIGHT_PX = 306;
const VIRTUAL_OVERSCAN_ROWS = 4;

type TabKind = 'asset' | 'tileset' | 'terrain' | 'autotile' | 'placeable';

const TAB_DEFINITIONS: ReadonlyArray<{
  readonly id: TabKind;
  readonly label: string;
  readonly icon: typeof LayersIcon;
}> = [
  { id: 'tileset', label: 'Tilesets', icon: LayersIcon },
  { id: 'terrain', label: 'Terrain', icon: SproutIcon },
  { id: 'autotile', label: 'Autotiles', icon: ShapesIcon },
  { id: 'placeable', label: 'Objects', icon: PuzzleIcon },
  { id: 'asset', label: 'Assets', icon: FileImageIcon },
];

const tabCountsForPack = (
  pack: ReturnType<typeof useTilesetPack>['data'],
): Record<TabKind, number> => {
  const tilesets = pack?.tilesets ?? [];
  return {
    asset: pack?.assets.length ?? 0,
    tileset: tilesets.filter((tileset) => tileset.tiles.length > 0).length,
    terrain: new Set(
      tilesets.flatMap((tileset) =>
        tileset.tiles.flatMap((tile) => {
          const terrainClass = Option.isOption(tile.terrainClass)
            ? Option.getOrUndefined(tile.terrainClass)
            : tile.terrainClass;
          return terrainClass === undefined ? [] : [terrainClass];
        }),
      ),
    ).size,
    autotile: tilesets.reduce((count, tileset) => count + tileset.autotileRules.length, 0),
    placeable: new Set((pack?.placeables ?? []).map((placeable) => placeable.source.tilesetName))
      .size,
  };
};

const recommendedTabForPack = (counts: Record<TabKind, number>): TabKind =>
  TAB_DEFINITIONS.find(({ id }) => counts[id] > 0)?.id ?? 'tileset';

export function AssetPackBrowser({
  packId,
  packName,
  projectId,
  initialSearch,
  variant = 'embedded',
}: AssetPackBrowserProps) {
  const packQuery = useAssetPack(packId);
  const integrityHash = packQuery.data?.pack.integrityHash;
  const integrityKeyedPackId = integrityHash === undefined ? undefined : packId;
  const cacheStatusQuery = useAssetLibraryCacheStatus(integrityKeyedPackId, integrityHash);
  const cacheVersion = cacheStatusQuery.data?.cacheVersion;
  const tilesetPackQuery = useTilesetPack(integrityKeyedPackId, { integrityHash });
  const hasDiagnosticSearch = initialSearch !== undefined && initialSearch.trim().length > 0;
  const [query, setQuery] = useState(initialSearch ?? '');
  const deferredQuery = useDeferredValue(query);
  const [activeTab, setActiveTab] = useState<TabKind>(hasDiagnosticSearch ? 'asset' : 'tileset');
  const [manualTabSelection, setManualTabSelection] = useState(false);
  const [groupPageCount, setGroupPageCount] = useState(1);
  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const tabCounts = useMemo(() => tabCountsForPack(tilesetPackQuery.data), [tilesetPackQuery.data]);
  const recommendedTab = useMemo(() => recommendedTabForPack(tabCounts), [tabCounts]);
  const activeGroupKind: AssetLibraryGroupKind = activeTab === 'placeable' ? 'source' : activeTab;
  const libraryQuery = useAssetPackLibraryPages(integrityKeyedPackId, {
    groupKind: activeGroupKind,
    query: normalizedQuery,
    pageCount: groupPageCount,
    pageSize: ASSET_LIBRARY_PAGE_SIZE,
    integrityHash,
    cacheVersion,
  });
  const prefetchLibraryPage = usePrefetchAssetLibraryPage();
  const reloadCache = useReloadAssetLibraryCache();
  const previewIndex = useMemo(
    () => (tilesetPackQuery.data ? buildLibraryPreviewIndex(tilesetPackQuery.data) : undefined),
    [tilesetPackQuery.data],
  );

  useEffect(() => {
    setGroupPageCount(1);
  }, [activeTab, cacheVersion, integrityHash, normalizedQuery, packId]);

  useEffect(() => {
    setQuery(initialSearch ?? '');
    if (hasDiagnosticSearch) {
      setActiveTab('asset');
      setManualTabSelection(true);
    }
  }, [hasDiagnosticSearch, initialSearch]);

  useEffect(() => {
    setManualTabSelection(false);
  }, [integrityHash, packId]);

  useEffect(() => {
    if (!hasDiagnosticSearch && !manualTabSelection && activeTab !== recommendedTab) {
      setActiveTab(recommendedTab);
    }
  }, [activeTab, hasDiagnosticSearch, manualTabSelection, recommendedTab]);

  const activePalette = useActiveWorkingPalette(projectId);
  const paletteActions = useWorkingPaletteActions();

  const itemsByKeyInActivePalette = useMemo(() => {
    if (activePalette === undefined) {
      return new Map<string, WorkingPaletteItem>();
    }
    return new Map(activePalette.items.map((item) => [workingPaletteItemKey(item), item] as const));
  }, [activePalette]);
  const groups = libraryQuery.data?.groups ?? [];
  const totalGroups = libraryQuery.data?.total ?? 0;
  const hasMore = totalGroups > groups.length;
  const nextOffset = groupPageCount * ASSET_LIBRARY_PAGE_SIZE;
  const prefetchNextPage = useCallback(() => {
    if (!hasMore) {
      return;
    }
    prefetchLibraryPage({
      packId,
      groupKind: activeGroupKind,
      query: normalizedQuery,
      offset: nextOffset,
      limit: ASSET_LIBRARY_PAGE_SIZE,
      integrityHash,
      cacheVersion,
    });
  }, [
    activeGroupKind,
    cacheVersion,
    hasMore,
    integrityHash,
    nextOffset,
    normalizedQuery,
    packId,
    prefetchLibraryPage,
  ]);

  const handleToggleDrafts = useCallback(
    (
      items: readonly {
        readonly ref: AssetLibraryReference;
        readonly label?: string | undefined;
      }[],
      label: string,
    ) => {
      if (items.length === 0) {
        return;
      }
      void (async () => {
        const existingItems = items
          .map((item) => itemsByKeyInActivePalette.get(assetLibraryReferenceKey(item.ref)))
          .filter((item): item is WorkingPaletteItem => item !== undefined);
        if (activePalette !== undefined && existingItems.length === items.length) {
          for (const item of existingItems) {
            await paletteActions.removeItem({
              projectId,
              paletteId: activePalette.id,
              itemId: item.id,
            });
          }
          notifySuccess(
            `Removed ${label} (${items.length} ${items.length === 1 ? 'item' : 'items'}) from ${activePalette.name}`,
          );
          return;
        }

        const missingItems = items.filter(
          (item) => !itemsByKeyInActivePalette.has(assetLibraryReferenceKey(item.ref)),
        );
        if (missingItems.length === 0) {
          return;
        }
        const target =
          activePalette ??
          (await ensureWorkingPalette({
            projectId,
            name: `${packName} palette`,
          }));
        await paletteActions.addItems({ projectId, paletteId: target.id, items: missingItems });
        notifySuccess(
          `Added ${label} (${missingItems.length} ${missingItems.length === 1 ? 'item' : 'items'}) to ${target.name}`,
        );
      })();
    },
    [activePalette, itemsByKeyInActivePalette, packName, paletteActions, projectId],
  );
  const handleAddGroup = useCallback(
    (group: AssetLibraryGroup, items?: ReturnType<typeof libraryGroupToPaletteDrafts>) => {
      handleToggleDrafts(items ?? libraryGroupToPaletteDrafts(group), group.label);
    },
    [handleToggleDrafts],
  );
  const handleAddReference = useCallback(
    (group: AssetLibraryGroup, ref: AssetLibraryReference, label: string) => {
      handleToggleDrafts([{ ref, label }], group.label);
    },
    [handleToggleDrafts],
  );

  if (packQuery.isLoading || libraryQuery.isLoading) {
    return <BrowserSkeleton />;
  }

  if (packQuery.isError || libraryQuery.isError || libraryQuery.data === undefined) {
    return (
      <Card className="border-dashed py-8 text-center" data-testid="asset-pack-browser-empty">
        <CardHeader>
          <CardTitle className={cn(typography.caption, 'text-foreground')}>
            This pack does not expose a tileset manifest
          </CardTitle>
          <CardDescription className={typography.bodyCompact}>
            Asset-only packs can still be browsed in the pack details. Import a Tileborne pack with
            a <code>tilesets</code> section to add tiles to a working palette.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div
      className="flex min-h-0 flex-col gap-3"
      data-testid="asset-pack-browser"
      data-pack-id={packId}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className={cn(typography.panelTitle, 'truncate')}>{packName}</p>
          <p className={typography.bodyMicro}>
            Showing {groups.length} of {totalGroups} {activeTab} group
            {totalGroups === 1 ? '' : 's'}
          </p>
        </div>
        <PaletteSwitcher projectId={projectId} packId={packId} packName={packName} />
      </div>

      <div className="relative">
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search tiles, autotiles, terrain, or objects…"
          aria-label="Search asset library"
          data-testid="asset-pack-browser-search"
          className="pl-8"
        />
      </div>

      <AssetLibraryCachePanel
        status={cacheStatusQuery.data}
        loading={cacheStatusQuery.isLoading}
        reloadPending={reloadCache.isPending}
        onReload={() => reloadCache.mutate({ packId, integrityHash })}
      />

      <Tabs
        value={activeTab}
        onValueChange={(next) => {
          setManualTabSelection(true);
          setActiveTab(next as TabKind);
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="self-start" data-testid="asset-pack-browser-tabs">
          {TAB_DEFINITIONS.map(({ id, label, icon: Icon }) => {
            return (
              <TabsTrigger key={id} value={id} data-testid={`asset-pack-browser-tab-${id}`}>
                <Icon className="size-3.5" aria-hidden />
                <span>{label}</span>
                {tabCounts[id] > 0 ? (
                  <Badge variant="secondary" className={cn('ml-1 px-1.5 py-0', typography.micro)}>
                    {tabCounts[id]}
                  </Badge>
                ) : null}
              </TabsTrigger>
            );
          })}
        </TabsList>
        {TAB_DEFINITIONS.map(({ id }) => {
          return (
            <TabsContent key={id} value={id} className="min-h-0 flex-1">
              {activeTab === id && groups.length === 0 ? (
                <EmptyTabState tab={id} />
              ) : (
                <VirtualizedGroupList
                  groups={activeTab === id ? groups : []}
                  heightClassName={variant === 'page' ? 'h-[60vh]' : 'h-[420px]'}
                  onNearEnd={prefetchNextPage}
                  renderGroup={(group) => (
                    <BrowserGroup
                      key={group.id}
                      packId={packId}
                      group={group}
                      previewIndex={previewIndex}
                      onAddGroup={handleAddGroup}
                      onAddReference={handleAddReference}
                      addedItemKeys={new Set(itemsByKeyInActivePalette.keys())}
                      integrityHash={integrityHash}
                    />
                  )}
                  footer={
                    activeTab === id && hasMore ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setGroupPageCount((prev) => prev + 1)}
                        onFocus={prefetchNextPage}
                        onMouseEnter={prefetchNextPage}
                        data-testid={`asset-pack-browser-load-more-${id}`}
                        className="w-full border-dashed"
                      >
                        Load {Math.min(ASSET_LIBRARY_PAGE_SIZE, totalGroups - groups.length)} more (
                        {totalGroups - groups.length} hidden)
                      </Button>
                    ) : null
                  }
                />
              )}
            </TabsContent>
          );
        })}
      </Tabs>

      {activePalette ? (
        <ActivePaletteFooter palette={activePalette} />
      ) : (
        <p
          className={cn(typography.bodyMicro, 'text-muted-foreground')}
          data-testid="asset-pack-browser-no-palette-hint"
        >
          Add an item to start a working palette. The sidebar will show only what you pick.
        </p>
      )}
    </div>
  );
}

function AssetLibraryCachePanel({
  status,
  loading,
  reloadPending,
  onReload,
}: {
  readonly status: AssetLibraryCacheStatus | undefined;
  readonly loading: boolean;
  readonly reloadPending: boolean;
  readonly onReload: () => void;
}) {
  const normalizedStatus = reloadPending
    ? 'building'
    : (status?.status ?? (loading ? 'building' : 'cold'));
  const supported = status?.supported ?? false;
  const badgeVariant =
    normalizedStatus === 'cached'
      ? 'success'
      : normalizedStatus === 'building'
        ? 'info'
        : normalizedStatus === 'stale'
          ? 'warning'
          : normalizedStatus === 'error'
            ? 'destructive'
            : 'muted';
  const label =
    normalizedStatus === 'cached'
      ? 'Cached'
      : normalizedStatus === 'building'
        ? 'Building'
        : normalizedStatus === 'stale'
          ? 'Stale'
          : normalizedStatus === 'error'
            ? 'Error'
            : 'Cold';
  const message =
    status?.message ??
    (supported
      ? 'Metadata is keyed by pack integrity and reused across dialog opens.'
      : 'Cache controls will activate when the backend cache IPC is available.');

  return (
    <Card className="gap-2 py-2" data-testid="asset-library-cache-panel">
      <CardHeader className="flex-row items-start justify-between gap-3 px-3 py-0">
        <div className="min-w-0">
          <CardTitle className={cn(typography.caption, 'text-foreground')}>Library cache</CardTitle>
          <CardDescription className={typography.bodyMicro}>{message}</CardDescription>
        </div>
        <Badge variant={badgeVariant} data-testid="asset-library-cache-status">
          {label}
        </Badge>
      </CardHeader>
      {normalizedStatus === 'building' && status?.progress !== undefined ? (
        <CardContent className="px-3 py-0">
          <Progress value={status.progress} />
        </CardContent>
      ) : null}
      <CardFooter className="flex-wrap gap-2 px-3 py-0">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!supported || reloadPending}
          data-testid="asset-library-reload-cache"
          onClick={onReload}
        >
          <RefreshCwIcon data-icon="inline-start" />
          {reloadPending ? 'Reloading…' : 'Reload cache'}
        </Button>
      </CardFooter>
    </Card>
  );
}

/**
 * Vertically virtualizes the asset-library group cards with
 * `@tanstack/react-virtual` so very large packs (thousands of groups) only
 * mount the cards currently in (or near) the viewport. Group cards are a fixed
 * row height, so we use a constant `estimateSize`. Sizing is driven entirely by
 * the scroll element's measured rect (TanStack wires up its own
 * ResizeObserver), which keeps it correct inside the resizable sidebar.
 *
 * The original behaviour is preserved exactly: same scroll container, same
 * `data-testid`s, the spacer keeps the full scroll height, and the
 * `onNearEnd` prefetch fires once the last rendered row approaches the end of
 * the loaded page so the next page is prefetched before the Load-more button.
 */
function VirtualizedGroupList({
  groups,
  heightClassName,
  renderGroup,
  footer,
  onNearEnd,
}: {
  readonly groups: readonly AssetLibraryGroup[];
  readonly heightClassName: string;
  readonly renderGroup: (group: AssetLibraryGroup) => ReactNode;
  readonly footer: ReactNode;
  readonly onNearEnd: () => void;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const virtualizer = useVirtualizer({
    count: groups.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => VIRTUAL_ROW_HEIGHT_PX,
    overscan: VIRTUAL_OVERSCAN_ROWS,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const lastRenderedIndex = virtualItems.at(-1)?.index;

  useEffect(() => {
    if (lastRenderedIndex === undefined) {
      return;
    }
    if (lastRenderedIndex >= groups.length - VIRTUAL_OVERSCAN_ROWS) {
      onNearEnd();
    }
  }, [groups.length, lastRenderedIndex, onNearEnd]);

  return (
    <div
      ref={viewportRef}
      className={cn(
        heightClassName,
        'overflow-y-auto rounded-md border border-border/60 bg-card/30',
      )}
      data-testid="asset-pack-browser-virtual-list"
    >
      <div className="p-3">
        <div
          className="relative"
          style={{ height: virtualizer.getTotalSize() }}
          data-testid="asset-pack-browser-virtual-spacer"
        >
          {virtualItems.map((virtualItem) => {
            const group = groups[virtualItem.index];
            if (group === undefined) {
              return null;
            }
            return (
              <div
                key={group.id}
                className="absolute left-0 right-0"
                style={{
                  height: VIRTUAL_ROW_HEIGHT_PX,
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                {renderGroup(group)}
              </div>
            );
          })}
        </div>
        {footer === null ? null : <div className="pt-3">{footer}</div>}
      </div>
    </div>
  );
}

interface GroupPreviewEntry {
  readonly id: string;
  readonly actionRef: AssetLibraryReference;
  readonly previewRef: AssetLibraryReference;
  readonly preview: ReturnType<typeof libraryGroupPreviews>[number] | undefined;
  readonly label: string;
}

/**
 * Row-virtualized thumbnail grid. All entries of a group are addressable via
 * the scrollbar, but only the rows in (or near) the viewport are mounted, so
 * groups with thousands of textures stay cheap. Thumbnails themselves are
 * additionally in-view gated by `LibraryPreviewThumb`, so offscreen cells never
 * issue thumbnail requests.
 */
function VirtualizedPreviewGrid({
  entries,
  className,
  testId,
  renderCell,
}: {
  readonly entries: readonly GroupPreviewEntry[];
  readonly className?: string | undefined;
  readonly testId: string;
  readonly renderCell: (entry: GroupPreviewEntry) => ReactNode;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [columns, setColumns] = useState(1);

  useEffect(() => {
    const node = viewportRef.current;
    if (node === null) {
      return;
    }
    const measure = () => {
      const width = node.clientWidth || node.offsetWidth;
      setColumns(
        Math.max(
          1,
          Math.floor((width + GROUP_GRID_GAP_PX) / (GROUP_GRID_CELL_PX + GROUP_GRID_GAP_PX)),
        ),
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const rowCount = Math.ceil(entries.length / columns);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => GROUP_GRID_ROW_PX,
    overscan: VIRTUAL_OVERSCAN_ROWS,
  });

  return (
    <div
      ref={viewportRef}
      className={cn('min-h-0 flex-1 overflow-y-auto pr-1', className)}
      data-testid={testId}
    >
      <div
        className="relative"
        style={{ height: virtualizer.getTotalSize() }}
        data-testid={`${testId}-spacer`}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const start = virtualRow.index * columns;
          return (
            <div
              key={virtualRow.index}
              className="absolute left-0 right-0 flex"
              style={{
                height: GROUP_GRID_ROW_PX,
                gap: GROUP_GRID_GAP_PX,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {entries.slice(start, start + columns).map((entry) => renderCell(entry))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const buildGroupPreviewEntries = (
  group: AssetLibraryGroup,
  previewIndex: ReturnType<typeof buildLibraryPreviewIndex> | undefined,
): readonly GroupPreviewEntry[] =>
  libraryGroupPreviewRefs(group, previewIndex).map((previewRef, index) => {
    const actionRef =
      group.kind === 'terrain' || group.kind === 'autotile'
        ? (group.primaryRef ?? previewRef)
        : previewRef;
    return {
      id: `${actionRef.kind}:${actionRef.refId}:${actionRef.tileId ?? ''}:${index}`,
      actionRef,
      previewRef,
      preview: previewIndex?.previewForRef(previewRef),
      label:
        group.kind === 'tileset'
          ? `${group.label} tile ${index + 1}`
          : group.kind === 'source'
            ? `${group.label} object ${index + 1}`
            : group.label,
    };
  });

const humanizeMetadataKey = (key: string): string =>
  key
    .replace(/^license/, 'license ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

function BrowserGroup({
  packId,
  group,
  previewIndex,
  onAddGroup,
  onAddReference,
  addedItemKeys,
  integrityHash,
}: {
  readonly packId: string;
  readonly group: AssetLibraryGroup;
  readonly previewIndex: ReturnType<typeof buildLibraryPreviewIndex> | undefined;
  readonly onAddGroup: (
    group: AssetLibraryGroup,
    items?: ReturnType<typeof libraryGroupToPaletteDrafts>,
  ) => void;
  readonly onAddReference: (
    group: AssetLibraryGroup,
    ref: AssetLibraryReference,
    label: string,
  ) => void;
  readonly addedItemKeys: ReadonlySet<string>;
  readonly integrityHash?: string | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const entries = useMemo(
    () => buildGroupPreviewEntries(group, previewIndex),
    [group, previewIndex],
  );
  const groupDrafts = useMemo(
    () =>
      group.kind === 'asset'
        ? []
        : group.primaryRef === undefined && entries.length > 0
          ? entries.map((entry) => ({ ref: entry.previewRef, label: group.label }))
          : libraryGroupToPaletteDrafts(group),
    [entries, group],
  );
  const metadataEntries = useMemo(
    () =>
      Object.entries(group.metadata).filter(
        ([key]) =>
          key === 'assetId' || key === 'path' || key === 'mime' || key.startsWith('license'),
      ),
    [group.metadata],
  );
  const added =
    groupDrafts.length > 0 &&
    groupDrafts.every((draft) => {
      return addedItemKeys.has(assetLibraryReferenceKey(draft.ref));
    });
  const previews = useMemo(() => {
    const found: NonNullable<GroupPreviewEntry['preview']>[] = [];
    for (const entry of entries) {
      if (entry.preview !== undefined) {
        found.push(entry.preview);
        if (found.length === PREVIEW_REF_RENDER_LIMIT) {
          break;
        }
      }
    }
    return found;
  }, [entries]);
  const renderCell = useCallback(
    (entry: GroupPreviewEntry) => (
      <BrowserPreviewCell
        key={entry.id}
        packId={packId}
        label={entry.label}
        preview={entry.preview}
        added={addedItemKeys.has(assetLibraryReferenceKey(entry.actionRef))}
        testId={`asset-pack-browser-item-${group.id}`}
        onAdd={() => onAddReference(group, entry.actionRef, entry.label)}
        integrityHash={integrityHash}
      />
    ),
    [addedItemKeys, group, integrityHash, onAddReference, packId],
  );
  return (
    <Card className="h-[294px] gap-2 py-2" data-testid={`asset-pack-browser-group-${group.id}`}>
      <CardHeader className="flex-row items-start justify-between gap-3 px-3 py-0">
        <div className="flex min-w-0 items-center gap-2">
          <LibraryPreviewMosaic
            packId={packId}
            previews={previews}
            sizePx={GROUP_THUMB_PX}
            testId="asset-pack-browser-group-thumb"
            integrityHash={integrityHash}
          />
          <div className="min-w-0">
            <CardTitle className={cn(typography.sectionLabelMicro, 'truncate normal-case')}>
              {group.label}
            </CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-1">
              <Badge variant="secondary">
                {group.count}{' '}
                {group.kind === 'source'
                  ? 'objects'
                  : group.kind === 'asset'
                    ? 'asset'
                    : group.count === 1
                      ? 'item'
                      : 'items'}
              </Badge>
              {added ? <Badge variant="success">Added</Badge> : null}
            </CardDescription>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid={`asset-pack-browser-add-group-${group.id}`}
            disabled={groupDrafts.length === 0}
            onClick={() => onAddGroup(group, groupDrafts)}
            title={`${added ? 'Remove' : 'Add'} ${group.label} ${added ? 'from' : 'to'} working palette`}
          >
            {added ? <CheckIcon data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}
            {added ? 'Remove group' : 'Add group'}
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            data-testid={`asset-pack-browser-expand-group-${group.id}`}
            onClick={() => setExpanded(true)}
            aria-label={`Expand ${group.label}`}
            title={`Browse all ${group.count} ${group.kind === 'source' ? 'objects' : 'items'} in a larger view`}
          >
            <Maximize2Icon aria-hidden />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-2 px-3 py-0">
        {metadataEntries.length > 0 ? (
          <dl
            className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1"
            data-testid={`asset-pack-browser-metadata-${group.id}`}
          >
            {metadataEntries.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className={cn(typography.sectionLabelMicro, 'normal-case tracking-normal')}>
                  {humanizeMetadataKey(key)}
                </dt>
                <dd className={cn(typography.bodyMicro, 'min-w-0 truncate text-foreground')}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {entries.length === 0 ? (
          <BrowserPreviewPlaceholder
            testId={`asset-pack-browser-item-${group.id}`}
            label={group.label}
          />
        ) : (
          <VirtualizedPreviewGrid
            entries={entries}
            testId={`asset-pack-browser-grid-${group.id}`}
            renderCell={renderCell}
          />
        )}
      </CardContent>
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent
          className="flex h-[85vh] flex-col gap-3 sm:max-w-[min(72rem,calc(100vw-4rem))]"
          data-testid={`asset-pack-browser-expanded-${group.id}`}
        >
          <DialogHeader>
            <DialogTitle>{group.label}</DialogTitle>
            <DialogDescription>
              {group.kind === 'asset'
                ? 'Manifest asset metadata'
                : `${group.count} ${
                    group.kind === 'source' ? 'objects' : 'items'
                  } · click a texture to add or remove it from the working palette`}
            </DialogDescription>
          </DialogHeader>
          {entries.length === 0 ? (
            <BrowserPreviewPlaceholder
              testId={`asset-pack-browser-expanded-item-${group.id}`}
              label={group.label}
            />
          ) : (
            <VirtualizedPreviewGrid
              entries={entries}
              testId={`asset-pack-browser-expanded-grid-${group.id}`}
              renderCell={renderCell}
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function BrowserPreviewCell({
  packId,
  label,
  preview,
  added,
  testId,
  onAdd,
  integrityHash,
}: {
  readonly packId: string;
  readonly label: string;
  readonly preview: ReturnType<typeof libraryGroupPreviews>[number] | undefined;
  readonly added: boolean;
  readonly testId: string;
  readonly onAdd: () => void;
  readonly integrityHash?: string | undefined;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon-lg"
      onClick={onAdd}
      data-testid={testId}
      data-added={added ? 'true' : 'false'}
      aria-pressed={added}
      aria-label={`${added ? 'Remove' : 'Add'} ${label}`}
      title={`${label} · ${added ? 'click to remove' : 'click to add'}`}
      className={cn(
        'relative size-12 overflow-hidden p-1',
        added ? 'border-primary bg-primary/10 ring-1 ring-primary/30' : 'bg-card',
      )}
    >
      {preview === undefined ? (
        <PaintbrushIcon aria-hidden />
      ) : (
        <LibraryPreviewThumb
          packId={packId}
          preview={preview}
          sizePx={GRID_THUMB_PX}
          testId="asset-pack-browser-item-thumb"
          integrityHash={integrityHash}
        />
      )}
      {added ? (
        <Badge variant="success" className="absolute right-0.5 top-0.5 px-1 py-0">
          <CheckIcon aria-label="Added" />
        </Badge>
      ) : null}
    </Button>
  );
}

function BrowserPreviewPlaceholder({
  label,
  testId,
}: {
  readonly label: string;
  readonly testId: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon-lg"
      data-testid={testId}
      data-placeholder="true"
      disabled
      aria-label={`${label} has no preview`}
      className="size-12 border-dashed"
    >
      <PaintbrushIcon aria-hidden />
    </Button>
  );
}

function EmptyTabState({ tab }: { readonly tab: TabKind }) {
  return (
    <Card
      className="border-dashed py-10 text-center"
      data-testid={`asset-pack-browser-empty-${tab}`}
    >
      <CardHeader>
        <CardDescription className={typography.bodyCompact}>
          {tab === 'tileset' && 'This pack has no tilesets to browse.'}
          {tab === 'terrain' && 'This pack does not declare terrain classes.'}
          {tab === 'autotile' && 'This pack has no autotile or Wang rules.'}
          {tab === 'placeable' && 'This pack has no placeable objects.'}
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

function ActivePaletteFooter({ palette }: { readonly palette: WorkingPalette }) {
  return (
    <div
      data-testid="asset-pack-browser-active-palette"
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2"
    >
      <span className={typography.bodyCompact}>
        Working palette: <strong className="text-foreground">{palette.name}</strong>
      </span>
      <span className={typography.bodyMicro}>
        {palette.items.length} item{palette.items.length === 1 ? '' : 's'}
      </span>
    </div>
  );
}

function BrowserSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <Skeleton className="h-6 w-1/3" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-1/2" />
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 9 }, (_, index) => `browser-skel-${index}`).map((key) => (
          <Skeleton key={key} className="aspect-square w-full" />
        ))}
      </div>
    </div>
  );
}
