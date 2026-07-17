import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  typography,
} from '@tileborne/ui';
import { AlertTriangleIcon, CpuIcon, PauseIcon, PlayIcon, StepForwardIcon } from 'lucide-react';
import type { PlaytestSessionId } from '@tileborne/services-build';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { DrawerEmptyState } from '@/components/bottom-drawer/drawer-empty-state';
import { DrawerListSkeleton } from '@/components/bottom-drawer/drawer-list-skeleton';
import { formatDrawerTimestamp } from '@/components/bottom-drawer/format';
import { usePlaytestBehaviorDebug, usePlaytestSessions } from '@/hooks/queries';
import { useControlPlaytestBehaviorDebug } from '@/hooks/mutations';
import { resolvePlaytestPluginName } from '@/lib/playtest-runtime-status';
import { requestBehaviorSourceNavigation } from '@/lib/behavior-source-navigation';
import { useEditorUiStore } from '@/stores/editor-ui-store';

export function RuntimeTab() {
  const navigate = useNavigate();
  const playtestActive = useEditorUiStore((state) => state.playtestActive);
  const playtestSessionId = useEditorUiStore((state) => state.playtestSessionId);
  const playtestActivePlugins = useEditorUiStore((state) => state.playtestActivePlugins);
  const playtestQuery = usePlaytestSessions({
    refetchInterval: playtestActive ? 1_000 : false,
  });
  const behaviorDebug = usePlaytestBehaviorDebug(playtestActive ? playtestSessionId : null, {
    refetchInterval: playtestActive ? 250 : false,
  });
  const behaviorControl = useControlPlaytestBehaviorDebug();

  const session = playtestQuery.data?.sessions.find((entry) => entry.id === playtestSessionId);
  const metrics = session?.runtimeMetrics;
  const diagnostics = metrics?.diagnostics;
  const pluginName = resolvePlaytestPluginName(session?.activePlugins ?? playtestActivePlugins);
  const debug = behaviorDebug.data?.snapshot;
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>();
  const [selectedSequence, setSelectedSequence] = useState<number>();
  const instanceOptions = useMemo(() => {
    const byId = new Map<string, { readonly instanceId: string; readonly behaviorId: string }>();
    for (const trace of debug?.traces ?? []) {
      byId.set(trace.instanceId, {
        instanceId: trace.instanceId,
        behaviorId: String(trace.behaviorId),
      });
    }
    return [...byId.values()];
  }, [debug?.traces]);
  const activeInstanceId = instanceOptions.some(
    ({ instanceId }) => instanceId === selectedInstanceId,
  )
    ? selectedInstanceId
    : debug?.traces.at(-1)?.instanceId;
  const instanceHistory = (debug?.traces ?? []).filter(
    (trace) => trace.instanceId === activeInstanceId,
  );
  const currentTrace =
    instanceHistory.find((trace) => trace.sequence === selectedSequence) ?? instanceHistory.at(-1);
  const control = (command: 'pause' | 'step' | 'continue') => {
    if (playtestSessionId === null) return;
    void behaviorControl.mutateAsync({
      sessionId: playtestSessionId as PlaytestSessionId,
      command,
    });
  };
  const openBehaviorSource = (
    behaviorId: string,
    target?: {
      readonly nodeId?: string;
      readonly sourcePath?: string;
      readonly line?: number;
      readonly column?: number;
    },
  ) => {
    if (session === undefined) return;
    requestBehaviorSourceNavigation({
      projectId: String(session.projectId),
      behaviorId,
      ...target,
    });
    void navigate({
      to: '/projects/$projectId/behaviors',
      params: { projectId: String(session.projectId) },
    });
  };
  const openLatestSource = () => {
    if (currentTrace === undefined) return;
    openBehaviorSource(String(currentTrace.behaviorId), {
      sourcePath: currentTrace.source.filePath,
      ...(currentTrace.source.nodeId === undefined ? {} : { nodeId: currentTrace.source.nodeId }),
    });
  };
  const openReloadSource = () => {
    const reload = debug?.lastReload;
    if (reload?.diagnostic === undefined) return;
    const details = reload.diagnostic.details;
    openBehaviorSource(String(reload.behaviorId), {
      ...(typeof details?.nodeId === 'string' ? { nodeId: details.nodeId } : {}),
      ...(typeof details?.fileName === 'string' ? { sourcePath: details.fileName } : {}),
      ...(typeof details?.line === 'number' ? { line: details.line } : {}),
      ...(typeof details?.column === 'number' ? { column: details.column } : {}),
    });
  };

  if (playtestQuery.isLoading) {
    return <DrawerListSkeleton rows={4} />;
  }

  if (!playtestActive || !metrics) {
    return (
      <DrawerEmptyState
        icon={CpuIcon}
        title="Runtime idle"
        description="Start a playtest session to stream plugin tick metrics here."
      />
    );
  }

  return (
    <div className="space-y-2 py-2">
      <Card className="gap-2 py-2">
        <CardHeader className="gap-1 px-3 py-0">
          <CardTitle className={cn(typography.caption, 'text-foreground')}>
            Plugin runtime
          </CardTitle>
          <CardDescription className={typography.bodyMicro}>{pluginName}</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 px-3 py-0 sm:grid-cols-4">
          <MetricTile label="Tick" value={String(metrics.tickCount)} />
          <MetricTile label="Players" value={String(metrics.playerCount)} />
          <MetricTile label="Last event" value={metrics.lastPluginEvent} />
          <MetricTile label="Last tick" value={formatDrawerTimestamp(metrics.lastTickAtMs)} />
          {diagnostics ? (
            <>
              <MetricTile
                label="Avg tick"
                value={formatMs(diagnostics.telemetry.averageTickDurationMs)}
              />
              <MetricTile
                label="Max frame"
                value={formatBytes(diagnostics.bandwidth.maxFrameBytes)}
              />
              <MetricTile label="Replay" value={`${diagnostics.replay.snapshotFrames} frames`} />
              <MetricTile label="Hash" value={diagnostics.replay.rollingHash.slice(-8)} />
            </>
          ) : null}
        </CardContent>
      </Card>
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="success">Live</Badge>
        <Badge variant="info">{pluginName}</Badge>
        {diagnostics ? (
          <>
            <Badge variant={diagnostics.budgets.tickOverBudget ? 'warning' : 'success'}>
              Tick {diagnostics.budgets.tickOverBudget ? 'over' : 'ok'}
            </Badge>
            <Badge variant={diagnostics.budgets.snapshotOverBudget ? 'warning' : 'success'}>
              Snapshot {diagnostics.budgets.snapshotOverBudget ? 'over' : 'ok'}
            </Badge>
            <Badge variant="secondary">Collision {diagnostics.debugOverlay.collision}</Badge>
            <Badge variant="secondary">LOS {diagnostics.debugOverlay.lineOfSight}</Badge>
            <Badge variant="secondary">Hitboxes {diagnostics.debugOverlay.hitboxes}</Badge>
            <Badge variant="secondary">Projectiles {diagnostics.debugOverlay.projectiles}</Badge>
            <Badge variant="secondary">Spawns {diagnostics.debugOverlay.spawnSlots}</Badge>
            <Badge variant="secondary">Loot {diagnostics.debugOverlay.lootRolls}</Badge>
            <Badge variant="secondary">Zone {diagnostics.debugOverlay.zone}</Badge>
          </>
        ) : null}
      </div>
      {debug === undefined ? (
        <Card className="gap-1 py-2">
          <CardContent className="px-3 py-0 text-xs text-muted-foreground">
            {behaviorDebug.isError
              ? 'This playtest has no active behavior runtime.'
              : 'Connecting to the behavior runtime inspector…'}
          </CardContent>
        </Card>
      ) : (
        <Card className="gap-2 py-2" data-testid="behavior-runtime-inspector">
          <CardHeader className="gap-1 px-3 py-0">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className={cn(typography.caption, 'text-foreground')}>
                Behavior inspector
              </CardTitle>
              <Badge variant={debug.status === 'paused' ? 'warning' : 'success'}>
                {debug.status}
              </Badge>
              <span className="text-xs text-muted-foreground">Tick {debug.tick}</span>
              <div className="ml-auto flex items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={debug.status === 'paused' || behaviorControl.isPending}
                  onClick={() => control('pause')}
                >
                  <PauseIcon className="size-3.5" /> Pause
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={debug.status !== 'paused' || behaviorControl.isPending}
                  onClick={() => control('step')}
                >
                  <StepForwardIcon className="size-3.5" /> Step
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={debug.status !== 'paused' || behaviorControl.isPending}
                  onClick={() => control('continue')}
                >
                  <PlayIcon className="size-3.5" /> Continue
                </Button>
              </div>
            </div>
            <CardDescription className={typography.bodyMicro}>
              Traces are retained per behavior instance up to 256 entries.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 px-3 py-0">
            {instanceOptions.length > 0 ? (
              <div className="grid gap-2 rounded-md border p-2 text-xs lg:grid-cols-[minmax(12rem,18rem)_minmax(0,1fr)]">
                <label className="grid gap-1 font-medium">
                  Behavior instance
                  <select
                    aria-label="Behavior instance"
                    className="h-8 rounded-md border bg-background px-2 text-xs"
                    value={activeInstanceId ?? ''}
                    onChange={(event) => {
                      setSelectedInstanceId(event.currentTarget.value);
                      setSelectedSequence(undefined);
                    }}
                  >
                    {instanceOptions.map((option) => (
                      <option key={option.instanceId} value={option.instanceId}>
                        {option.behaviorId} · {option.instanceId}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="min-w-0">
                  <p className="mb-1 font-medium">
                    Retained timeline · {instanceHistory.length}/256
                  </p>
                  <div
                    className="flex max-h-20 gap-1 overflow-auto"
                    data-testid="behavior-instance-timeline"
                  >
                    {instanceHistory.map((trace) => (
                      <Button
                        key={trace.sequence}
                        type="button"
                        size="sm"
                        variant={trace.sequence === currentTrace?.sequence ? 'secondary' : 'ghost'}
                        className="h-auto shrink-0 px-2 py-1 text-[11px]"
                        aria-label={`Inspect tick ${trace.tick} ${trace.eventId}`}
                        onClick={() => setSelectedSequence(trace.sequence)}
                      >
                        #{trace.tick} {trace.eventId}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
            {debug.lastReload ? (
              <div
                className={cn(
                  'flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs',
                  debug.lastReload.status === 'applied'
                    ? 'border-emerald-500/40 text-emerald-700'
                    : 'border-amber-500/40 text-amber-700',
                )}
                data-testid="behavior-hot-reload-status"
              >
                <span className="min-w-0 flex-1">
                  Hot reload{' '}
                  {debug.lastReload.status === 'applied'
                    ? 'applied'
                    : 'rejected — last-known-good still running'}
                  {debug.lastReload.diagnostic ? `: ${debug.lastReload.diagnostic.message}` : ''}
                </span>
                {debug.lastReload.diagnostic ? (
                  <Button type="button" size="sm" variant="ghost" onClick={openReloadSource}>
                    Open source
                  </Button>
                ) : null}
              </div>
            ) : null}
            {currentTrace === undefined ? (
              <p className="text-xs text-muted-foreground">Waiting for the first behavior event…</p>
            ) : (
              <div className="grid gap-2 text-xs lg:grid-cols-2">
                <div className="space-y-1 rounded-md border p-2">
                  <p className="font-medium">{currentTrace.eventId}</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="link"
                    className="h-auto justify-start px-0 text-xs"
                    onClick={openLatestSource}
                    title={currentTrace.source.filePath}
                  >
                    <span className="truncate">
                      {currentTrace.source.filePath}
                      {currentTrace.source.nodeId ? ` · ${currentTrace.source.nodeId}` : ''}
                    </span>
                  </Button>
                  <DebugJson label="Event payload" value={currentTrace.event} />
                  <DebugJson label="State before" value={currentTrace.stateBefore} />
                  <DebugJson label="State after" value={currentTrace.state} />
                </div>
                <div className="space-y-1 rounded-md border p-2">
                  <p className="font-medium">Branch & actions</p>
                  {currentTrace.steps.length === 0 ? (
                    <p className="text-muted-foreground">TypeScript handler · source-map scoped</p>
                  ) : (
                    currentTrace.steps.map((step, index) => (
                      <p key={`${step.nodeId}:${index}`} className="font-mono text-[11px]">
                        {step.kind === 'branch'
                          ? `${step.branch.toUpperCase()} · ${step.nodeId}`
                          : `${step.actionId} · ${step.nodeId}`}
                      </p>
                    ))
                  )}
                  <DebugJson label="Emitted actions" value={currentTrace.commands} />
                </div>
              </div>
            )}
            {debug.diagnostics.length > 0 ? (
              <div className="space-y-1 rounded-md border border-destructive/30 p-2">
                <p className="flex items-center gap-1 font-medium text-destructive">
                  <AlertTriangleIcon className="size-3.5" /> Diagnostics
                </p>
                {debug.diagnostics.slice(-4).map((diagnostic, index) => (
                  <p key={`${diagnostic.code}:${index}`} className="text-xs">
                    <span className="font-mono">{diagnostic.code}</span> · {diagnostic.message}
                    {typeof diagnostic.details?.fileName === 'string'
                      ? ` · ${diagnostic.details.fileName}`
                      : ''}
                    {typeof diagnostic.details?.nodeId === 'string'
                      ? ` · ${diagnostic.details.nodeId}`
                      : ''}
                  </p>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function DebugJson({ label, value }: { readonly label: string; readonly value: unknown }) {
  return (
    <details>
      <summary className="cursor-pointer text-muted-foreground">{label}</summary>
      <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-1 font-mono text-[10px]">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

function formatMs(value: number): string {
  return `${value.toFixed(value >= 10 ? 0 : 1)} ms`;
}

function formatBytes(value: number): string {
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${value} B`;
}

function MetricTile({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-2 py-1.5">
      <p className={typography.sectionLabelMicro}>{label}</p>
      <p className={cn(typography.caption, 'truncate font-medium text-foreground')}>{value}</p>
    </div>
  );
}
