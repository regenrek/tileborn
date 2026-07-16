import { useCallback, useEffect, useEffectEvent, useState } from 'react';
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Kbd,
  motion,
  statusSurface,
  typography,
} from '@tileborne/ui';
import { SquareIcon } from 'lucide-react';

import { isEditableTarget } from '@/editor/is-editable-target';
import {
  formatPlaytestRuntimeStatus,
  PLAYTEST_RUNTIME_STARTING_MESSAGE,
  resolvePlaytestConnectionStatus,
  resolvePlaytestPluginName,
  type PlaytestConnectionStatus,
  type PlaytestSessionConnectionInput,
} from '@/lib/playtest-runtime-status';

const connectionStatusConfig: Record<
  PlaytestConnectionStatus,
  { readonly label: string; readonly dot: string; readonly surface: string }
> = {
  idle: {
    label: 'Idle',
    dot: 'bg-muted-foreground',
    surface: 'border-border bg-muted/50 text-muted-foreground',
  },
  connecting: {
    label: 'Connecting',
    dot: 'bg-warning motion-safe:animate-pulse',
    surface: statusSurface.warning,
  },
  live: {
    label: 'Live',
    dot: 'bg-success',
    surface: statusSurface.success,
  },
  error: {
    label: 'Error',
    dot: 'bg-destructive',
    surface: statusSurface.error,
  },
  disconnected: {
    label: 'Disconnected',
    dot: 'bg-muted-foreground',
    surface: 'border-border bg-muted/50 text-muted-foreground',
  },
};

interface PlaytestOverlayProps {
  readonly sessionId: string;
  readonly activePlugins: readonly string[];
  readonly session: PlaytestSessionConnectionInput | undefined;
  readonly isStopping: boolean;
  readonly onStop: () => void | Promise<void>;
}

export function PlaytestOverlay({
  sessionId,
  activePlugins,
  session,
  isStopping,
  onStop,
}: PlaytestOverlayProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const connectionStatus = resolvePlaytestConnectionStatus(session);
  const connection = connectionStatusConfig[connectionStatus];
  const pluginName = resolvePlaytestPluginName(activePlugins);
  const runtimeMessage =
    session?.runtimeMetrics === undefined
      ? PLAYTEST_RUNTIME_STARTING_MESSAGE
      : formatPlaytestRuntimeStatus(pluginName, session.runtimeMetrics);

  const requestStop = useEffectEvent(() => {
    setConfirmOpen(true);
  });

  const confirmStop = useCallback(() => {
    setConfirmOpen(false);
    void onStop();
  }, [onStop]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isEditableTarget(event.target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (confirmOpen) {
        setConfirmOpen(false);
        return;
      }
      requestStop();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [confirmOpen]);

  return (
    <>
      <header
        className={cn(
          'shrink-0 border-b border-border bg-background/95 px-2 py-1.5 sm:px-3 sm:py-2',
          motion.normal,
        )}
      >
        <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
          <div className="min-w-0 flex-1">
            <p className={typography.sectionLabelAccent}>Playtest</p>
            <p className={cn(typography.bodyCompact, 'truncate font-mono')}>{sessionId}</p>
            <p
              className={cn(
                typography.caption,
                connectionStatus === 'error' ? 'text-destructive' : 'text-foreground',
              )}
              data-testid="playtest-runtime-status"
            >
              {runtimeMessage}
            </p>
          </div>

          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5 sm:gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5',
                typography.bodyMicro,
                connection.surface,
                motion.fast,
              )}
              data-testid="playtest-connection-status"
            >
              <span
                aria-hidden
                className={cn('size-1.5 shrink-0 rounded-full', connection.dot, motion.fast)}
              />
              {connection.label}
            </span>

            {activePlugins.map((pluginId) => (
              <span
                key={pluginId}
                className={cn(
                  'max-w-[8rem] truncate rounded-full border border-border bg-muted/40 px-2 py-0.5 sm:max-w-none',
                  typography.bodyMicro,
                )}
                title={pluginId}
              >
                {pluginId}
              </span>
            ))}

            <Button
              variant="destructive"
              size="sm"
              disabled={isStopping}
              onClick={requestStop}
              className={motion.fast}
            >
              <SquareIcon />
              Stop playtest
              <Kbd variant="ghost" className="ml-0.5 hidden sm:inline-flex">
                Esc
              </Kbd>
            </Button>
          </div>
        </div>
      </header>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Stop playtest?</DialogTitle>
            <DialogDescription>
              The plugin runtime will shut down and you will return to the map editor.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={isStopping} onClick={confirmStop}>
              Stop playtest
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
