import { Skeleton } from '@tileborne/ui';

interface DrawerListSkeletonProps {
  readonly rows?: number;
}

export function DrawerListSkeleton({ rows = 5 }: DrawerListSkeletonProps) {
  return (
    <div className="space-y-2 py-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, rowNumber) => `drawer-skeleton-row-${rowNumber}`).map(
        (rowKey) => (
          <Skeleton key={rowKey} className="h-8 w-full" />
        ),
      )}
    </div>
  );
}
