import { Badge } from '@tileborne/ui';
import type { ComponentProps } from 'react';

type JobStatus = 'Pending' | 'Running' | 'Completed' | 'Failed' | 'Cancelled';

const STATUS_VARIANT: Record<
  JobStatus,
  NonNullable<ComponentProps<typeof Badge>['variant']>
> = {
  Pending: 'muted',
  Running: 'info',
  Completed: 'success',
  Failed: 'destructive',
  Cancelled: 'muted',
};

export function JobStatusBadge({ status }: { readonly status: string }) {
  const variant =
    status in STATUS_VARIANT
      ? STATUS_VARIANT[status as JobStatus]
      : 'outline';

  return <Badge variant={variant}>{status}</Badge>;
}
