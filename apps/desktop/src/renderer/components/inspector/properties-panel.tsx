import type { MapObject, TileborneMap } from '@tileborne/core';
import {
  cn,
  typography,
  Skeleton,
} from '@tileborne/ui';
import { SlidersHorizontalIcon } from 'lucide-react';

import { CatalogObjectPanel } from '@/components/inspector/catalog-object-panel';

interface PropertiesPanelProps {
  selectionCount: number;
  isLoading?: boolean;
  /** The open project, required to resolve the catalog for a selected object. */
  projectId?: string | undefined;
  /** The open map, the source of placed objects + the object-edit persist path. */
  map?: TileborneMap | undefined;
  /** Currently selected entity ids (placed object ids). */
  selectedObjectIds?: readonly string[] | undefined;
}

const findSelectedObject = (
  map: TileborneMap | undefined,
  selectedObjectIds: readonly string[] | undefined,
): MapObject | undefined => {
  if (map === undefined || selectedObjectIds === undefined || selectedObjectIds.length !== 1) {
    return undefined;
  }
  const [objectId] = selectedObjectIds;
  return map.objects.find((object) => object.id === objectId);
};

export function PropertiesPanel({
  selectionCount,
  isLoading = false,
  projectId,
  map,
  selectedObjectIds,
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

  const selectedObject = findSelectedObject(map, selectedObjectIds);
  if (selectedObject !== undefined && projectId !== undefined && map !== undefined) {
    return <CatalogObjectPanel projectId={projectId} map={map} object={selectedObject} />;
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
