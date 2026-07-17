import { Skeleton } from '@tileborne/ui';

interface SidebarListSkeletonProps {
  readonly rows?: number;
}

export function SidebarListSkeleton({ rows = 4 }: SidebarListSkeletonProps) {
  return (
    <div className="space-y-2 py-1" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, rowNumber) => `sidebar-skeleton-row-${rowNumber}`).map(
        (rowKey) => (
          <Skeleton key={rowKey} className="h-7 w-full" />
        ),
      )}
    </div>
  );
}
