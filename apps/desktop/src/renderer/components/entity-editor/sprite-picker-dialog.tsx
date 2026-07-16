import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  cn,
  typography,
} from '@tileborne/ui';
import { PuzzleIcon, SearchIcon } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';

import { LibraryPreviewThumb } from '@/components/asset-library/library-preview-thumb';
import {
  useAssetPackLibrary,
  useAssetPacks,
  useWorkingPalettePreviews,
} from '@/hooks/queries';
import { assetLibraryReferenceKey } from '@/lib/working-palettes-bridge';
import {
  SPRITE_PICKER_DOM_LIMIT,
  SPRITE_PICKER_PAGE_SIZE_PER_KIND,
  spritePickerEntryFromGroup,
  type SpritePickerSelection,
} from '@/lib/sprite-picker-model';

interface SpritePickerDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Currently assigned placeable id (highlighted in the grid). */
  readonly selectedPlaceableId: string | undefined;
  readonly onSelect: (selection: SpritePickerSelection) => void;
}


/**
 * Bounded sprite picker. It lists pack summaries once, then queries only the
 * selected pack's cached library index in two 48-row windows (animated sprites
 * and static placeables). No tileset manifest is loaded in the renderer.
 */
export function SpritePickerDialog({
  open,
  onOpenChange,
  selectedPlaceableId,
  onSelect,
}: SpritePickerDialogProps) {
  const packsQuery = useAssetPacks();
  const packs = useMemo(() => packsQuery.data?.packs ?? [], [packsQuery.data?.packs]);
  const [requestedPackId, setRequestedPackId] = useState<string | undefined>();
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [page, setPage] = useState(0);

  const selectedPack =
    packs.find((pack) => String(pack.id) === requestedPackId) ?? packs[0];
  const selectedPackId = selectedPack === undefined ? '' : String(selectedPack.id);
  const offset = page * SPRITE_PICKER_PAGE_SIZE_PER_KIND;
  const commonQuery = {
    query: deferredQuery,
    offset,
    limit: SPRITE_PICKER_PAGE_SIZE_PER_KIND,
    integrityHash: selectedPack?.integrityHash,
    keepPreviousData: false,
  } as const;
  const spritesQuery = useAssetPackLibrary(open ? selectedPackId : undefined, {
    ...commonQuery,
    groupKind: 'sprite',
  });
  const placeablesQuery = useAssetPackLibrary(open ? selectedPackId : undefined, {
    ...commonQuery,
    groupKind: 'placeable',
  });

  const entries = useMemo(() => {
    const groups = [
      ...(spritesQuery.data?.groups ?? []),
      ...(placeablesQuery.data?.groups ?? []),
    ];
    const seen = new Set<string>();
    return groups.flatMap((group) => {
      const entry = spritePickerEntryFromGroup(
        group,
        selectedPack?.name ?? selectedPackId,
        selectedPack?.integrityHash,
      );
      if (entry === undefined || seen.has(entry.placeableId)) {
        return [];
      }
      seen.add(entry.placeableId);
      return [entry];
    });
  }, [placeablesQuery.data?.groups, selectedPack, selectedPackId, spritesQuery.data?.groups]);
  const refs = useMemo(() => entries.map((entry) => entry.ref), [entries]);
  const previews = useWorkingPalettePreviews(open ? refs : []);
  const total = (spritesQuery.data?.total ?? 0) + (placeablesQuery.data?.total ?? 0);
  const hasPrevious = page > 0;
  const hasNext =
    offset + SPRITE_PICKER_PAGE_SIZE_PER_KIND < (spritesQuery.data?.total ?? 0) ||
    offset + SPRITE_PICKER_PAGE_SIZE_PER_KIND < (placeablesQuery.data?.total ?? 0);
  const loading = packsQuery.isLoading || spritesQuery.isLoading || placeablesQuery.isLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[70vh] flex-col gap-3 sm:max-w-[min(56rem,calc(100vw-4rem))]"
        data-testid="entity-sprite-picker"
      >
        <DialogHeader>
          <DialogTitle>Choose a sprite</DialogTitle>
          <DialogDescription>
            Search one installed pack at a time. Results and previews are loaded in bounded pages.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 sm:grid-cols-[minmax(12rem,0.4fr)_1fr]">
          <label className={typography.rowMeta}>
            <span className="sr-only">Asset pack</span>
            <select
              aria-label="Asset pack"
              value={selectedPackId}
              onChange={(event) => {
                setRequestedPackId(event.target.value);
                setPage(0);
              }}
              className="h-9 w-full rounded-md border border-input bg-background px-2"
              data-testid="entity-sprite-picker-pack"
            >
              {packs.map((pack) => (
                <option key={String(pack.id)} value={String(pack.id)}>
                  {pack.name}
                </option>
              ))}
            </select>
          </label>
          <div className="relative">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
              placeholder="Search sprites by name, tag, or source…"
              aria-label="Search sprites"
              className="pl-8"
              data-testid="entity-sprite-picker-search"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border/60 bg-card/30 p-2">
          {entries.length === 0 ? (
            <p className={cn('p-4 text-center text-muted-foreground', typography.rowMeta)}>
              {loading
                ? 'Loading a bounded sprite page…'
                : total === 0
                  ? 'No sprites match this pack and search.'
                  : 'This result page is empty.'}
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {entries.slice(0, SPRITE_PICKER_DOM_LIMIT).map((entry) => {
                const selected = entry.placeableId === selectedPlaceableId;
                const preview = previews.previewByKey.get(assetLibraryReferenceKey(entry.ref));
                return (
                  <li key={entry.placeableId}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(entry);
                        onOpenChange(false);
                      }}
                      data-testid={`entity-sprite-picker-item-${entry.placeableId}`}
                      data-selected={selected}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md border p-2 text-left transition-colors hover:bg-muted/50',
                        selected
                          ? 'border-primary bg-primary/10 ring-1 ring-primary/30'
                          : 'border-border bg-card',
                      )}
                    >
                      {preview === undefined ? (
                        <span className="flex size-12 shrink-0 items-center justify-center rounded bg-muted/40">
                          <PuzzleIcon className="size-5 text-muted-foreground" aria-hidden />
                        </span>
                      ) : (
                        <LibraryPreviewThumb
                          packId={entry.packId}
                          preview={preview}
                          sizePx={48}
                          integrityHash={entry.integrityHash}
                          alt={entry.name}
                        />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className={cn('block truncate', typography.rowTitle)}>
                          {entry.name}
                        </span>
                        <span
                          className={cn('block truncate text-muted-foreground', typography.rowMeta)}
                        >
                          {entry.packName} · {entry.width}×{entry.height}
                        </span>
                      </span>
                      {selected ? (
                        <Badge variant="success" className="shrink-0">
                          Current
                        </Badge>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <p className={cn('text-muted-foreground', typography.bodyMicro)} aria-live="polite">
            {total === 0
              ? 'No results'
              : `Page ${page + 1} · showing ${entries.length} of ${total} results`}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!hasPrevious}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!hasNext}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
