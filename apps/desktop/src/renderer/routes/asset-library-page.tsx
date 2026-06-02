import { useParams } from '@tanstack/react-router';
import { useMemo, useRef, useState } from 'react';
import { Button, Input, Kbd, cn, typography } from '@tileborne/ui';
import { FilmIcon, ImportIcon, SearchIcon } from 'lucide-react';

import { AssetLibraryEmptyState } from '@/components/asset-library/asset-library-empty-state';
import { AssetPackCard } from '@/components/asset-library/asset-pack-card';
import { AssetPackDetailsPane } from '@/components/asset-library/asset-pack-details-pane';
import { AssetPackGridSkeleton } from '@/components/asset-library/asset-pack-grid-skeleton';
import { readDroppedImportPath } from '@/components/asset-library/drop-path';
import { CloseableWorkspacePage } from '@/components/shell/closeable-workspace-page';
import { useFocusSearchShortcut } from '@/hooks/use-focus-search-shortcut';
import { useAssetPacks } from '@/hooks/queries';
import { notifyError } from '@/stores/app-notifications-store';
import { useEditorUiStore } from '@/stores/editor-ui-store';

export function AssetLibraryPage() {
  useParams({ from: '/editor/projects/$projectId/assets' });
  const assetPacksQuery = useAssetPacks();
  const activePalettePackId = useEditorUiStore((state) => state.activePalettePackId);
  const setAssetImportDialogOpen = useEditorUiStore((state) => state.setAssetImportDialogOpen);
  const setAssetImportSourcePath = useEditorUiStore((state) => state.setAssetImportSourcePath);
  const setSpriteEditorOpen = useEditorUiStore((state) => state.setSpriteEditorOpen);
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDragActive, setIsDragActive] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  useFocusSearchShortcut(searchInputRef);

  const packs = assetPacksQuery.data?.packs ?? [];
  const importPending = false;

  const filteredPacks = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (query.length === 0) {
      return packs;
    }
    return packs.filter(
      (pack) =>
        pack.name.toLowerCase().includes(query) ||
        pack.id.toLowerCase().includes(query) ||
        pack.licenseSpdxId.toLowerCase().includes(query),
    );
  }, [packs, searchQuery]);

  const selectedId =
    selectedPackId !== null && filteredPacks.some((pack) => pack.id === selectedPackId)
      ? selectedPackId
      : (filteredPacks[0]?.id ?? null);

  const openImportCenter = (path?: string | undefined) => {
    setAssetImportSourcePath(path ?? null);
    setAssetImportDialogOpen(true);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsDragActive(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setIsDragActive(false);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
    const path = readDroppedImportPath(event);
    if (path === undefined) {
      notifyError('Drop a Tileborne pack, Tiled map, standalone tileset, or source folder.');
      return;
    }
    openImportCenter(path);
  };

  return (
    <CloseableWorkspacePage
      title="Asset library"
      description="Import tilesets, audio, and gameplay packs for this project."
      className={cn(isDragActive && 'bg-primary/5')}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            data-testid="asset-library-open-sprite-studio"
            onClick={() => setSpriteEditorOpen(true)}
          >
            <FilmIcon data-icon="inline-start" />
            Sprite Studio…
          </Button>
          <Button
            data-testid="asset-library-import-pack-header"
            disabled={importPending}
            onClick={() => openImportCenter()}
          >
            <ImportIcon data-icon="inline-start" />
            Import…
          </Button>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search packs by name, id, or license…"
            className="pl-8"
            aria-label="Search asset packs"
          />
        </div>
        <p className={cn(typography.bodyMicro, 'flex items-center gap-1.5')}>
          Filter
          <Kbd>/</Kbd>
        </p>
      </div>

      <div className="flex min-h-0 flex-1 gap-6">
        <div className="min-w-0 flex-1">
          {assetPacksQuery.isLoading ? (
            <AssetPackGridSkeleton />
          ) : packs.length === 0 ? (
            <AssetLibraryEmptyState
              importPending={importPending}
              onImportDirectory={() => openImportCenter()}
              isDragActive={isDragActive}
            />
          ) : filteredPacks.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
              <p className={cn(typography.caption, 'font-medium')}>No matching packs</p>
              <p className={cn('mt-1', typography.bodyCompact)}>
                Try a different search term or clear the filter.
              </p>
            </div>
          ) : (
            <div
              className={cn(
                'grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3 rounded-xl p-1',
                isDragActive && 'outline-2 outline-dashed outline-primary/50',
              )}
              data-testid="asset-pack-grid"
            >
              {filteredPacks.map((pack) => (
                <AssetPackCard
                  key={pack.id}
                  pack={pack}
                  selected={selectedId === pack.id}
                  isActivePalette={activePalettePackId === pack.id}
                  onSelect={() => setSelectedPackId(pack.id)}
                />
              ))}
            </div>
          )}
        </div>

        {selectedId && packs.length > 0 ? (
          <aside className="hidden w-72 shrink-0 lg:block">
            <AssetPackDetailsPane packId={selectedId} />
          </aside>
        ) : null}
      </div>

      {selectedId && packs.length > 0 ? (
        <div className="lg:hidden">
          <AssetPackDetailsPane packId={selectedId} />
        </div>
      ) : null}
    </CloseableWorkspacePage>
  );
}
