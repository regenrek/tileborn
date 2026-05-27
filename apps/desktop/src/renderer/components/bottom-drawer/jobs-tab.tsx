import { cn, typography } from '@tileborne/ui';
import { BriefcaseIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import { DrawerEmptyState } from '@/components/bottom-drawer/drawer-empty-state';
import { DrawerListSkeleton } from '@/components/bottom-drawer/drawer-list-skeleton';
import { formatDrawerTimestamp, useJobFirstSeen } from '@/components/bottom-drawer/format';
import { JobStatusBadge } from '@/components/bottom-drawer/job-status-badge';
import { useJobs } from '@/hooks/queries';

function shortJobId(jobId: string): string {
  const suffix = jobId.split(':').at(-1) ?? jobId;
  return suffix.slice(0, 8);
}

export function JobsTab() {
  const jobsQuery = useJobs();
  const [fallbackFirstSeenAt] = useState(() => Date.now());
  const jobs = jobsQuery.data?.jobs ?? [];
  const jobIds = useMemo(() => jobs.map((job) => job.id), [jobs]);
  const firstSeen = useJobFirstSeen(jobIds);

  if (jobsQuery.isLoading) {
    return <DrawerListSkeleton />;
  }

  if (jobs.length === 0) {
    return (
      <DrawerEmptyState
        icon={BriefcaseIcon}
        title="No background jobs"
        description="Build, export, and import jobs appear here while they run."
      />
    );
  }

  return (
    <ul className="space-y-1.5 py-2">
      {jobs.map((job) => (
        <li
          key={job.id}
          className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-2 py-1.5"
        >
          <div className="min-w-0">
            <p className={cn(typography.caption, 'truncate font-medium text-foreground')}>
              {shortJobId(job.id)}
            </p>
            <p className={typography.bodyMicro}>
              {formatDrawerTimestamp(firstSeen[job.id] ?? fallbackFirstSeenAt)}
              {typeof job.progress === 'number' ? ` · ${Math.round(job.progress * 100)}%` : ''}
            </p>
          </div>
          <JobStatusBadge status={job.status} />
        </li>
      ))}
    </ul>
  );
}
