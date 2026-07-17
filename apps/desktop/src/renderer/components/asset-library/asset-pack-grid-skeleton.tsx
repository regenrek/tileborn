import { Card, CardContent, CardHeader, Skeleton } from '@tileborne/ui';

interface AssetPackGridSkeletonProps {
  readonly count?: number;
}

export function AssetPackGridSkeleton({ count = 6 }: AssetPackGridSkeletonProps) {
  return (
    <div
      className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3"
      aria-busy="true"
      aria-label="Loading asset packs"
    >
      {Array.from(
        { length: count },
        (_, cardNumber) => `asset-pack-skeleton-card-${cardNumber}`,
      ).map((cardKey) => (
        <Card key={cardKey} className="gap-2 py-2">
          <CardHeader className="gap-2 px-2">
            <Skeleton className="aspect-square w-full rounded-md" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </CardHeader>
          <CardContent className="px-2">
            <Skeleton className="h-3 w-2/3" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
