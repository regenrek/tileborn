import { Kbd, KbdGroup, typography } from '@tileborne/ui';
import type { ReactNode } from 'react';

interface SidebarShortcutHintProps {
  readonly label: string;
  readonly keys: readonly string[];
  readonly trailing?: ReactNode;
}

export function SidebarShortcutHint({ label, keys, trailing }: SidebarShortcutHintProps) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className={typography.bodyCompact}>{label}</span>
      <KbdGroup>
        {keys.map((key) => (
          <Kbd key={key} variant="ghost">
            {key}
          </Kbd>
        ))}
      </KbdGroup>
      {trailing}
    </span>
  );
}
