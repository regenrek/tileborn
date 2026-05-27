import {
  cn,
  typography,
  Skeleton,
} from '@tileborne/ui';
import { SlidersHorizontalIcon } from 'lucide-react';

interface PropertiesPanelProps {
  selectionCount: number;
  isLoading?: boolean;
}

export function PropertiesPanel({
  selectionCount,
  isLoading = false,
}: PropertiesPanelProps) {
  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="inspector-properties-loading">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-full" />
        <Skeleton className="h-7 w-full" />
      </div>
    );
  }

  if (selectionCount === 0) {
    return (
      <div className="space-y-3">
        <div className="flex min-w-0 items-start gap-2">
          <SlidersHorizontalIcon
            aria-hidden
            className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
          />
          <p className={cn('min-w-0 flex-1 break-words', typography.bodyDense)}>
            Select an object, trigger region, or spawn marker to edit properties.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className={cn('break-words', typography.bodyDense)}>
        Property editing for {selectionCount} selected object
        {selectionCount === 1 ? '' : 's'} is coming soon.
      </p>
      <div className="space-y-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-7 w-full" />
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-7 w-full" />
      </div>
    </div>
  );
}
