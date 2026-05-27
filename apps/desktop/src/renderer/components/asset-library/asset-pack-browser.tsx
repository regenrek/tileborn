import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
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
  PaintbrushIcon,
  PlusIcon,
  PuzzleIcon,
  RefreshCwIcon,
  SearchIcon,
  ShapesIcon,
  SproutIcon,
} from 'lucide-react';
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type UIEvent,
} from 'react';

import { LibraryPreviewMosaic, LibraryPreviewThumb } from './library-preview-thumb';
import { PaletteSwitcher } from '@/components/sidebar/palette-switcher';
import { useReloadAssetLibraryCache } from '@/hooks/mutations';
import {
  ASSET_LIBRARY_PAGE_SIZE,
  useAssetLibraryCacheStatus,
  useAssetPack,
  useAssetPackLibraryPages,
  usePrefetchAssetLibraryPage,
  usePrefetchAssetThumbnail,
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
} from '@/lib/working-palettes-bridge';

interface AssetPackBrowserProps {
  readonly packId: string;
  readonly packName: string;
  readonly projectId: string | null | undefined;
  readonly variant?: 'embedded' | 'page';
}

const GRID_THUMB_PX = 40;
const GROUP_THUMB_PX = 36;
const PREVIEW_REF_RENDER_LIMIT = 4;
const GROUP_GRID_INITIAL_LIMIT = 32;
const GROUP_GRID_INCREMENT = 16;
const GROUP_GRID_MAX_LIMIT = 64;
const VIRTUAL_ROW_HEIGHT_PX = 306;
const VIRTUAL_OVERSCAN_ROWS = 4;

type TabKind = 'tileset' | 'terrain' | 'autotile' | 'placeable';

const TAB_DEFINITIONS: ReadonlyArray<{
  readonly id: TabKind;
  readonly label: string;
  readonly icon: typeof LayersIcon;
}> = [
  { id: 'tileset', label: 'Tilesets', icon: LayersIcon },
  { id: 'terrain', label: 'Terrain', icon: SproutIcon },
  { id: 'autotile', label: 'Autotiles', icon: ShapesIcon },
  { id: 'placeable', label: 'Objects', icon: PuzzleIcon },
];

const tabCountsForPack = (
  pack: ReturnType<typeof useTilesetPack>['data'],
): Record<TabKind, number> => {
  const tilesets = pack?.tilesets ?? [];
  return {
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
    placeable: new Set((pack?.placeables ?? []).map((placeable) => placeable.source.tilesetName)).size,
  };
};

const recommendedTabForPack = (counts: Record<TabKind, number>): TabKind =>
  TAB_DEFINITIONS.find(({ id }) => counts[id] > 0)?.id ?? 'tileset';

export function AssetPackBrowser({
  packId,
  packName,
  projectId,
  variant = 'embedded',
}: AssetPackBrowserProps) {
  const packQuery = useAssetPack(packId);
  const integrityHash = packQuery.data?.pack.integrityHash;
  const integrityKeyedPackId = integrityHash === undefined ? undefined : packId;
  const cacheStatusQuery = useAssetLibraryCacheStatus(integrityKeyedPackId, integrityHash);
  const cacheVersion = cacheStatusQuery.data?.cacheVersion;
  const thumbnailCacheVersion = cacheStatusQuery.data?.thumbnailCacheVersion;
  const tilesetPackQuery = useTilesetPack(integrityKeyedPackId, { integrityHash });
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [activeTab, setActiveTab] = useState<TabKind>('tileset');
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
  const prefetchThumbnail = usePrefetchAssetThumbnail();
  const reloadCache = useReloadAssetLibraryCache();
  const previewIndex = useMemo(
    () => (tilesetPackQuery.data ? buildLibraryPreviewIndex(tilesetPackQuery.data) : undefined),
    [tilesetPackQuery.data],
  );

  useEffect(() => {
    setGroupPageCount(1);
  }, [activeTab, cacheVersion, integrityHash, normalizedQuery, packId]);

  useEffect(() => {
    setManualTabSelection(false);
  }, [integrityHash, packId]);

  useEffect(() => {
    if (!manualTabSelection && activeTab !== recommendedTab) {
      setActiveTab(recommendedTab);
    }
  }, [activeTab, manualTabSelection, recommendedTab]);

  const activePalette = useActiveWorkingPalette(projectId);
  const paletteActions = useWorkingPaletteActions();

  const itemKeysInActivePalette = useMemo(() => {
    if (activePalette === undefined) {
      return new Set<string>();
    }
    return new Set(activePalette.items.map((item) => workingPaletteItemKey(item)));
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

  const handleAddDrafts = useCallback(
    (
      items: readonly { readonly ref: AssetLibraryReference; readonly label?: string | undefined }[],
      label: string,
    ) => {
      if (items.length === 0) {
        return;
      }
      void (async () => {
        const target =
          activePalette ??
          (await ensureWorkingPalette({
            projectId,
            name: `${packName} palette`,
          }));
        await paletteActions.addItems({ projectId, paletteId: target.id, items });
        notifySuccess(
          `Added ${label} (${items.length} ${items.length === 1 ? 'item' : 'items'}) to ${target.name}`,
        );
      })();
    },
    [activePalette, packName, paletteActions, projectId],
  );
  const handleAddGroup = useCallback(
    (group: AssetLibraryGroup, items?: ReturnType<typeof libraryGroupToPaletteDrafts>) => {
      handleAddDrafts(items ?? libraryGroupToPaletteDrafts(group), group.label);
    },
    [handleAddDrafts],
  );
  const handleAddReference = useCallback(
    (group: AssetLibraryGroup, ref: AssetLibraryReference, label: string) => {
      handleAddDrafts([{ ref, label }], group.label);
    },
    [handleAddDrafts],
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
            Asset-only packs can still be browsed in the pack details. Import a Tileborne pack with a{' '}
            <code>tilesets</code> section to add tiles to a working palette.
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
                      addedItemKeys={itemKeysInActivePalette}
                      integrityHash={integrityHash}
                      thumbnailCacheVersion={thumbnailCacheVersion}
                      prefetchThumbnail={prefetchThumbnail}
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
          <CardTitle className={cn(typography.caption, 'text-foreground')}>
            Library cache
          </CardTitle>
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
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const updateViewportHeight = useCallback(() => {
    setViewportHeight(viewportRef.current?.clientHeight ?? 0);
  }, []);

  useLayoutEffect(() => {
    updateViewportHeight();
    const node = viewportRef.current;
    if (node === null || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(updateViewportHeight);
    observer.observe(node);
    return () => observer.disconnect();
  }, [updateViewportHeight]);

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const target = event.currentTarget;
      setScrollTop(target.scrollTop);
      if (
        target.scrollHeight - (target.scrollTop + target.clientHeight) <
        VIRTUAL_ROW_HEIGHT_PX * 4
      ) {
        onNearEnd();
      }
    },
    [onNearEnd],
  );

  const effectiveViewportHeight = viewportHeight || VIRTUAL_ROW_HEIGHT_PX * 8;
  const startIndex = Math.max(
    0,
    Math.floor(scrollTop / VIRTUAL_ROW_HEIGHT_PX) - VIRTUAL_OVERSCAN_ROWS,
  );
  const visibleCount =
    Math.ceil(effectiveViewportHeight / VIRTUAL_ROW_HEIGHT_PX) + VIRTUAL_OVERSCAN_ROWS * 2;
  const endIndex = Math.min(groups.length, startIndex + visibleCount);
  const visibleGroups = groups.slice(startIndex, endIndex);

  return (
    <div
      ref={viewportRef}
      onScroll={handleScroll}
      className={cn(
        heightClassName,
        'overflow-y-auto rounded-md border border-border/60 bg-card/30',
      )}
      data-testid="asset-pack-browser-virtual-list"
    >
      <div className="p-3">
        <div
          className="relative"
          style={{ height: groups.length * VIRTUAL_ROW_HEIGHT_PX }}
          data-testid="asset-pack-browser-virtual-spacer"
        >
          {visibleGroups.map((group, index) => (
            <div
              key={group.id}
              className="absolute left-0 right-0"
              style={{
                height: VIRTUAL_ROW_HEIGHT_PX,
                transform: `translateY(${(startIndex + index) * VIRTUAL_ROW_HEIGHT_PX}px)`,
              }}
            >
              {renderGroup(group)}
            </div>
          ))}
        </div>
        {footer === null ? null : <div className="pt-3">{footer}</div>}
      </div>
    </div>
  );
}

function BrowserGroup({
  packId,
  group,
  previewIndex,
  onAddGroup,
  onAddReference,
  addedItemKeys,
  integrityHash,
  thumbnailCacheVersion,
  prefetchThumbnail,
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
  readonly thumbnailCacheVersion?: string | undefined;
  readonly prefetchThumbnail: ReturnType<typeof usePrefetchAssetThumbnail>;
}) {
  const [visibleLimit, setVisibleLimit] = useState(GROUP_GRID_INITIAL_LIMIT);
  const displayRefs = libraryGroupPreviewRefs(group, previewIndex, {
    limit: GROUP_GRID_MAX_LIMIT,
  });
  const previewEntries = displayRefs.map((previewRef, index) => {
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
  const visibleEntries = previewEntries.slice(0, visibleLimit);
  const groupDrafts =
    group.primaryRef === undefined && displayRefs.length > 0
      ? displayRefs.map((ref) => ({ ref, label: group.label }))
      : libraryGroupToPaletteDrafts(group);
  const added =
    groupDrafts.length > 0 &&
    groupDrafts.every((draft) => {
      return addedItemKeys.has(assetLibraryReferenceKey(draft.ref));
    });
  const previews = visibleEntries
    .flatMap((entry) => (entry.preview === undefined ? [] : [entry.preview]))
    .slice(0, PREVIEW_REF_RENDER_LIMIT);
  const prefetchGroupThumbnails = () => {
    const targets = visibleEntries
      .flatMap((entry) => (entry.preview === undefined ? [] : [entry.preview]))
      .slice(0, PREVIEW_REF_RENDER_LIMIT);
    for (const preview of targets) {
      prefetchThumbnail({
        packId,
        integrityHash,
        assetPath: preview.assetPath,
        x: preview.x,
        y: preview.y,
        width: preview.width,
        height: preview.height,
        sizePx: GRID_THUMB_PX,
        cacheVersion: thumbnailCacheVersion,
      });
    }
  };
  const canLoadMore =
    visibleLimit < previewEntries.length && visibleLimit < GROUP_GRID_MAX_LIMIT;
  const shownCount = Math.min(visibleEntries.length, previewEntries.length);
  const hiddenCount = Math.max(0, group.count - shownCount);
  return (
    <Card
      className="h-[294px] gap-2 py-2"
      data-testid={`asset-pack-browser-group-${group.id}`}
      onFocus={prefetchGroupThumbnails}
      onMouseEnter={prefetchGroupThumbnails}
    >
      <CardHeader className="flex-row items-start justify-between gap-3 px-3 py-0">
        <div className="flex min-w-0 items-center gap-2">
          <LibraryPreviewMosaic
            packId={packId}
            previews={previews}
            sizePx={GROUP_THUMB_PX}
            testId="asset-pack-browser-group-thumb"
            integrityHash={integrityHash}
            cacheVersion={thumbnailCacheVersion}
          />
          <div className="min-w-0">
            <CardTitle className={cn(typography.sectionLabelMicro, 'truncate normal-case')}>
              {group.label}
            </CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-1">
              <Badge variant="secondary">
                {group.count}{' '}
                {group.kind === 'source' ? 'objects' : group.count === 1 ? 'item' : 'items'}
              </Badge>
              {added ? <Badge variant="success">Added</Badge> : null}
            </CardDescription>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid={`asset-pack-browser-add-group-${group.id}`}
          disabled={groupDrafts.length === 0}
          onClick={() => onAddGroup(group, groupDrafts)}
          title={`Add ${group.label} to working palette`}
        >
          {added ? <CheckIcon data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}
          Add group
        </Button>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-2 px-3 py-0">
        {visibleEntries.length === 0 ? (
          <BrowserPreviewPlaceholder
            testId={`asset-pack-browser-item-${group.id}`}
            label={group.label}
          />
        ) : (
          <div
            className="grid content-start gap-1.5 overflow-hidden"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(3rem, 3rem))' }}
            data-testid={`asset-pack-browser-grid-${group.id}`}
          >
            {visibleEntries.map((entry) => (
              <BrowserPreviewCell
                key={entry.id}
                packId={packId}
                label={entry.label}
                preview={entry.preview}
                added={addedItemKeys.has(assetLibraryReferenceKey(entry.actionRef))}
                testId={`asset-pack-browser-item-${group.id}`}
                onAdd={() => onAddReference(group, entry.actionRef, entry.label)}
                integrityHash={integrityHash}
                thumbnailCacheVersion={thumbnailCacheVersion}
              />
            ))}
          </div>
        )}
      </CardContent>
      <CardFooter className="flex-wrap justify-between gap-2 px-3 py-0">
        <Badge variant="muted">
          Showing {shownCount} of {group.count}
        </Badge>
        {canLoadMore ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() =>
              setVisibleLimit((current) =>
                Math.min(GROUP_GRID_MAX_LIMIT, current + GROUP_GRID_INCREMENT),
              )
            }
            data-testid={`asset-pack-browser-load-more-group-${group.id}`}
          >
            Load more
            {hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ''}
          </Button>
        ) : null}
      </CardFooter>
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
  thumbnailCacheVersion,
}: {
  readonly packId: string;
  readonly label: string;
  readonly preview: ReturnType<typeof libraryGroupPreviews>[number] | undefined;
  readonly added: boolean;
  readonly testId: string;
  readonly onAdd: () => void;
  readonly integrityHash?: string | undefined;
  readonly thumbnailCacheVersion?: string | undefined;
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
      aria-label={`${added ? 'Added' : 'Add'} ${label}`}
      title={`${label} · ${added ? 'in working palette' : 'click to add'}`}
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
          cacheVersion={thumbnailCacheVersion}
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
