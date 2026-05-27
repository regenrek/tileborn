import { cn } from '@tileborne/ui';

export type GeneratePreset = 'open' | 'dungeon' | 'arena';

const presetPatterns: Record<
  GeneratePreset,
  { readonly label: string; readonly cells: readonly string[] }
> = {
  open: {
    label: 'Open field',
    cells: [
      'bg-terrain-grass/70',
      'bg-terrain-grass/70',
      'bg-terrain-grass-light/60',
      'bg-terrain-grass/70',
      'bg-terrain-grass-light/60',
      'bg-terrain-grass/70',
      'bg-terrain-grass/70',
      'bg-terrain-grass-light/60',
      'bg-terrain-grass/70',
    ],
  },
  dungeon: {
    label: 'Dungeon rooms',
    cells: [
      'bg-terrain-stone',
      'bg-terrain-stone',
      'bg-terrain-stone',
      'bg-terrain-stone',
      'bg-terrain-floor/80',
      'bg-terrain-stone',
      'bg-terrain-stone',
      'bg-terrain-floor/80',
      'bg-terrain-stone',
    ],
  },
  arena: {
    label: 'Bordered arena',
    cells: [
      'bg-terrain-stone-light',
      'bg-terrain-stone-light',
      'bg-terrain-stone-light',
      'bg-terrain-stone-light',
      'bg-terrain-water/70',
      'bg-terrain-stone-light',
      'bg-terrain-stone-light',
      'bg-terrain-stone-light',
      'bg-terrain-stone-light',
    ],
  },
};

export function GenerateMapPresetPreview({
  preset,
  selected,
  onSelect,
}: {
  readonly preset: GeneratePreset;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const pattern = presetPatterns[preset];
  const cells = pattern.cells.map((cellClass, cellNumber) => ({
    id: `${preset}-cell-${cellNumber}`,
    cellClass,
  }));

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'flex flex-col gap-2 rounded-lg border p-2 text-left transition-colors',
        selected
          ? 'border-primary bg-primary/5 ring-1 ring-primary/40'
          : 'border-border bg-card hover:bg-muted/40',
      )}
    >
      <div className="grid grid-cols-3 gap-0.5 rounded-md border border-border/60 p-1">
        {cells.map((cell) => (
          <div key={cell.id} className={cn('aspect-square rounded-sm', cell.cellClass)} />
        ))}
      </div>
      <span className="text-xs font-medium text-foreground">{pattern.label}</span>
    </button>
  );
}
