import { resolveAnimatedTile } from '@tileborne/sdk-tileset/animation';
import { buildFrameIndex, type FrameIndex } from '@tileborne/sdk-tileset/renderer';
import type {
  AutotileRuleType,
  Placeable,
  PlaceableIdType,
  TerrainClassType,
  TileIdType,
  Tile,
  Tileset,
  TilesetPack,
} from '@tileborne/sdk-tileset/schemas';
import { Input, Skeleton, cn, typography } from '@tileborne/ui';
import { Option } from 'effect';
import { SearchIcon } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';

import { useAssetDataUrl, useTilesetPack } from '@/hooks/queries';
import { useEditorUiStore, type BrushIntent } from '@/stores/editor-ui-store';

interface TilesetPaletteProps {
  readonly packId: string;
}

interface TilesetPaletteContentProps {
  readonly packId: string;
  readonly pack: TilesetPack;
  readonly frameIndex: FrameIndex;
  readonly terrainClasses: readonly TerrainClassType[];
}

const DEFAULT_PAGE_SIZE = 64;
const PAGE_INCREMENT = 64;
const ANIMATION_TICK_MS = 120;
const TILE_CELL_PX = 44;
const BRUSH_PREVIEW_TILE_LIMIT = 4;

interface TilePaletteEntry {
  readonly renderKey: string;
  readonly tile: Tile;
  readonly label: string;
  readonly assetPath: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly category: string;
  readonly searchKey: string;
}

interface ObjectPaletteEntry {
  readonly renderKey: string;
  readonly placeable: Placeable;
  readonly label: string;
  readonly assetPath: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly category: string;
  readonly searchKey: string;
}

type PreviewPaletteEntry = Pick<
  TilePaletteEntry | ObjectPaletteEntry,
  'assetPath' | 'x' | 'y' | 'width' | 'height'
>;
type AutotileBrushIntent = Extract<BrushIntent, { readonly kind: 'autotile' }>;
type BrushPreviewIntent =
  | {
      readonly intentKind: 'autotile';
      readonly ruleId: AutotileBrushIntent['ruleId'];
      readonly classId?: never;
    }
  | { readonly intentKind: 'terrain'; readonly classId: TerrainClassType; readonly ruleId?: never };

function useInView(rootMargin = '320px'): {
  readonly ref: (node: HTMLElement | null) => void;
  readonly inView: boolean;
} {
  const [inView, setInView] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const nodeRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, []);

  const setRef = (node: HTMLElement | null) => {
    if (nodeRef.current === node) {
      return;
    }
    observerRef.current?.disconnect();
    observerRef.current = null;
    nodeRef.current = node;
    if (node === null) {
      return;
    }
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
          observerRef.current = null;
        }
      },
      { rootMargin },
    );
    observer.observe(node);
    observerRef.current = observer;
  };

  return { ref: setRef, inView };
}

const TileBrushButton = memo(
  function TileBrushButton({
    packId,
    entry,
    active,
    selectBrush,
    onHover,
  }: {
    readonly packId: string;
    readonly entry: TilePaletteEntry;
    readonly active: boolean;
    readonly selectBrush: (intent: BrushIntent) => void;
    readonly onHover: (entry: TilePaletteEntry | ObjectPaletteEntry | null) => void;
  }) {
    const { ref, inView } = useInView();
    const dataUrlQuery = useAssetDataUrl(packId, inView ? entry.assetPath : undefined);

    return (
      <button
        ref={ref as (node: HTMLButtonElement | null) => void}
        type="button"
        className={cn(
          'group relative aspect-square overflow-hidden rounded-md border bg-card transition-colors hover:border-primary/70 hover:bg-accent/20',
          active ? 'border-primary ring-1 ring-primary/60' : 'border-border',
        )}
        style={{ width: TILE_CELL_PX, height: TILE_CELL_PX }}
        aria-pressed={active}
        aria-label={entry.label}
        title={entry.label}
        onClick={() => selectBrush({ kind: 'tile', tileId: entry.tile.id })}
        onMouseEnter={() => onHover(entry)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(entry)}
        onBlur={() => onHover(null)}
      >
        <span className="absolute inset-0 flex items-center justify-center bg-muted/40">
          {dataUrlQuery.data?.dataUrl ? (
            <img
              data-testid="tile-palette-thumb"
              src={dataUrlQuery.data.dataUrl}
              alt=""
              className="absolute left-0 top-0 max-w-none select-none"
              style={{
                imageRendering: 'pixelated',
                transform: `translate(${-entry.x}px, ${-entry.y}px)`,
              }}
            />
          ) : (
            <Skeleton className="h-full w-full" />
          )}
        </span>
      </button>
    );
  },
  (prev, next) =>
    prev.packId === next.packId &&
    prev.entry === next.entry &&
    prev.active === next.active &&
    prev.selectBrush === next.selectBrush &&
    prev.onHover === next.onHover,
);

const ObjectBrushButton = memo(
  function ObjectBrushButton({
    packId,
    entry,
    active,
    selectBrush,
    onHover,
  }: {
    readonly packId: string;
    readonly entry: ObjectPaletteEntry;
    readonly active: boolean;
    readonly selectBrush: (intent: BrushIntent) => void;
    readonly onHover: (entry: TilePaletteEntry | ObjectPaletteEntry | null) => void;
  }) {
    const { ref, inView } = useInView();
    const dataUrlQuery = useAssetDataUrl(packId, inView ? entry.assetPath : undefined);
    const scale = Math.min((TILE_CELL_PX - 8) / entry.width, (TILE_CELL_PX - 8) / entry.height, 1);

    return (
      <button
        ref={ref as (node: HTMLButtonElement | null) => void}
        type="button"
        className={cn(
          'group relative aspect-square overflow-hidden rounded-md border bg-card transition-colors hover:border-primary/70 hover:bg-accent/20',
          active ? 'border-primary ring-1 ring-primary/60' : 'border-border',
        )}
        style={{ width: TILE_CELL_PX, height: TILE_CELL_PX }}
        aria-pressed={active}
        aria-label={entry.label}
        title={`${entry.label} (${entry.width}x${entry.height})`}
        onClick={() => selectBrush({ kind: 'placeable', placeableId: entry.placeable.id })}
        onMouseEnter={() => onHover(entry)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(entry)}
        onBlur={() => onHover(null)}
      >
        <span className="absolute inset-0 flex items-center justify-center bg-muted/40">
          {dataUrlQuery.data?.dataUrl ? (
            <img
              data-testid="object-palette-thumb"
              src={dataUrlQuery.data.dataUrl}
              alt=""
              className="absolute left-1 top-1 max-w-none select-none"
              style={{
                imageRendering: 'pixelated',
                transform: `translate(${-entry.x * scale}px, ${-entry.y * scale}px) scale(${scale})`,
                transformOrigin: 'top left',
              }}
            />
          ) : (
            <Skeleton className="h-full w-full" />
          )}
        </span>
      </button>
    );
  },
  (prev, next) =>
    prev.packId === next.packId &&
    prev.entry === next.entry &&
    prev.active === next.active &&
    prev.selectBrush === next.selectBrush &&
    prev.onHover === next.onHover,
);

const BrushPreviewButton = memo(
  function BrushPreviewButton({
    packId,
    active,
    label,
    metaLabel,
    title,
    previewTiles,
    selectBrush,
    intentKind,
    ruleId,
    classId,
  }: {
    readonly packId: string;
    readonly active: boolean;
    readonly label: string;
    readonly metaLabel: string;
    readonly title: string;
    readonly previewTiles: readonly TilePaletteEntry[];
    readonly selectBrush: (intent: BrushIntent) => void;
  } & BrushPreviewIntent) {
    const { ref, inView } = useInView();
    const hasPreview = previewTiles.length > 0;

    return (
      <button
        ref={ref as (node: HTMLButtonElement | null) => void}
        type="button"
        className={cn(
          'flex w-full items-center gap-2 rounded-md border bg-card p-1.5 text-left transition-colors hover:border-primary/70 hover:bg-accent/20',
          active ? 'border-primary ring-1 ring-primary/60' : 'border-border',
        )}
        aria-pressed={active}
        aria-label={`${label} ${metaLabel}`}
        title={title}
        onClick={() => {
          if (intentKind === 'autotile') {
            selectBrush({ kind: 'autotile', ruleId });
            return;
          }
          selectBrush({ kind: 'terrain', classId });
        }}
      >
        <span className="relative grid size-11 shrink-0 overflow-hidden rounded-md border border-border/70 bg-muted/40 p-0.5">
          {hasPreview ? (
            <span
              className={cn(
                'grid h-full w-full gap-0.5',
                previewTiles.length === 1 ? 'grid-cols-1' : 'grid-cols-2',
              )}
            >
              {previewTiles.map((entry) => (
                <BrushPreviewThumb
                  key={entry.renderKey}
                  packId={packId}
                  entry={entry}
                  enabled={inView}
                  testId={`${intentKind}-palette-thumb`}
                />
              ))}
            </span>
          ) : (
            <BrushPreviewPlaceholder testId={`${intentKind}-palette-placeholder`} />
          )}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className={cn('line-clamp-1', typography.rowTitle)}>{label}</span>
          <span className={cn('line-clamp-1', typography.rowMeta)}>{metaLabel}</span>
        </span>
      </button>
    );
  },
  (prev, next) =>
    prev.packId === next.packId &&
    prev.active === next.active &&
    prev.label === next.label &&
    prev.metaLabel === next.metaLabel &&
    prev.title === next.title &&
    prev.previewTiles === next.previewTiles &&
    prev.intentKind === next.intentKind &&
    prev.ruleId === next.ruleId &&
    prev.classId === next.classId &&
    prev.selectBrush === next.selectBrush,
);

function BrushPreviewThumb({
  packId,
  entry,
  enabled,
  testId,
}: {
  readonly packId: string;
  readonly entry: TilePaletteEntry;
  readonly enabled: boolean;
  readonly testId: string;
}) {
  const dataUrlQuery = useAssetDataUrl(packId, enabled ? entry.assetPath : undefined);
  const scale = Math.min(20 / entry.width, 20 / entry.height, 1);
  return (
    <span className="relative min-h-0 min-w-0 overflow-hidden rounded-sm bg-muted/50">
      {dataUrlQuery.data?.dataUrl ? (
        <img
          data-testid={testId}
          src={dataUrlQuery.data.dataUrl}
          alt=""
          className="absolute left-0 top-0 max-w-none select-none"
          style={{
            imageRendering: 'pixelated',
            transform: `translate(${-entry.x * scale}px, ${-entry.y * scale}px) scale(${scale})`,
            transformOrigin: 'top left',
          }}
        />
      ) : (
        <Skeleton className="h-full w-full" />
      )}
    </span>
  );
}

function BrushPreviewPlaceholder({ testId }: { readonly testId: string }) {
  return (
    <span
      data-testid={testId}
      aria-hidden
      className="flex h-full w-full items-center justify-center rounded-sm bg-muted/50"
    >
      <span className="grid size-5 grid-cols-2 gap-0.5 opacity-70">
        <span className="rounded-[2px] border border-muted-foreground/50" />
        <span className="rounded-[2px] border border-muted-foreground/50" />
        <span className="rounded-[2px] border border-muted-foreground/50" />
        <span className="rounded-[2px] border border-muted-foreground/50" />
      </span>
    </span>
  );
}

const titleCaseWord = (word: string): string => {
  if (/^[A-Z0-9]+$/.test(word)) {
    return word;
  }
  return `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`;
};

const displayNameFromIdentifier = (
  value: string,
  options: { readonly dropTerrainSuffix?: boolean } = {},
): string => {
  const namespaced = value.includes(':') ? value.split(':').slice(1).join(':') : value;
  const sourceTail =
    namespaced
      .replace(/^source=/i, '')
      .replaceAll('\\', '/')
      .split('/')
      .filter(Boolean)
      .at(-1) ?? namespaced;
  const normalized = sourceTail
    .replace(/\.(?:tmx|tsx|png|json)$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const withoutTerrainSuffix =
    options.dropTerrainSuffix && normalized.split(' ').length > 1
      ? normalized.replace(/\s+terrain$/i, '')
      : normalized;
  const displayName = withoutTerrainSuffix
    .split(' ')
    .filter(Boolean)
    .map(titleCaseWord)
    .join(' ');
  return displayName.length > 0 ? displayName : value;
};

const tileTerrainClass = (tile: Tile): TerrainClassType | undefined =>
  Option.getOrUndefined(tile.terrainClass);

const tileGroupLabel = (tile: Tile): string =>
  displayNameFromIdentifier(String(tileTerrainClass(tile) ?? tile.tags[0] ?? 'untagged'), {
    dropTerrainSuffix: true,
  });

const tileLabel = (tile: Tile, localIndex: number): string => {
  const terrainClass = tileTerrainClass(tile);
  if (terrainClass !== undefined) {
    return `${displayNameFromIdentifier(String(terrainClass), {
      dropTerrainSuffix: true,
    })} ${localIndex + 1}`;
  }
  return tile.tags[0] ?? `Tile ${localIndex + 1}`;
};

const currentTileId = (frameIndex: FrameIndex, tile: Tile, animationTimeMs: number): TileIdType => {
  const frame = frameIndex.lookup(tile.id);
  if (frame?.animationId === undefined) {
    return tile.id;
  }
  const animation = frameIndex.getCompiledAnimation(frame.animationId);
  return animation === undefined ? tile.id : resolveAnimatedTile(animation, animationTimeMs);
};

const tileEntry = (
  frameIndex: FrameIndex,
  tile: Tile,
  localIndex: number,
  animationTimeMs: number,
): TilePaletteEntry | undefined => {
  const frame = frameIndex.lookup(currentTileId(frameIndex, tile, animationTimeMs));
  const assetPath = frame?.sourceAssetPaths[0];
  if (frame === undefined || assetPath === undefined) {
    return undefined;
  }
  const label = tileLabel(tile, localIndex);
  const category = tileGroupLabel(tile);
  const searchKey = `${label} ${category} ${tile.tags.join(' ')}`.toLowerCase();
  return {
    renderKey: `${tile.id}:${localIndex}`,
    tile,
    label,
    assetPath,
    x: frame.uv.x,
    y: frame.uv.y,
    width: frame.uv.w,
    height: frame.uv.h,
    category,
    searchKey,
  };
};

interface PaletteGroup {
  readonly category: string;
  readonly entries: readonly TilePaletteEntry[];
}

interface TilesetPaletteModel {
  readonly tileset: Tileset;
  readonly groups: readonly PaletteGroup[];
  readonly entryByTileId: ReadonlyMap<TileIdType, TilePaletteEntry>;
}

interface ObjectPaletteGroup {
  readonly category: string;
  readonly entries: readonly ObjectPaletteEntry[];
}

interface ObjectPaletteModel {
  readonly groups: readonly ObjectPaletteGroup[];
  readonly entryByPlaceableId: ReadonlyMap<PlaceableIdType, ObjectPaletteEntry>;
}

interface BrushPreviewModel {
  readonly ruleTilesByRuleId: ReadonlyMap<string, readonly TilePaletteEntry[]>;
  readonly terrainTilesByClass: ReadonlyMap<TerrainClassType, readonly TilePaletteEntry[]>;
}

function groupTiles(
  tileset: Tileset,
  frameIndex: FrameIndex,
  animationTimeMs: number,
  objectOnlyTileIds: ReadonlySet<string>,
): TilesetPaletteModel {
  const byCategory = new Map<string, TilePaletteEntry[]>();
  const entryByTileId = new Map<TileIdType, TilePaletteEntry>();
  tileset.tiles.forEach((tile, localIndex) => {
    if (objectOnlyTileIds.has(String(tile.id))) {
      return;
    }
    const entry = tileEntry(frameIndex, tile, localIndex, animationTimeMs);
    if (entry === undefined) {
      return;
    }
    entryByTileId.set(tile.id, entry);
    const entries = byCategory.get(entry.category) ?? [];
    entries.push(entry);
    byCategory.set(entry.category, entries);
  });
  return {
    tileset,
    groups: [...byCategory.entries()].map(([category, entries]) => ({
      category,
      entries,
    })),
    entryByTileId,
  };
}

const optionText = (
  value: string | { readonly _tag: string; readonly value?: string } | undefined,
): string | undefined => {
  if (typeof value === 'object' && value !== null && '_tag' in value) {
    return value._tag === 'Some' ? value.value : undefined;
  }
  return value;
};

const placeableCategory = (placeable: Placeable): string => {
  const explicitTag = placeable.tags.find((tag) => !tag.startsWith('tiled:'));
  if (explicitTag !== undefined) {
    return explicitTag;
  }
  return (
    optionText(placeable.source.objectClass) ??
    optionText(placeable.source.objectType) ??
    placeable.source.tilesetName
  );
};

const placeableEntry = (
  placeable: Placeable,
  assetPathById: ReadonlyMap<string, string>,
): ObjectPaletteEntry | undefined => {
  const frame = placeable.frames[0];
  if (frame === undefined) {
    return undefined;
  }
  const assetPath = assetPathById.get(String(frame.assetId));
  if (assetPath === undefined) {
    return undefined;
  }
  const category = placeableCategory(placeable);
  const sourceParts = [
    placeable.source.tilesetName,
    optionText(placeable.source.objectType),
    optionText(placeable.source.objectClass),
  ].filter((entry): entry is string => entry !== undefined);
  const searchKey = `${placeable.name} ${category} ${sourceParts.join(' ')} ${placeable.tags.join(
    ' ',
  )}`.toLowerCase();
  return {
    renderKey: String(placeable.id),
    placeable,
    label: placeable.name,
    assetPath,
    x: frame.uv.x,
    y: frame.uv.y,
    width: placeable.size.width,
    height: placeable.size.height,
    category,
    searchKey,
  };
};

const groupPlaceables = (pack: TilesetPack): ObjectPaletteModel => {
  const assetPathById = new Map(pack.assets.map((asset) => [String(asset.id), asset.path]));
  const byCategory = new Map<string, ObjectPaletteEntry[]>();
  const entryByPlaceableId = new Map<PlaceableIdType, ObjectPaletteEntry>();
  for (const placeable of pack.placeables ?? []) {
    const entry = placeableEntry(placeable, assetPathById);
    if (entry === undefined) {
      continue;
    }
    entryByPlaceableId.set(placeable.id, entry);
    const entries = byCategory.get(entry.category) ?? [];
    entries.push(entry);
    byCategory.set(entry.category, entries);
  }
  return {
    groups: [...byCategory.entries()].map(([category, entries]) => ({
      category,
      entries,
    })),
    entryByPlaceableId,
  };
};

const compareMaskKeys = (left: string, right: string): number => {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (!Number.isNaN(leftNumber) && !Number.isNaN(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return left.localeCompare(right);
};

const addPreviewTile = (
  entries: TilePaletteEntry[],
  seenTileIds: Set<string>,
  entry: TilePaletteEntry | undefined,
): void => {
  if (entry === undefined || entries.length >= BRUSH_PREVIEW_TILE_LIMIT) {
    return;
  }
  const tileKey = String(entry.tile.id);
  if (seenTileIds.has(tileKey)) {
    return;
  }
  seenTileIds.add(tileKey);
  entries.push(entry);
};

const previewEntriesForRule = (
  rule: AutotileRuleType,
  entryByTileId: ReadonlyMap<TileIdType, TilePaletteEntry>,
): readonly TilePaletteEntry[] => {
  const entries: TilePaletteEntry[] = [];
  const seenTileIds = new Set<string>();
  const addTileId = (tileId: TileIdType | undefined) => {
    if (tileId !== undefined) {
      addPreviewTile(entries, seenTileIds, entryByTileId.get(tileId));
    }
  };

  addTileId(Option.getOrUndefined(rule.fallbackTileId));
  for (const mask of Object.keys(rule.maskToTileIds).sort(compareMaskKeys)) {
    for (const tileId of rule.maskToTileIds[mask] ?? []) {
      addTileId(tileId);
      if (entries.length >= BRUSH_PREVIEW_TILE_LIMIT) {
        return entries;
      }
    }
  }
  return entries;
};

const buildBrushPreviewModel = (
  paletteModels: readonly TilesetPaletteModel[],
): BrushPreviewModel => {
  const ruleTilesByRuleId = new Map<string, readonly TilePaletteEntry[]>();
  const terrainTilesByClass = new Map<TerrainClassType, TilePaletteEntry[]>();
  const seenTerrainTileIds = new Map<TerrainClassType, Set<string>>();

  const addTerrainTile = (terrainClass: TerrainClassType, entry: TilePaletteEntry | undefined) => {
    const entries = terrainTilesByClass.get(terrainClass) ?? [];
    const seen = seenTerrainTileIds.get(terrainClass) ?? new Set<string>();
    addPreviewTile(entries, seen, entry);
    terrainTilesByClass.set(terrainClass, entries);
    seenTerrainTileIds.set(terrainClass, seen);
  };

  for (const model of paletteModels) {
    for (const group of model.groups) {
      for (const entry of group.entries) {
        const terrainClass = tileTerrainClass(entry.tile);
        if (terrainClass !== undefined) {
          addTerrainTile(terrainClass, entry);
        }
      }
    }

    for (const rule of model.tileset.autotileRules) {
      const previewTiles = previewEntriesForRule(rule, model.entryByTileId);
      ruleTilesByRuleId.set(String(rule.id), previewTiles);
      for (const terrainClass of rule.terrainClasses) {
        for (const entry of previewTiles) {
          addTerrainTile(terrainClass, entry);
        }
      }
    }
  }

  return { ruleTilesByRuleId, terrainTilesByClass };
};

const packHasAnimatedTiles = (pack: TilesetPack, frameIndex: FrameIndex): boolean => {
  for (const tileset of pack.tilesets) {
    for (const tile of tileset.tiles) {
      if (frameIndex.lookup(tile.id)?.animationId !== undefined) {
        return true;
      }
    }
  }
  return false;
};

const collectTerrainClasses = (pack: TilesetPack): readonly TerrainClassType[] => {
  const terrainClasses = new Set<TerrainClassType>();
  for (const tileset of pack.tilesets) {
    for (const tile of tileset.tiles) {
      const terrainClass = tileTerrainClass(tile);
      if (terrainClass !== undefined) {
        terrainClasses.add(terrainClass);
      }
    }
    for (const rule of tileset.autotileRules) {
      for (const terrainClass of rule.terrainClasses) {
        terrainClasses.add(terrainClass);
      }
    }
    for (const transition of tileset.terrainTransitions) {
      terrainClasses.add(transition.from);
      terrainClasses.add(transition.to);
    }
  }
  return Array.from(terrainClasses).sort();
};

const isActiveBrush = (active: BrushIntent, next: BrushIntent): boolean => {
  if (active.kind !== next.kind) {
    return false;
  }
  switch (next.kind) {
    case 'tile':
      return active.kind === 'tile' && active.tileId === next.tileId;
    case 'autotile':
      return active.kind === 'autotile' && active.ruleId === next.ruleId;
    case 'terrain':
      return active.kind === 'terrain' && active.classId === next.classId;
    case 'placeable':
      return active.kind === 'placeable' && active.placeableId === next.placeableId;
    case 'eraser':
      return true;
  }
};

const autotileLabel = (rule: AutotileRuleType): string => displayNameFromIdentifier(rule.name);

const terrainClassLabel = (terrainClass: TerrainClassType): string =>
  displayNameFromIdentifier(String(terrainClass), { dropTerrainSuffix: true });

const matchesQuery = (text: string, normalizedQuery: string): boolean =>
  normalizedQuery.length === 0 || text.toLowerCase().includes(normalizedQuery);

export function TilesetPalette({ packId }: TilesetPaletteProps) {
  const packQuery = useTilesetPack(packId);
  const pack = packQuery.data;

  const frameIndex = useMemo(() => (pack ? buildFrameIndex(pack) : undefined), [pack]);
  const terrainClasses = useMemo(() => (pack ? collectTerrainClasses(pack) : []), [pack]);

  if (packQuery.isLoading) {
    return (
      <div className="space-y-2 px-1" aria-busy="true" aria-label="Loading tileset">
        <Skeleton className="h-3 w-24" />
        <div
          className="grid gap-1.5"
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${TILE_CELL_PX}px, 1fr))` }}
        >
          {Array.from({ length: 12 }, (_, tileNumber) => `tileset-skeleton-tile-${tileNumber}`).map(
            (tileKey) => (
              <Skeleton key={tileKey} className="aspect-square w-full" />
            ),
          )}
        </div>
      </div>
    );
  }

  if (packQuery.isError) {
    return (
      <div className="space-y-1 px-2" data-testid="tileset-palette-error">
        <p className={cn(typography.panelTitle)}>Tileset palette</p>
        <p className={cn(typography.rowMeta, 'text-foreground/80')}>
          This pack has no paintable tilesets.
        </p>
        <p className={cn(typography.rowMeta)}>
          Asset-only packs can be browsed in the Asset library, but the brush needs a Tileborne pack
          with a <code>tilesets</code> manifest section.
        </p>
      </div>
    );
  }

  if (pack === undefined || frameIndex === undefined) {
    return null;
  }

  if (pack.tilesets.length === 0) {
    return <p className={cn('px-1', typography.bodyCompact)}>No tilesets in this pack</p>;
  }

  return (
    <TilesetPaletteContent
      key={packId}
      packId={packId}
      pack={pack}
      frameIndex={frameIndex}
      terrainClasses={terrainClasses}
    />
  );
}

function TilesetPaletteContent({
  packId,
  pack,
  frameIndex,
  terrainClasses,
}: TilesetPaletteContentProps) {
  const [animationTimeMs, setAnimationTimeMs] = useState(0);
  const [query, setQuery] = useState('');
  const [pageSize, setPageSize] = useState<Record<string, number>>({});
  const [hoverEntry, setHoverEntry] = useState<TilePaletteEntry | ObjectPaletteEntry | null>(null);

  const brushIntent = useEditorUiStore((state) => state.brushIntent);
  const selectBrush = useEditorUiStore((state) => state.selectBrush);
  const hasAnimatedTiles = useMemo(
    () => packHasAnimatedTiles(pack, frameIndex),
    [pack, frameIndex],
  );

  useEffect(() => {
    if (!hasAnimatedTiles) {
      setAnimationTimeMs(0);
      return;
    }
    const interval = window.setInterval(() => {
      setAnimationTimeMs((value) => value + ANIMATION_TICK_MS);
    }, ANIMATION_TICK_MS);
    return () => window.clearInterval(interval);
  }, [hasAnimatedTiles]);

  const normalizedQuery = useMemo(() => query.trim().toLowerCase(), [query]);
  const objectOnlyTileIds = useMemo(
    () =>
      new Set(
        (pack.placeables ?? [])
          .filter((placeable) => placeable.placementMode === 'object')
          .flatMap((placeable) => placeable.frames.map((frame) => String(frame.tileId))),
      ),
    [pack],
  );
  const paletteModels = useMemo(
    () =>
      pack.tilesets.map((tileset) =>
        groupTiles(tileset, frameIndex, animationTimeMs, objectOnlyTileIds),
      ),
    [animationTimeMs, frameIndex, objectOnlyTileIds, pack],
  );
  const objectPaletteModel = useMemo(() => groupPlaceables(pack), [pack]);
  const brushPreviewModel = useMemo(
    () => buildBrushPreviewModel(paletteModels),
    [paletteModels],
  );

  const selectedEntry = useMemo(() => {
    if (brushIntent.kind === 'placeable') {
      return objectPaletteModel.entryByPlaceableId.get(brushIntent.placeableId);
    }
    if (brushIntent.kind !== 'tile') {
      return undefined;
    }
    for (const model of paletteModels) {
      const entry = model.entryByTileId.get(brushIntent.tileId);
      if (entry !== undefined) {
        return entry;
      }
    }
    return undefined;
  }, [brushIntent, objectPaletteModel, paletteModels]);

  const readoutEntry = hoverEntry ?? selectedEntry;

  const visibleTerrainEntries = useMemo(
    () =>
      terrainClasses
        .map((terrainClass) => {
          const label = terrainClassLabel(terrainClass);
          const previewTiles = brushPreviewModel.terrainTilesByClass.get(terrainClass) ?? [];
          return {
            terrainClass,
            label,
            metaLabel:
              previewTiles.length > 0 ? 'Terrain class' : 'Terrain class · no preview tile',
            title: String(terrainClass),
            previewTiles,
            searchKey: `${label} ${terrainClass} terrain terrain class`,
          };
        })
        .filter((entry) => matchesQuery(entry.searchKey, normalizedQuery)),
    [brushPreviewModel, normalizedQuery, terrainClasses],
  );

  return (
    <div className="space-y-3" data-testid="tileset-palette">
      <div className="space-y-2 px-1">
        <p className={cn(typography.sectionLabelMicro)}>Tileset palette</p>
        <div className="relative">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tiles…"
            aria-label="Search tiles"
            data-testid="tileset-palette-search"
            className="h-7 pl-7 text-xs"
          />
        </div>
        <div
          className="flex min-h-[36px] items-center gap-2 rounded-md border border-border bg-muted/20 px-2 py-1"
          data-testid="tileset-palette-readout"
        >
          {readoutEntry ? (
            <>
              <span className="relative size-7 shrink-0 overflow-hidden rounded bg-muted/40">
                <ReadoutThumb packId={packId} entry={readoutEntry} />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className={cn('truncate', typography.rowTitle)}>{readoutEntry.label}</span>
                <span className={cn('truncate', typography.rowMeta)}>
                  {readoutEntry.category} · {readoutEntry.width}×{readoutEntry.height}
                </span>
              </span>
            </>
          ) : (
            <span className={cn(typography.rowMeta)}>
              {brushIntent.kind === 'eraser' ? 'Eraser brush active' : 'Hover or pick a tile'}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {paletteModels.map(({ tileset, groups }) => {
          const visibleAutotileEntries = [];
          for (const rule of tileset.autotileRules) {
            const label = autotileLabel(rule);
            const previewTiles = brushPreviewModel.ruleTilesByRuleId.get(String(rule.id)) ?? [];
            const searchKey = `${label} ${rule.name} ${rule.terrainClasses.join(
              ' ',
            )} autotile ${rule._tag}`;
            if (matchesQuery(searchKey, normalizedQuery)) {
              visibleAutotileEntries.push({ label, previewTiles, rule, searchKey });
            }
          }
          return (
            <section key={tileset.id} className="space-y-2">
              <div className="px-1">
                <p className={cn(typography.sectionLabelMicro, 'normal-case')}>{tileset.name}</p>
                <p className={typography.bodyMicro}>{tileset.tiles.length} tiles</p>
              </div>
              {groups.map((group) => {
                const filtered = group.entries.filter((entry) =>
                  matchesQuery(entry.searchKey, normalizedQuery),
                );
                if (filtered.length === 0) {
                  return null;
                }
                const groupKey = `${tileset.id}:${group.category}`;
                const limit = pageSize[groupKey] ?? DEFAULT_PAGE_SIZE;
                const visible = filtered.slice(0, limit);
                const hasMore = filtered.length > visible.length;
                return (
                  <div key={groupKey} className="space-y-1.5">
                    <div className="flex items-center justify-between px-1">
                      <p className={cn(typography.sectionLabelMicro, 'capitalize')}>
                        {group.category}
                      </p>
                      <span className={typography.bodyMicro}>
                        {visible.length}/{filtered.length}
                      </span>
                    </div>
                    <div
                      className="grid gap-1.5"
                      style={{
                        gridTemplateColumns: `repeat(auto-fill, minmax(${TILE_CELL_PX}px, 1fr))`,
                      }}
                    >
                      {visible.map((entry) => (
                        <TileBrushButton
                          key={entry.renderKey}
                          packId={packId}
                          entry={entry}
                          active={isActiveBrush(brushIntent, {
                            kind: 'tile',
                            tileId: entry.tile.id,
                          })}
                          selectBrush={selectBrush}
                          onHover={setHoverEntry}
                        />
                      ))}
                    </div>
                    {hasMore ? (
                      <button
                        type="button"
                        className={cn(
                          'w-full rounded-md border border-dashed border-border bg-card/40 px-2 py-1 hover:border-primary/60 hover:bg-accent/10',
                          typography.bodyMicro,
                        )}
                        data-testid={`tileset-palette-load-more-${group.category}`}
                        onClick={() =>
                          setPageSize((prev) => ({
                            ...prev,
                            [groupKey]: (prev[groupKey] ?? DEFAULT_PAGE_SIZE) + PAGE_INCREMENT,
                          }))
                        }
                      >
                        Load more ({filtered.length - visible.length})
                      </button>
                    ) : null}
                  </div>
                );
              })}
              {tileset.autotileRules.length > 0 ? (
                <div className="space-y-1.5">
                  <p className={cn('px-1', typography.sectionLabelMicro)}>Autotiles</p>
                  <div className="grid gap-1.5">
                    {visibleAutotileEntries.map((entry) => (
                      <BrushPreviewButton
                        key={entry.rule.id}
                        packId={packId}
                        label={entry.label}
                        metaLabel="Autotile"
                        title={`${entry.label} autotile · ${entry.rule.name} · ${entry.rule.id}`}
                        previewTiles={entry.previewTiles}
                        active={isActiveBrush(brushIntent, {
                          kind: 'autotile',
                          ruleId: entry.rule.id,
                        })}
                        intentKind="autotile"
                        ruleId={entry.rule.id}
                        selectBrush={selectBrush}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      {terrainClasses.length > 0 ? (
        <section className="space-y-1.5">
          <p className={cn('px-1', typography.sectionLabelMicro)}>Terrain classes</p>
          <div className="grid gap-1.5">
            {visibleTerrainEntries.map((entry) => (
              <BrushPreviewButton
                key={entry.terrainClass}
                packId={packId}
                label={entry.label}
                metaLabel={entry.metaLabel}
                title={entry.title}
                previewTiles={entry.previewTiles}
                active={isActiveBrush(brushIntent, {
                  kind: 'terrain',
                  classId: entry.terrainClass,
                })}
                intentKind="terrain"
                classId={entry.terrainClass}
                selectBrush={selectBrush}
              />
            ))}
          </div>
        </section>
      ) : null}

      {objectPaletteModel.groups.length > 0 ? (
        <section className="space-y-2">
          <div className="px-1">
            <p className={cn(typography.sectionLabelMicro)}>Objects</p>
            <p className={typography.bodyMicro}>{pack.placeables?.length ?? 0} placeables</p>
          </div>
          {objectPaletteModel.groups.map((group) => {
            const filtered = group.entries.filter((entry) =>
              matchesQuery(entry.searchKey, normalizedQuery),
            );
            if (filtered.length === 0) {
              return null;
            }
            const groupKey = `objects:${group.category}`;
            const limit = pageSize[groupKey] ?? DEFAULT_PAGE_SIZE;
            const visible = filtered.slice(0, limit);
            const hasMore = filtered.length > visible.length;
            return (
              <div key={groupKey} className="space-y-1.5">
                <div className="flex items-center justify-between px-1">
                  <p className={cn(typography.sectionLabelMicro, 'capitalize')}>{group.category}</p>
                  <span className={typography.bodyMicro}>
                    {visible.length}/{filtered.length}
                  </span>
                </div>
                <div
                  className="grid gap-1.5"
                  style={{
                    gridTemplateColumns: `repeat(auto-fill, minmax(${TILE_CELL_PX}px, 1fr))`,
                  }}
                >
                  {visible.map((entry) => (
                    <ObjectBrushButton
                      key={entry.renderKey}
                      packId={packId}
                      entry={entry}
                      active={isActiveBrush(brushIntent, {
                        kind: 'placeable',
                        placeableId: entry.placeable.id,
                      })}
                      selectBrush={selectBrush}
                      onHover={setHoverEntry}
                    />
                  ))}
                </div>
                {hasMore ? (
                  <button
                    type="button"
                    className={cn(
                      'w-full rounded-md border border-dashed border-border bg-card/40 px-2 py-1 hover:border-primary/60 hover:bg-accent/10',
                      typography.bodyMicro,
                    )}
                    data-testid={`objects-palette-load-more-${group.category}`}
                    onClick={() =>
                      setPageSize((prev) => ({
                        ...prev,
                        [groupKey]: (prev[groupKey] ?? DEFAULT_PAGE_SIZE) + PAGE_INCREMENT,
                      }))
                    }
                  >
                    Load more ({filtered.length - visible.length})
                  </button>
                ) : null}
              </div>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}

function ReadoutThumb({
  packId,
  entry,
}: {
  readonly packId: string;
  readonly entry: PreviewPaletteEntry;
}) {
  const dataUrlQuery = useAssetDataUrl(packId, entry.assetPath);
  if (!dataUrlQuery.data?.dataUrl) {
    return <Skeleton className="h-full w-full" />;
  }
  const scale = Math.min(28 / entry.width, 28 / entry.height, 1);
  return (
    <img
      src={dataUrlQuery.data.dataUrl}
      alt=""
      className="absolute left-0 top-0 max-w-none select-none"
      style={{
        imageRendering: 'pixelated',
        transform: `translate(${-entry.x * scale}px, ${-entry.y * scale}px) scale(${scale})`,
        transformOrigin: 'top left',
      }}
    />
  );
}
