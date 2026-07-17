import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MapId, ProjectId } from '@tileborne/core';
import { ShipGameArtifact as ShipGameArtifactSchema } from '@tileborne/ipc-contracts';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  cn,
  typography,
} from '@tileborne/ui';
import { Schema } from 'effect';
import { ExternalLinkIcon, FolderOpenIcon, RotateCcwIcon, SquareIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { FormField } from '@/components/dialog-form';
import { useJobs, useMaps, useProject, useReadiness } from '@/hooks/queries';
import type { ShipGameArtifact } from '@/lib/bridge-types';
import { invokeIpc } from '@/lib/ipc';
import { queryKeys } from '@/lib/query-client';
import { blockingReadinessDiagnostics, showReadinessProblems } from '@/lib/readiness-gate';
import { notifyError, notifySuccess } from '@/stores/app-notifications-store';
import { useEditorUiStore } from '@/stores/editor-ui-store';

interface ShipGameDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly projectId: ProjectId | undefined;
}

type ShipTarget = 'local' | 'cloudflare';

const decodeArtifact = (value: unknown): ShipGameArtifact | undefined => {
  try {
    return Schema.decodeUnknownSync(ShipGameArtifactSchema)(value);
  } catch {
    return undefined;
  }
};

export function ShipGameDialog({ open, onOpenChange, projectId }: ShipGameDialogProps) {
  const queryClient = useQueryClient();
  const setBottomDrawerOpen = useEditorUiStore((state) => state.setBottomDrawerOpen);
  const setBottomDrawerTab = useEditorUiStore((state) => state.setBottomDrawerTab);
  const projectQuery = useProject(projectId);
  const mapsQuery = useMaps(projectId);
  const jobsQuery = useJobs();
  const [startupMapId, setStartupMapId] = useState('');
  const [target, setTarget] = useState<ShipTarget>('local');
  const [jobId, setJobId] = useState<string>();
  const [artifact, setArtifact] = useState<ShipGameArtifact>();
  const [failure, setFailure] = useState<string>();
  const readiness = useReadiness(projectId, startupMapId || undefined, 'build');

  const maps = mapsQuery.data?.maps ?? [];
  const project = projectQuery.data?.project;
  const selectedMap = maps.find((map) => map.id === startupMapId);

  useEffect(() => {
    if (!open || project === undefined) return;
    const persistedMap = project.settings?.startupMapId;
    const persistedTarget = project.settings?.shipTarget;
    setStartupMapId(
      typeof persistedMap === 'string' && maps.some((map) => map.id === persistedMap)
        ? persistedMap
        : (maps[0]?.id ?? ''),
    );
    setTarget(persistedTarget === 'cloudflare' ? 'cloudflare' : 'local');
  }, [maps, open, project]);

  useEffect(() => {
    if (!open || projectId === undefined || jobId !== undefined) return;
    const restored = [...(jobsQuery.data?.jobs ?? [])]
      .reverse()
      .map((candidate) => ({ job: candidate, artifact: decodeArtifact(candidate.result) }))
      .find(
        (candidate) =>
          candidate.job.status === 'Completed' && candidate.artifact?.projectId === projectId,
      );
    if (restored?.artifact === undefined) return;
    setJobId(String(restored.job.id));
    setArtifact(restored.artifact);
    setFailure(undefined);
  }, [jobId, jobsQuery.data?.jobs, open, projectId]);

  const jobQuery = useQuery({
    queryKey: queryKeys.jobs.detail(jobId ?? ''),
    queryFn: () =>
      invokeIpc(() =>
        window.tileborne.jobs.get({
          jobId: jobId! as Parameters<typeof window.tileborne.jobs.get>[0]['jobId'],
        }),
      ),
    enabled: jobId !== undefined,
    refetchInterval: (query) => {
      const status = query.state.data?.job.status;
      return status === 'Completed' || status === 'Failed' || status === 'Cancelled' ? false : 250;
    },
  });
  const job = jobQuery.data?.job;

  useEffect(() => {
    if (job?.status === 'Completed') {
      const completedArtifact = decodeArtifact(job.result);
      if (completedArtifact === undefined) {
        setFailure('Build completed without a valid game artifact.');
        return;
      }
      setArtifact(completedArtifact);
      setFailure(undefined);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.projects.detail(String(projectId)),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
    } else if (job?.status === 'Failed') {
      setFailure(job.errorMessage ?? 'Ship Game failed.');
    } else if (job?.status === 'Cancelled') {
      setFailure('Ship Game was cancelled.');
    }
  }, [job?.errorMessage, job?.result, job?.status, projectId, queryClient]);

  const startShip = useMutation({
    mutationFn: async () => {
      if (projectId === undefined || startupMapId.length === 0) {
        throw new Error('Choose a startup map before shipping.');
      }
      return invokeIpc(() =>
        window.tileborne.ship.start({
          projectId,
          startupMapId: startupMapId as MapId,
          target,
        }),
      );
    },
    onSuccess: ({ jobId: nextJobId }) => {
      setArtifact(undefined);
      setFailure(undefined);
      setJobId(String(nextJobId));
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      setFailure(message);
      notifyError(message);
    },
  });

  const cancelShip = useMutation({
    mutationFn: () =>
      invokeIpc(() =>
        window.tileborne.jobs.cancel({
          jobId: jobId! as Parameters<typeof window.tileborne.jobs.cancel>[0]['jobId'],
        }),
      ),
    onSuccess: () => void jobQuery.refetch(),
  });

  const launchPreview = useMutation({
    mutationFn: () => invokeIpc(() => window.tileborne.ship.launchPreview({ artifact: artifact! })),
    onSuccess: ({ baseUrl, roomId }) =>
      notifySuccess(`Packaged preview launched from ${baseUrl} · room ${roomId.slice(0, 8)}`),
    onError: (error) => notifyError(error instanceof Error ? error.message : String(error)),
  });

  const openArtifact = useMutation({
    mutationFn: () =>
      invokeIpc(() => window.tileborne.ship.openArtifact({ directory: artifact!.directory })),
    onError: (error) => notifyError(error instanceof Error ? error.message : String(error)),
  });

  const running = startShip.isPending || job?.status === 'Pending' || job?.status === 'Running';
  const progress = Math.round((job?.progress ?? (startShip.isPending ? 0.05 : 0)) * 100);
  const blockingCount = blockingReadinessDiagnostics(readiness.data?.report).length;
  const logs = useMemo(() => job?.logs ?? [], [job?.logs]);

  const openProblems = () => {
    showReadinessProblems();
    onOpenChange(false);
  };
  const openBuildLogs = () => {
    setBottomDrawerTab('jobs');
    setBottomDrawerOpen(true);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !running && onOpenChange(nextOpen)}>
      <DialogContent className="sm:max-w-2xl" data-testid="ship-game-dialog">
        <DialogHeader>
          <DialogTitle>Ship Game</DialogTitle>
          <DialogDescription>
            Validate the authored game, build the canonical runtime artifact, then launch it
            locally.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Startup map" htmlFor="ship-startup-map">
              <Select
                value={startupMapId}
                onValueChange={(value) => setStartupMapId(value ?? '')}
                disabled={running}
              >
                <SelectTrigger id="ship-startup-map" data-testid="ship-startup-map">
                  <span data-slot="select-value">
                    {selectedMap === undefined
                      ? 'Select a map'
                      : `${selectedMap.label ?? `Map ${maps.indexOf(selectedMap) + 1}`} · ${selectedMap.width}×${selectedMap.height}`}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {maps.map((map, index) => (
                    <SelectItem key={map.id} value={map.id}>
                      {map.label ?? `Map ${index + 1}`} · {map.width}×{map.height}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Target" htmlFor="ship-target">
              <Select
                value={target}
                onValueChange={(value) =>
                  setTarget(value === 'cloudflare' ? 'cloudflare' : 'local')
                }
                disabled={running}
              >
                <SelectTrigger id="ship-target" data-testid="ship-target">
                  <span data-slot="select-value">
                    {target === 'local' ? 'Local packaged preview' : 'Cloudflare worker artifact'}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">Local packaged preview</SelectItem>
                  <SelectItem value="cloudflare">Cloudflare worker artifact</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          </div>

          <section className="rounded-md border border-border p-3" aria-live="polite">
            <div className="flex items-center justify-between gap-3">
              <p className={cn(typography.caption, 'font-medium text-foreground')}>Readiness</p>
              <span className={typography.bodyMicro}>
                {readiness.isLoading
                  ? 'Checking…'
                  : blockingCount > 0
                    ? `${blockingCount} blocking`
                    : 'Ready to ship'}
              </span>
            </div>
            {blockingCount > 0 ? (
              <Button
                type="button"
                size="sm"
                variant="link"
                className="mt-1 px-0"
                onClick={openProblems}
              >
                Open actionable problems
              </Button>
            ) : null}
          </section>

          {jobId !== undefined ? (
            <section className="grid gap-2 rounded-md border border-border p-3" aria-live="polite">
              <div className="flex items-center justify-between gap-3">
                <p className={cn(typography.caption, 'font-medium text-foreground')}>
                  Build progress
                </p>
                <span className={typography.bodyMicro}>
                  {job?.status ?? 'Starting'} · {progress}%
                </span>
              </div>
              <Progress value={progress} />
              {logs.length > 0 ? (
                <ol
                  className="max-h-28 space-y-1 overflow-auto rounded bg-muted/40 p-2 font-mono text-xs"
                  data-testid="ship-logs"
                >
                  {logs.map((line, index) => (
                    <li key={`${index}-${line}`}>{line}</li>
                  ))}
                </ol>
              ) : null}
            </section>
          ) : null}

          {failure !== undefined ? (
            <section
              className="rounded-md border border-destructive/40 bg-destructive/5 p-3"
              role="alert"
            >
              <p className={cn(typography.caption, 'font-medium text-destructive')}>Ship failed</p>
              <p className={typography.bodyMicro}>{failure}</p>
              <div className="mt-2 flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => startShip.mutate()}
                  disabled={running}
                >
                  <RotateCcwIcon /> Retry
                </Button>
                {blockingCount > 0 ? (
                  <Button type="button" size="sm" variant="ghost" onClick={openProblems}>
                    Open problems
                  </Button>
                ) : (
                  <Button type="button" size="sm" variant="ghost" onClick={openBuildLogs}>
                    Open jobs &amp; logs
                  </Button>
                )}
              </div>
            </section>
          ) : null}

          {artifact !== undefined ? (
            <section
              className="grid gap-2 rounded-md border border-success/40 bg-success/5 p-3"
              data-testid="ship-artifact"
            >
              <p className={cn(typography.caption, 'font-medium text-foreground')}>
                Game artifact ready
              </p>
              <dl className="grid gap-1 text-xs sm:grid-cols-[7rem_1fr]">
                <dt className="text-muted-foreground">Startup map</dt>
                <dd>
                  {maps.find((map) => map.id === artifact.startupMapId)?.label ?? 'Selected map'}
                </dd>
                <dt className="text-muted-foreground">Integrity</dt>
                <dd className="truncate font-mono">{artifact.integrityHash}</dd>
                <dt className="text-muted-foreground">Location</dt>
                <dd className="truncate font-mono">{artifact.directory}</dd>
              </dl>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => launchPreview.mutate()}
                  disabled={launchPreview.isPending}
                >
                  <ExternalLinkIcon /> Launch packaged preview
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => openArtifact.mutate()}
                >
                  <FolderOpenIcon /> Open artifact
                </Button>
              </div>
            </section>
          ) : null}
        </div>

        <DialogFooter>
          {running && jobId !== undefined ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => cancelShip.mutate()}
              disabled={cancelShip.isPending}
            >
              <SquareIcon /> Cancel
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
          <Button
            type="button"
            onClick={() => startShip.mutate()}
            disabled={
              running ||
              projectId === undefined ||
              startupMapId.length === 0 ||
              readiness.isLoading ||
              blockingCount > 0
            }
            data-testid="ship-game-start"
          >
            Ship Game
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
