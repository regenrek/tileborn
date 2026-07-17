import { Card, CardContent, CardHeader, Skeleton } from '@tileborne/ui';

interface PluginGridSkeletonProps {
  readonly count?: number;
}

export function PluginGridSkeleton({ count = 4 }: PluginGridSkeletonProps) {
  return (
    <div
      className="grid grid-cols-1 gap-3 md:grid-cols-2"
      aria-busy="true"
      aria-label="Loading plugins"
    >
      {Array.from({ length: count }, (_, cardNumber) => `plugin-skeleton-card-${cardNumber}`).map(
        (cardKey) => (
          <Card key={cardKey} className="gap-3 py-3">
            <CardHeader className="gap-3 px-4">
              <div className="flex items-start gap-3">
                <Skeleton className="size-9 rounded-md" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
                <Skeleton className="h-5 w-9 rounded-full" />
              </div>
              <div className="flex gap-2">
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-5 w-14 rounded-full" />
              </div>
            </CardHeader>
            <CardContent className="px-4">
              <Skeleton className="h-5 w-full rounded-full" />
            </CardContent>
          </Card>
        ),
      )}
    </div>
  );
}
