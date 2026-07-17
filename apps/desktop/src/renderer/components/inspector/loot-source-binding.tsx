import type { LootTable } from '@tileborne/core';
import { cn, typography } from '@tileborne/ui';

import type { LootBindingValue } from '@/lib/catalog-instance-overrides';

interface LootSourceBindingProps {
  /** Resolved catalog loot-table DEFINITIONS — read-only content, never edited here. */
  readonly lootTables: readonly LootTable[];
  /** The placed object's current per-instance loot binding + overrides. */
  readonly value: LootBindingValue;
  readonly onChange: (value: LootBindingValue) => void;
}

const INHERIT_OPTION = '';

const INTERACTION_MODES: readonly LootBindingValue['interactionMode'][] = ['auto', 'tap', 'hold'];

/**
 * Loot-source binding editor (ADR-0025 slice 5 / decision `c-cgsd`). The author
 * picks among the resolved catalog's loot-table DEFINITIONS and tunes the
 * per-instance interaction mode + grant flags. The definitions themselves are
 * read-only plugin/catalog content: this surface authors only the BINDING and
 * overrides stored on the placed `MapObject`, never the loot-table content.
 */
export function LootSourceBinding({ lootTables, value, onChange }: LootSourceBindingProps) {
  const grantKeys = Object.keys(value.grants);
  const selectClassName =
    'h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50';

  return (
    <section
      className="space-y-2"
      data-testid="loot-source-binding"
      aria-label="Loot source binding"
    >
      <p className={cn('px-0.5', typography.sectionLabelMicro)}>Loot source</p>

      <label className="block min-w-0 space-y-1">
        <span className={cn('block truncate', typography.rowMeta)}>Loot table</span>
        <select
          className={selectClassName}
          data-testid="loot-table-picker"
          value={value.lootTableId ?? INHERIT_OPTION}
          onChange={(event) =>
            onChange({
              ...value,
              lootTableId: event.target.value === INHERIT_OPTION ? undefined : event.target.value,
            })
          }
        >
          <option value={INHERIT_OPTION}>Inherit / none</option>
          {lootTables.map((table) => (
            <option key={table.id} value={table.id}>
              {table.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block min-w-0 space-y-1">
        <span className={cn('block truncate', typography.rowMeta)}>Interaction</span>
        <select
          className={selectClassName}
          data-testid="loot-interaction-mode"
          value={value.interactionMode}
          onChange={(event) =>
            onChange({
              ...value,
              interactionMode: event.target.value as LootBindingValue['interactionMode'],
            })
          }
        >
          {INTERACTION_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </select>
      </label>

      {grantKeys.length > 0 ? (
        <div className="space-y-1" data-testid="loot-grants">
          <span className={cn('block', typography.rowMeta)}>Grants</span>
          {grantKeys.map((key) => (
            <label key={key} className="flex items-center gap-2">
              <input
                type="checkbox"
                className="size-3.5"
                data-testid={`loot-grant-${key}`}
                checked={value.grants[key] ?? false}
                onChange={(event) =>
                  onChange({
                    ...value,
                    grants: { ...value.grants, [key]: event.target.checked },
                  })
                }
              />
              <span className={cn('min-w-0 truncate', typography.rowTitle)}>{key}</span>
            </label>
          ))}
        </div>
      ) : null}

      <p className={cn('px-0.5', typography.bodyMicro)}>
        Loot-table definitions are read-only catalog content; only this binding is saved on the
        placed object.
      </p>
    </section>
  );
}
