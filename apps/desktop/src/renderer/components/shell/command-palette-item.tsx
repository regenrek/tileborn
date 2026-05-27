import {
  CommandItem,
  Kbd,
  KbdGroup,
  cn,
  typography,
} from '@tileborne/ui';
import type { LucideIcon } from 'lucide-react';
import { ClockIcon } from 'lucide-react';

import { highlightFuzzyMatch } from '@/lib/command-palette-utils';

interface PaletteCommandItemProps {
  readonly value: string;
  readonly label: string;
  readonly query: string;
  readonly icon?: LucideIcon | undefined;
  readonly shortcut?: readonly string[] | undefined;
  readonly disabled?: boolean | undefined;
  readonly recent?: boolean | undefined;
  readonly onSelect: () => void;
}

export function PaletteCommandItem({
  value,
  label,
  query,
  icon: Icon,
  shortcut,
  disabled,
  recent,
  onSelect,
}: PaletteCommandItemProps) {
  return (
    <CommandItem
      value={value}
      {...(disabled ? { disabled: true } : {})}
      onSelect={onSelect}
    >
      {Icon ? <Icon aria-hidden /> : recent ? <ClockIcon aria-hidden /> : null}
      <span className={cn('min-w-0 flex-1 truncate', typography.bodyCompact)}>
        {highlightFuzzyMatch(label, query)}
      </span>
      {shortcut && shortcut.length > 0 ? (
        <span
          data-slot="command-shortcut"
          className="ml-auto inline-flex shrink-0 items-center group-data-selected/command-item:text-foreground"
        >
          <KbdGroup>
            {shortcut.map((key) => (
              <Kbd key={key} variant="ghost" className={typography.shortcut}>
                {key}
              </Kbd>
            ))}
          </KbdGroup>
        </span>
      ) : null}
    </CommandItem>
  );
}
