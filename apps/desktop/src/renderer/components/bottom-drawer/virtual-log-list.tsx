import { useCallback, useEffect, useRef, useState } from 'react';
import { cn, typography } from '@tileborne/ui';

import { formatLogTimestamp } from '@/components/bottom-drawer/format';

export interface LogEntryRow {
  readonly ts: string;
  readonly level: string;
  readonly msg: string;
}

interface VirtualLogListProps {
  readonly entries: readonly LogEntryRow[];
}

const ROW_HEIGHT = 20;
const OVERSCAN = 6;

export function VirtualLogList({ entries }: VirtualLogListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [viewportHeight, setViewportHeight] = useState(160);
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    const element = parentRef.current;
    if (!element) {
      return undefined;
    }

    const updateHeight = () => setViewportHeight(element.clientHeight);
    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = parentRef.current;
    if (!element || entries.length === 0) {
      return;
    }
    element.scrollTop = element.scrollHeight;
    setScrollTop(element.scrollTop);
  }, [entries.length]);

  const onScroll = useCallback(() => {
    const element = parentRef.current;
    if (!element) {
      return;
    }
    setScrollTop(element.scrollTop);
  }, []);

  const totalHeight = entries.length * ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(
    entries.length,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
  );
  const visibleEntries = entries.slice(startIndex, endIndex);

  return (
    <div
      ref={parentRef}
      className="h-full overflow-auto rounded-md border border-border bg-card/40"
      onScroll={onScroll}
      data-testid="drawer-virtual-log-list"
    >
      <div className="relative font-mono" style={{ height: totalHeight }}>
        {visibleEntries.map((entry, index) => {
          const rowIndex = startIndex + index;
          return (
            <div
              key={`${entry.ts}:${rowIndex}:${entry.msg.slice(0, 24)}`}
              className={cn(
                'absolute inset-x-0 flex min-w-0 items-center gap-2 px-2',
                typography.bodyMicro,
              )}
              style={{ top: rowIndex * ROW_HEIGHT, height: ROW_HEIGHT }}
            >
              <span className="shrink-0 text-muted-foreground">{formatLogTimestamp(entry.ts)}</span>
              <span
                className={cn(
                  'shrink-0 uppercase',
                  entry.level === 'error' || entry.level === 'fatal'
                    ? 'text-destructive'
                    : entry.level === 'warn'
                      ? 'text-warning'
                      : 'text-muted-foreground',
                )}
              >
                {entry.level}
              </span>
              <span className="min-w-0 truncate text-foreground">{entry.msg}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
