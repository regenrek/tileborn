import { Kbd, cn, typography } from '@tileborne/ui';
import { MousePointer2Icon } from 'lucide-react';

import { formatToolLabel, toolShortcut } from '@/lib/editor-tool-labels';
import type { EditorTool } from '@/stores/editor-ui-store';

interface SelectionSummaryProps {
  selectionCount: number;
  activeTool: EditorTool;
}

export function SelectionSummary({ selectionCount, activeTool }: SelectionSummaryProps) {
  const selectionLabel =
    selectionCount === 0
      ? 'No selection'
      : `${selectionCount} object${selectionCount === 1 ? '' : 's'} selected`;

  return (
    <section className="space-y-2" aria-labelledby="inspector-selection-title">
      <h3 id="inspector-selection-title" className={typography.panelTitleAccent}>
        Selection
      </h3>

      <div className="flex min-w-0 items-start gap-2">
        <MousePointer2Icon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <p className={cn('min-w-0 flex-1 break-words', typography.bodyDense)}>{selectionLabel}</p>
      </div>

      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className={cn('min-w-0 shrink break-words', typography.subsectionLabel)}>
          Active tool
        </span>
        <div className="flex min-w-0 shrink-0 items-center gap-1.5">
          <span className={cn('truncate', typography.rowTitle)}>{formatToolLabel(activeTool)}</span>
          <Kbd aria-label={`Shortcut ${toolShortcut(activeTool)}`}>{toolShortcut(activeTool)}</Kbd>
        </div>
      </div>
    </section>
  );
}
