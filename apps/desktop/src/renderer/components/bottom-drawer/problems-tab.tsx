import { useNavigate, useParams } from '@tanstack/react-router';
import type { ReadinessDiagnostic } from '@tileborne/ipc-contracts';
import { Badge, cn, typography } from '@tileborne/ui';
import { AlertTriangleIcon, ChevronRightIcon, CircleAlertIcon, InfoIcon } from 'lucide-react';
import { useMemo } from 'react';

import { DrawerEmptyState } from '@/components/bottom-drawer/drawer-empty-state';
import { DrawerListSkeleton } from '@/components/bottom-drawer/drawer-list-skeleton';
import { JobStatusBadge } from '@/components/bottom-drawer/job-status-badge';
import { useJobs, useReadiness } from '@/hooks/queries';
import { requestBehaviorSourceNavigation } from '@/lib/behavior-source-navigation';
import { useEditorUiStore } from '@/stores/editor-ui-store';

const diagnosticSurface: Record<ReadinessDiagnostic['severity'], string> = {
  error: 'border-destructive/30 bg-destructive/5',
  warning: 'border-warning/40 bg-warning/5',
  info: 'border-border bg-card',
};

const diagnosticText: Record<ReadinessDiagnostic['severity'], string> = {
  error: 'text-destructive',
  warning: 'text-warning-foreground',
  info: 'text-muted-foreground',
};

export function ProblemsTab() {
  const { projectId, mapId } = useParams({ strict: false });
  const navigate = useNavigate();
  const jobsQuery = useJobs();
  const readinessQuery = useReadiness(projectId, mapId, 'authoring');
  const setSelection = useEditorUiStore((state) => state.setSelection);
  const selectTool = useEditorUiStore((state) => state.selectTool);
  const setCatalogTargetObjectTypeId = useEditorUiStore(
    (state) => state.setCatalogTargetObjectTypeId,
  );

  const failedJobs = useMemo(
    () =>
      (jobsQuery.data?.jobs ?? []).filter(
        (job) => job.status === 'Failed' && job.errorMessage !== undefined,
      ),
    [jobsQuery.data?.jobs],
  );
  const diagnostics = readinessQuery.data?.report.diagnostics ?? [];

  const navigateToDiagnostic = (diagnostic: ReadinessDiagnostic) => {
    const target = diagnostic.navigation;
    if (target === undefined) {
      return;
    }
    switch (target.kind) {
      case 'project-settings':
        void navigate({
          to: '/projects/$projectId/settings',
          params: { projectId: target.projectId },
        });
        return;
      case 'map':
      case 'map-object':
        if (target.mapId !== undefined) {
          if (target.kind === 'map-object' && target.objectId !== undefined) {
            setSelection(new Set([target.objectId]));
            selectTool('select');
          }
          void navigate({
            to: '/projects/$projectId/maps/$mapId',
            params: { projectId: target.projectId, mapId: target.mapId },
          });
        } else {
          void navigate({
            to: '/projects/$projectId',
            params: { projectId: target.projectId },
          });
        }
        return;
      case 'catalog':
        setCatalogTargetObjectTypeId(target.objectTypeId ?? null);
        void navigate({
          to: '/projects/$projectId/entities',
          params: { projectId: target.projectId },
        });
        return;
      case 'asset-library':
        void navigate({
          to: '/projects/$projectId/assets',
          params: { projectId: target.projectId },
        });
        return;
      case 'player-model':
        void navigate({
          to: '/projects/$projectId/player-models',
          params: { projectId: target.projectId },
        });
        return;
      case 'behavior':
        if (target.behaviorId === undefined) return;
        requestBehaviorSourceNavigation({
          projectId: String(target.projectId),
          behaviorId: String(target.behaviorId),
          ...(target.behaviorNodeId === undefined ? {} : { nodeId: String(target.behaviorNodeId) }),
          ...(target.path === undefined ? {} : { sourcePath: target.path }),
          ...(target.line === undefined ? {} : { line: target.line }),
          ...(target.column === undefined ? {} : { column: target.column }),
        });
        void navigate({
          to: '/projects/$projectId/behaviors',
          params: { projectId: target.projectId },
        });
        return;
    }
  };

  if (jobsQuery.isLoading || (projectId !== undefined && readinessQuery.isLoading)) {
    return <DrawerListSkeleton rows={3} />;
  }

  if (diagnostics.length === 0 && failedJobs.length === 0) {
    return (
      <DrawerEmptyState
        icon={AlertTriangleIcon}
        title="No problems detected"
        description="Readiness diagnostics, failed jobs, and runtime errors will show up here."
      />
    );
  }

  return (
    <div className="space-y-3 py-2" data-testid="readiness-problems">
      {diagnostics.length > 0 ? (
        <section>
          <p className={cn(typography.sectionLabelMicro, 'mb-1 px-1')}>Game readiness</p>
          <ul className="space-y-1.5">
            {diagnostics.map((diagnostic) => {
              const navigable = diagnostic.navigation !== undefined;
              const Icon =
                diagnostic.severity === 'error'
                  ? CircleAlertIcon
                  : diagnostic.severity === 'warning'
                    ? AlertTriangleIcon
                    : InfoIcon;
              return (
                <li key={diagnostic.id}>
                  <button
                    type="button"
                    disabled={!navigable}
                    onClick={() => navigateToDiagnostic(diagnostic)}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left',
                      diagnosticSurface[diagnostic.severity],
                      navigable && 'transition-colors hover:border-primary/60 hover:bg-accent/20',
                    )}
                    data-testid="readiness-problem"
                    data-severity={diagnostic.severity}
                    data-source={diagnostic.source}
                  >
                    <Icon
                      aria-hidden
                      className={cn(
                        'mt-0.5 size-3.5 shrink-0',
                        diagnosticText[diagnostic.severity],
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className={cn(typography.caption, 'block font-medium text-foreground')}>
                        {diagnostic.title}
                      </span>
                      <span
                        className={cn(typography.bodyMicro, diagnosticText[diagnostic.severity])}
                      >
                        {diagnostic.message}
                      </span>
                    </span>
                    <Badge variant="outline" className="shrink-0 px-1.5 py-0 font-normal">
                      {diagnostic.source}
                    </Badge>
                    {navigable ? (
                      <ChevronRightIcon
                        aria-hidden
                        className="mt-0.5 size-3 shrink-0 text-muted-foreground"
                      />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {failedJobs.length > 0 ? (
        <section>
          <p className={cn(typography.sectionLabelMicro, 'mb-1 px-1')}>Failed jobs</p>
          <ul className="space-y-1.5">
            {failedJobs.map((job) => (
              <li
                key={job.id}
                className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className={cn(typography.caption, 'font-medium text-foreground')}>
                    Job {job.id.split(':').at(-1)?.slice(0, 8) ?? job.id} failed
                  </p>
                  <JobStatusBadge status={job.status} />
                </div>
                <p className={cn(typography.bodyMicro, 'mt-1 text-destructive')}>
                  {job.errorMessage}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
