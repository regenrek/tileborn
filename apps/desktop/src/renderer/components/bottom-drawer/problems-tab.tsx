import { cn, typography } from '@tileborne/ui';
import { AlertTriangleIcon } from 'lucide-react';
import { useMemo } from 'react';

import { DrawerEmptyState } from '@/components/bottom-drawer/drawer-empty-state';
import { DrawerListSkeleton } from '@/components/bottom-drawer/drawer-list-skeleton';
import { JobStatusBadge } from '@/components/bottom-drawer/job-status-badge';
import { useJobs } from '@/hooks/queries';

interface ProblemRow {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly status: string;
}

export function ProblemsTab() {
  const jobsQuery = useJobs();

  const problems = useMemo<ProblemRow[]>(() => {
    const rows: ProblemRow[] = [];
    for (const job of jobsQuery.data?.jobs ?? []) {
      if (job.status === 'Failed' && job.errorMessage) {
        rows.push({
          id: job.id,
          title: `Job ${job.id.split(':').at(-1)?.slice(0, 8) ?? job.id} failed`,
          detail: job.errorMessage,
          status: job.status,
        });
      }
    }
    return rows;
  }, [jobsQuery.data?.jobs]);

  if (jobsQuery.isLoading) {
    return <DrawerListSkeleton rows={3} />;
  }

  if (problems.length === 0) {
    return (
      <DrawerEmptyState
        icon={AlertTriangleIcon}
        title="No problems detected"
        description="Failed jobs and runtime errors will show up here."
      />
    );
  }

  return (
    <ul className="space-y-1.5 py-2">
      {problems.map((problem) => (
        <li
          key={problem.id}
          className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5"
        >
          <div className="flex items-start justify-between gap-2">
            <p className={cn(typography.caption, 'font-medium text-foreground')}>{problem.title}</p>
            <JobStatusBadge status={problem.status} />
          </div>
          <p className={cn(typography.bodyMicro, 'mt-1 text-destructive')}>{problem.detail}</p>
        </li>
      ))}
    </ul>
  );
}
