import type { BehaviorRegistryEntry, BehaviorRegistryEntryKind } from '@tileborne/core';
import {
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
import { SearchIcon } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';

import { BehaviorBlockIcon } from './block-icon';

export function BehaviorBlockPicker({
  open,
  kind,
  entries,
  onOpenChange,
  onPick,
}: {
  readonly open: boolean;
  readonly kind: BehaviorRegistryEntryKind;
  readonly entries: readonly BehaviorRegistryEntry[];
  readonly onOpenChange: (open: boolean) => void;
  readonly onPick: (entry: BehaviorRegistryEntry) => void;
}) {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const matches = useMemo(
    () =>
      entries
        .filter((entry) => entry.kind === kind)
        .filter(
          (entry) =>
            deferredQuery.length === 0 ||
            [entry.label, entry.description, entry.category, entry.id].some((value) =>
              String(value).toLowerCase().includes(deferredQuery),
            ),
        )
        .sort(
          (left, right) =>
            left.category.localeCompare(right.category) || left.label.localeCompare(right.label),
        ),
    [deferredQuery, entries, kind],
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[80vh] max-w-xl overflow-hidden"
        data-testid={`behavior-${kind}-picker`}
      >
        <DialogHeader>
          <DialogTitle>Choose {kind}</DialogTitle>
          <DialogDescription>
            Core and enabled-plugin capabilities appear from the same registry.
          </DialogDescription>
        </DialogHeader>
        <label className="relative block">
          <SearchIcon
            className="pointer-events-none absolute left-2 top-2.5 size-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={`Search ${kind} blocks…`}
            aria-label={`Search ${kind} blocks`}
            className="pl-8"
          />
        </label>
        <div
          className="max-h-[55vh] space-y-1 overflow-y-auto pr-1"
          role="listbox"
          aria-label={`${kind} blocks`}
        >
          {matches.map((entry) => (
            <Button
              key={String(entry.id)}
              variant="ghost"
              className="h-auto w-full justify-start gap-3 px-3 py-2 text-left"
              role="option"
              onClick={() => {
                onPick(entry);
                onOpenChange(false);
              }}
            >
              <span
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-md border',
                  kind === 'event'
                    ? 'border-sky-500/40 bg-sky-500/10 text-sky-500'
                    : kind === 'condition'
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-500'
                      : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500',
                )}
              >
                <BehaviorBlockIcon name={entry.icon} />
              </span>
              <span className="min-w-0">
                <span className={cn('block', typography.rowTitle)}>{entry.label}</span>
                <span className={cn('block truncate text-muted-foreground', typography.bodyMicro)}>
                  {entry.category} · {entry.description}
                </span>
              </span>
            </Button>
          ))}
          {matches.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              No matching blocks.
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
