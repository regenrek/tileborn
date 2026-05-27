import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Progress,
  cn,
  typography,
} from '@tileborne/ui';
import { AlertTriangleIcon, CheckCircle2Icon, Loader2Icon, XCircleIcon } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';

import type {
  StartupStatusSnapshot,
  StartupTaskSnapshot,
  StartupTaskStatus,
} from '../../../shared/startup-status';

const statusLabel: Record<StartupTaskStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  completed: 'Done',
  failed: 'Failed',
  'timed-out': 'Timed out',
};

const taskTone = (status: StartupTaskStatus): string => {
  switch (status) {
    case 'completed':
      return 'text-emerald-500';
    case 'failed':
    case 'timed-out':
      return 'text-destructive';
    case 'running':
      return 'text-primary';
    case 'pending':
      return 'text-muted-foreground';
  }
};

const StartupTaskIcon = ({ status }: { readonly status: StartupTaskStatus }) => {
  switch (status) {
    case 'completed':
      return <CheckCircle2Icon className="size-4 text-emerald-500" aria-hidden />;
    case 'failed':
    case 'timed-out':
      return <XCircleIcon className="size-4 text-destructive" aria-hidden />;
    case 'running':
      return <Loader2Icon className="size-4 animate-spin text-primary" aria-hidden />;
    case 'pending':
      return <span className="size-4 rounded-full border border-border" aria-hidden />;
  }
};

const taskProgress = (tasks: readonly StartupTaskSnapshot[]): number => {
  const completed = tasks.filter(
    (task) =>
      task.status === 'completed' || task.status === 'failed' || task.status === 'timed-out',
  ).length;
  return tasks.length === 0 ? 0 : Math.round((completed / tasks.length) * 100);
};

const useStartupStatus = (): StartupStatusSnapshot | undefined => {
  const [snapshot, setSnapshot] = useState<StartupStatusSnapshot | undefined>();

  useEffect(() => {
    let mounted = true;
    void window.tileborneStartup
      .getStatus()
      .then((next) => {
        if (mounted) {
          setSnapshot(next);
        }
      })
      .catch((error) => {
        if (!mounted) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        setSnapshot({
          state: 'failed',
          tasks: [],
          errors: [
            {
              taskId: 'background-startup',
              label: 'Startup status bridge',
              status: 'failed',
              message,
              at: new Date().toISOString(),
            },
          ],
          updatedAt: new Date().toISOString(),
        });
      });

    const unsubscribe = window.tileborneStartup.onStatusChanged((next) => {
      setSnapshot(next);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return snapshot;
};

function StartupScreen({ snapshot }: { readonly snapshot: StartupStatusSnapshot | undefined }) {
  const tasks = snapshot?.tasks ?? [];
  const progress = useMemo(() => taskProgress(tasks), [tasks]);
  const headline =
    snapshot?.state === 'failed'
      ? 'Tileborne could not finish starting'
      : 'Starting Tileborne';
  const description =
    snapshot?.state === 'failed'
      ? 'The Electron shell is running, but a required startup phase failed. Check the terminal logs for the matching [tileborne:start] entry.'
      : 'Loading the desktop shell first, then initializing local services and bundled content.';

  return (
    <div className="flex h-full min-h-screen items-center justify-center bg-background p-8 text-foreground">
      <Card className="w-full max-w-2xl">
        <CardHeader className="gap-3">
          <div className="flex items-center gap-3">
            {snapshot?.state === 'failed' ? (
              <XCircleIcon className="size-6 text-destructive" aria-hidden />
            ) : (
              <Loader2Icon className="size-6 animate-spin text-primary" aria-hidden />
            )}
            <div>
              <CardTitle>{headline}</CardTitle>
              <CardDescription className="mt-1">{description}</CardDescription>
            </div>
          </div>
          <Progress value={progress} />
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="space-y-2" aria-label="Startup phases">
            {tasks.map((task) => (
              <li key={task.id} className="flex items-start justify-between gap-3 rounded-md border border-border/70 p-2">
                <div className="flex min-w-0 items-start gap-2">
                  <StartupTaskIcon status={task.status} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{task.label}</div>
                    {task.message ? (
                      <div className={cn(typography.caption, 'mt-0.5 text-muted-foreground')}>
                        {task.message}
                      </div>
                    ) : null}
                  </div>
                </div>
                <Badge variant="outline" className={cn('shrink-0', taskTone(task.status))}>
                  {statusLabel[task.status]}
                </Badge>
              </li>
            ))}
          </ul>
          {snapshot && snapshot.errors.length > 0 ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {snapshot.errors.at(-1)?.message}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function StartupWarning({ snapshot }: { readonly snapshot: StartupStatusSnapshot }) {
  const [dismissed, setDismissed] = useState(false);
  const latestError = snapshot.errors.at(-1);
  if (dismissed || latestError === undefined) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-2xl items-start gap-3 rounded-md border border-amber-500/40 bg-background/95 p-3 text-sm shadow-lg">
        <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
        <div className="min-w-0">
          <div className="font-medium">Tileborne started with a warning</div>
          <div className="mt-1 text-muted-foreground">{latestError.message}</div>
        </div>
        <button
          type="button"
          className="ml-2 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={() => setDismissed(true)}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

export function StartupBoundary({ children }: { readonly children: ReactNode }) {
  const snapshot = useStartupStatus();

  if (snapshot === undefined || snapshot.state === 'starting' || snapshot.state === 'failed') {
    return <StartupScreen snapshot={snapshot} />;
  }

  return (
    <>
      {snapshot.state === 'degraded' ? <StartupWarning snapshot={snapshot} /> : null}
      {children}
    </>
  );
}
