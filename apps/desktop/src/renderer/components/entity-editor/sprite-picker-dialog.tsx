import { AssetLibraryReference } from '@tileborne/core';
import type { TilesetPack } from '@tileborne/sdk-tileset/schemas';
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
import { useAssetPacks, useTilesetPacks } from '@/hooks/queries';
import { buildLibraryPreviewIndex } from '@/lib/asset-library-bridge';

/** What the picker hands back when the user chooses a sprite. */
export interface SpritePickerSelection {
  readonly placeableId: string;
  readonly name: string;
  readonly packId: string;
  readonly width: number;
  readonly height: number;
}

interface SpritePickerDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Currently assigned placeable id (highlighted in the grid). */
  readonly selectedPlaceableId: string | undefined;
  readonly onSelect: (selection: SpritePickerSelection) => void;
}

interface PickerEntry extends SpritePickerSelection {
  readonly packName: string;
  readonly integrityHash: string | undefined;
  readonly preview: ReturnType<ReturnType<typeof buildLibraryPreviewIndex>['previewForRef']>;
}

const RESULT_LIMIT = 96;

/**
 * Inline sprite picker for the Entity Editor (ADR-0028): browses the
 * PLACEABLES of every installed pack — the same render identities the
 * asset-pack browser lists under "Objects" — and returns the chosen
 * `placeableId` (+ natural size) for the entity's `visual-ref`. Reuses the
 * asset-library preview pipeline (`buildLibraryPreviewIndex` +
 * `LibraryPreviewThumb`), so thumbnails come from the same cached
 * `tileborne-asset://thumb` protocol as the asset browser.
 */
export function SpritePickerDialog({
  open,
  onOpenChange,
  selectedPlaceableId,
  onSelect,
}: SpritePickerDialogProps) {
  const packsQuery = useAssetPacks();
  const packs = useMemo(() => packsQuery.data?.packs ?? [], [packsQuery.data?.packs]);
  const packIds = useMemo(() => packs.map((pack) => String(pack.id)), [packs]);
  const packResults = useTilesetPacks(open ? packIds : []);

  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);

  const entries = useMemo((): readonly PickerEntry[] => {
    if (!open) {
      return [];
    }
    const result: PickerEntry[] = [];
    packIds.forEach((packId, index) => {
      const tilesetPack: TilesetPack | undefined = packResults[index]?.data;
      if (tilesetPack === undefined || (tilesetPack.placeables ?? []).length === 0) {
        return;
      }
      const pack = packs[index];
      const previewIndex = buildLibraryPreviewIndex(tilesetPack);
      for (const placeable of tilesetPack.placeables ?? []) {
        result.push({
          placeableId: String(placeable.id),
          name: placeable.name,
          packId,
          packName: pack?.name ?? packId,
          integrityHash: pack?.integrityHash,
          width: placeable.size.width,
          height: placeable.size.height,
          preview: previewIndex.previewForRef(
            new AssetLibraryReference({
              packId: tilesetPack.id,
              kind: 'placeable',
              refId: placeable.id,
            }),
          ),
        });
      }
    });
    return result;
  }, [open, packIds, packResults, packs]);

  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (normalizedQuery.length === 0) {
      return entries;
    }
    return entries.filter(
      (entry) =>
        entry.name.toLowerCase().includes(normalizedQuery) ||
        entry.packName.toLowerCase().includes(normalizedQuery),
    );
  }, [entries, normalizedQuery]);
  const visible = filtered.slice(0, RESULT_LIMIT);
  const loading = packsQuery.isLoading || packResults.some((result) => result.isLoading);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[70vh] flex-col gap-3 sm:max-w-[min(56rem,calc(100vw-4rem))]"
        data-testid="entity-sprite-picker"
      >
        <DialogHeader>
          <DialogTitle>Choose a sprite</DialogTitle>
          <DialogDescription>
            Pick a placeable object from your installed asset packs. Selecting one assigns it to
            this entity's visual and adopts its natural size.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search sprites by name or pack…"
            aria-label="Search sprites"
            className="pl-8"
            data-testid="entity-sprite-picker-search"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border/60 bg-card/30 p-2">
          {visible.length === 0 ? (
            <p className={cn('p-4 text-center text-muted-foreground', typography.rowMeta)}>
              {loading
                ? 'Loading installed packs…'
                : entries.length === 0
                  ? 'No installed pack exposes placeable objects. Import an asset pack first.'
                  : 'No sprites match your search.'}
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {visible.map((entry) => {
                const selected = entry.placeableId === selectedPlaceableId;
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
                      {entry.preview === undefined ? (
                        <span className="flex size-12 shrink-0 items-center justify-center rounded bg-muted/40">
                          <PuzzleIcon className="size-5 text-muted-foreground" aria-hidden />
                        </span>
                      ) : (
                        <LibraryPreviewThumb
                          packId={entry.packId}
                          preview={entry.preview}
                          sizePx={48}
                          integrityHash={entry.integrityHash}
                          alt={entry.name}
                        />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className={cn('block truncate', typography.rowTitle)}>
                          {entry.name}
                        </span>
                        <span className={cn('block truncate text-muted-foreground', typography.rowMeta)}>
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
          {filtered.length > RESULT_LIMIT ? (
            <p className={cn('p-2 text-center text-muted-foreground', typography.bodyMicro)}>
              Showing {RESULT_LIMIT} of {filtered.length} — refine your search to see more.
            </p>
          ) : null}
        </div>

        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
