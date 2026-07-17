import { useEffect } from 'react';
import { useParams } from '@tanstack/react-router';
import { Badge, Button, cn, typography } from '@tileborne/ui';
import type { LayerId, MapLayer } from '@tileborne/core';
import { EyeIcon, EyeOffIcon, LayersIcon, MapIcon } from 'lucide-react';

import { SidebarEmptyState } from '@/components/sidebar/sidebar-empty-state';
import { SidebarListSkeleton } from '@/components/sidebar/sidebar-list-skeleton';
import { createSetLayerVisibilityCommand } from '@/editor/editor-commands';
import { resolveActiveLayerId } from '@/editor/layer-selection';
import { useMap } from '@/hooks/queries';
import { useEditorCommandsBridge } from '@/stores/editor-commands-bridge';
import { useEditorUiStore } from '@/stores/editor-ui-store';

const LAYER_KIND_LABEL: Record<MapLayer['_tag'], string> = {
  tile: 'Tile',
  object: 'Object',
  image: 'Image',
  collision: 'Collision',
};

function LayerRow({
  layer,
  active,
  onSelect,
  onToggleVisibility,
}: {
  readonly layer: MapLayer;
  readonly active: boolean;
  readonly onSelect: () => void;
  readonly onToggleVisibility: () => void;
}) {
  const VisibilityIcon = layer.visible ? EyeIcon : EyeOffIcon;
  return (
    <div
      data-active={active ? '' : undefined}
      className={cn(
        'group/layer-row relative flex h-7 min-w-0 items-stretch overflow-hidden rounded-md',
        'before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-primary before:opacity-0 before:transition-opacity',
        active &&
          'bg-accent text-accent-foreground ring-1 ring-inset ring-primary/30 before:opacity-100',
        !active && 'hover:bg-muted',
        !layer.visible && 'opacity-60',
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={layer.visible ? `Hide layer ${layer.name}` : `Show layer ${layer.name}`}
        aria-pressed={!layer.visible}
        className={cn(
          'h-7 w-7 shrink-0 rounded-none bg-transparent hover:bg-transparent hover:text-foreground',
          active && 'hover:bg-accent/80',
        )}
        onClick={onToggleVisibility}
      >
        <VisibilityIcon
          className={cn(
            'size-3.5',
            layer.visible
              ? active
                ? 'text-primary'
                : 'text-muted-foreground'
              : 'text-muted-foreground/60',
          )}
          aria-hidden
        />
      </Button>
      <button
        type="button"
        aria-pressed={active}
        onClick={onSelect}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2 pr-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
        )}
      >
        <span
          className={cn('min-w-0 flex-1 truncate', typography.rowTitle, active && 'font-medium')}
        >
          {layer.name}
        </span>
        <Badge
          variant={active ? 'default' : 'secondary'}
          className={cn('shrink-0 px-1.5 py-0 font-normal', typography.rowMeta)}
        >
          {LAYER_KIND_LABEL[layer._tag]}
        </Badge>
      </button>
    </div>
  );
}

export function LayersSection() {
  const { projectId, mapId } = useParams({ strict: false });
  const mapQuery = useMap(projectId, mapId);
  const activeLayerId = useEditorUiStore((s) => s.activeLayerId);
  const setActiveLayerId = useEditorUiStore((s) => s.setActiveLayerId);
  const applyCommand = useEditorCommandsBridge((s) => s.applyCommand);

  const layers = mapQuery.data?.map.layers ?? [];
  const resolvedActiveLayerId =
    mapQuery.data?.map === undefined
      ? null
      : resolveActiveLayerId(mapQuery.data.map, activeLayerId);

  useEffect(() => {
    if (resolvedActiveLayerId !== activeLayerId) {
      setActiveLayerId(resolvedActiveLayerId);
    }
  }, [activeLayerId, resolvedActiveLayerId, setActiveLayerId]);

  const handleToggleVisibility = (layerId: LayerId) => {
    const currentMap = mapQuery.data?.map;
    if (!currentMap || !applyCommand) {
      return;
    }
    const layer = currentMap.layers.find((entry) => entry.id === layerId);
    if (!layer) {
      return;
    }
    const command = createSetLayerVisibilityCommand(currentMap, layerId, !layer.visible);
    if (command) {
      applyCommand(command);
    }
  };

  return (
    <section className="flex min-h-0 flex-col" data-testid="inspector-layers-section">
      <div className="flex shrink-0 items-center gap-2 pb-1.5">
        <LayersIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className={typography.panelTitle}>Layers</span>
        {layers.length > 0 ? (
          <Badge
            variant="secondary"
            className={cn('ml-auto px-1.5 py-0 font-normal', typography.rowMeta)}
            aria-label={`${layers.length} layer${layers.length === 1 ? '' : 's'}`}
          >
            {layers.length}
          </Badge>
        ) : null}
      </div>

      {!mapId || !projectId ? (
        <SidebarEmptyState
          icon={MapIcon}
          title="No map open"
          description="Open a map to view tile, object, and overlay layers."
          className="py-3"
        />
      ) : mapQuery.isLoading ? (
        <SidebarListSkeleton rows={3} />
      ) : (
        <div className="flex flex-col gap-0.5">
          {layers.length === 0 ? (
            <SidebarEmptyState
              icon={LayersIcon}
              title="No layers on map"
              description="This map has no authored layers yet."
              className="py-3"
            />
          ) : (
            layers.map((layer) => (
              <LayerRow
                key={layer.id}
                layer={layer}
                active={resolvedActiveLayerId === layer.id}
                onSelect={() => setActiveLayerId(layer.id as LayerId)}
                onToggleVisibility={() => handleToggleVisibility(layer.id as LayerId)}
              />
            ))
          )}
        </div>
      )}
    </section>
  );
}
