import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  typography,
} from '@tileborne/ui';
import { Gamepad2Icon, SquareIcon } from 'lucide-react';

import { DrawerEmptyState } from '@/components/bottom-drawer/drawer-empty-state';
import { DrawerListSkeleton } from '@/components/bottom-drawer/drawer-list-skeleton';
import { JobStatusBadge } from '@/components/bottom-drawer/job-status-badge';
import { usePlaytestSessions } from '@/hooks/queries';
import { usePlaytestControls } from '@/hooks/use-playtest-controls';
import {
  formatPlaytestRuntimeStatus,
  PLAYTEST_RUNTIME_STARTING_MESSAGE,
  resolvePlaytestPluginName,
} from '@/lib/playtest-runtime-status';
import { useEditorUiStore } from '@/stores/editor-ui-store';

function shortSessionId(sessionId: string): string {
  return sessionId.split(':').at(-1)?.slice(0, 8) ?? sessionId;
}

export function PlaytestTab() {
  const playtestActive = useEditorUiStore((state) => state.playtestActive);
  const playtestSessionId = useEditorUiStore((state) => state.playtestSessionId);
  const playtestActivePlugins = useEditorUiStore((state) => state.playtestActivePlugins);
  const playtestQuery = usePlaytestSessions({
    refetchInterval: playtestActive ? 1_000 : false,
  });
  const { stop, isStopping } = usePlaytestControls();

  const activeSession =
    playtestQuery.data?.sessions.find(
      (session) => session.id === playtestSessionId && session.status !== 'Stopped',
    ) ??
    (playtestSessionId
      ? {
          id: playtestSessionId,
          status: playtestActive ? ('Running' as const) : ('Stopped' as const),
          activePlugins: [...playtestActivePlugins],
        }
      : undefined);

  const metrics =
    activeSession && 'runtimeMetrics' in activeSession ? activeSession.runtimeMetrics : undefined;
  const activeSessionOwner =
    activeSession && 'projectId' in activeSession && 'mapId' in activeSession
      ? {
          sessionId: activeSession.id,
          projectId: activeSession.projectId,
          mapId: activeSession.mapId,
        }
      : undefined;
  const diagnostics = metrics?.diagnostics;
  const pluginName = resolvePlaytestPluginName(
    activeSession && 'activePlugins' in activeSession
      ? (activeSession.activePlugins ?? playtestActivePlugins)
      : playtestActivePlugins,
  );

  if (playtestQuery.isLoading) {
    return <DrawerListSkeleton rows={4} />;
  }

  const sessions = playtestQuery.data?.sessions ?? [];

  if (!activeSession && sessions.length === 0) {
    return (
      <DrawerEmptyState
        icon={Gamepad2Icon}
        title="No playtest sessions"
        description="Start a playtest from the top bar Playtest menu to preview your map."
      />
    );
  }

  return (
    <div className="space-y-2 py-2">
      {activeSession && playtestActive ? (
        <Card className="gap-2 py-2">
          <CardHeader className="gap-1 px-3 py-0">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className={typography.rowTitle}>
                {shortSessionId(activeSession.id)}
              </CardTitle>
              <JobStatusBadge status={activeSession.status} />
            </div>
          </CardHeader>
          <CardContent className="space-y-2 px-3 py-0">
            <p
              className={cn(typography.rowMeta, 'text-foreground')}
              data-testid="drawer-playtest-runtime-status"
            >
              {metrics
                ? formatPlaytestRuntimeStatus(pluginName, metrics)
                : PLAYTEST_RUNTIME_STARTING_MESSAGE}
            </p>
            {metrics ? (
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="info">Plugin {pluginName}</Badge>
                <Badge variant="secondary">Tick {metrics.tickCount}</Badge>
                <Badge variant="secondary">Players {metrics.playerCount}</Badge>
                {diagnostics ? (
                  <>
                    <Badge variant="secondary">
                      Avg tick {diagnostics.telemetry.averageTickDurationMs.toFixed(1)} ms
                    </Badge>
                    <Badge variant="secondary">Frames {diagnostics.bandwidth.snapshotFrames}</Badge>
                    <Badge variant="secondary">Inputs {diagnostics.bandwidth.inputEvents}</Badge>
                    <Badge
                      variant={diagnostics.budgets.backpressureOverBudget ? 'warning' : 'success'}
                    >
                      Backpressure {diagnostics.telemetry.backpressureFrameCount}
                    </Badge>
                  </>
                ) : null}
              </div>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              disabled={isStopping || activeSessionOwner === undefined}
              onClick={() =>
                activeSessionOwner === undefined
                  ? undefined
                  : void Promise.resolve(stop(activeSessionOwner)).catch(() => undefined)
              }
            >
              <SquareIcon />
              Stop playtest
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {sessions.length > 0 ? (
        <ul className="space-y-1">
          {sessions.map((session) => (
            <li
              key={session.id}
              className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-2 py-1.5"
            >
              <div className="min-w-0">
                <p className={cn('truncate', typography.rowTitle)}>{shortSessionId(session.id)}</p>
                {session.activePlugins?.length ? (
                  <p className={typography.rowMeta}>{session.activePlugins.join(', ')}</p>
                ) : null}
              </div>
              <JobStatusBadge status={session.status} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
