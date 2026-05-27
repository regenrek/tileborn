import {
  Button,
  Kbd,
  Separator,
  Toggle,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
  elevation,
  statusSurface,
  typography,
} from '@tileborne/ui';
import {
  Grid3x3Icon,
  MagnetIcon,
  Redo2Icon,
  Undo2Icon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react';

import { MAP_EDITOR_TOOLBAR_TOOLS } from '@/editor/toolbar/toolbar-tools';
import { useMapEditorToolbarShortcuts } from '@/editor/toolbar/use-map-editor-toolbar-shortcuts';
import { ZOOM_SHORTCUTS, zoomInFrom, zoomOutFrom } from '@/editor/toolbar/zoom';
import { useEditorCommandsBridge } from '@/stores/editor-commands-bridge';
import { useEditorUiStore } from '@/stores/editor-ui-store';

interface ToolbarTooltipLabelProps {
  readonly label: string;
  readonly shortcut?: string;
}

function ToolbarTooltipLabel({ label, shortcut }: ToolbarTooltipLabelProps) {
  return (
    <span className="inline-flex items-center gap-2">
      <span>{label}</span>
      {shortcut ? <Kbd variant="ghost">{shortcut}</Kbd> : null}
    </span>
  );
}

export function MapEditorToolbar() {
  useMapEditorToolbarShortcuts();

  const activeTool = useEditorUiStore((state) => state.activeTool);
  const setActiveTool = useEditorUiStore((state) => state.setActiveTool);
  const showGrid = useEditorUiStore((state) => state.showGrid);
  const setShowGrid = useEditorUiStore((state) => state.setShowGrid);
  const snapToGrid = useEditorUiStore((state) => state.snapToGrid);
  const setSnapToGrid = useEditorUiStore((state) => state.setSnapToGrid);
  const camera = useEditorUiStore((state) => state.camera);
  const setCamera = useEditorUiStore((state) => state.setCamera);

  const canUndo = useEditorCommandsBridge((state) => state.canUndo);
  const canRedo = useEditorCommandsBridge((state) => state.canRedo);
  const undo = useEditorCommandsBridge((state) => state.undo);
  const redo = useEditorCommandsBridge((state) => state.redo);

  return (
    <TooltipProvider>
      <div
        data-testid="map-editor-toolbar"
        className={cn(
          'pointer-events-auto absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-sidebar/95 p-1.5 shadow-md backdrop-blur-sm',
          elevation.md,
        )}
      >
        <ToggleGroup
          value={[activeTool]}
          onValueChange={(value) => {
            const next = value.at(-1);
            if (next) {
              setActiveTool(next as typeof activeTool);
            }
          }}
          orientation="horizontal"
          spacing={0}
          variant="outline"
          size="sm"
          className="w-auto"
          aria-label="Map editor tools"
        >
          {MAP_EDITOR_TOOLBAR_TOOLS.map((tool) => {
            const Icon = tool.icon;
            const isActive = activeTool === tool.id;
            return (
              <Tooltip key={tool.id}>
                <TooltipTrigger
                  render={
                    <ToggleGroupItem
                      value={tool.id}
                      aria-label={tool.label}
                      className={cn(
                        'rounded-md border-0',
                        isActive && statusSurface.info,
                      )}
                    >
                      <Icon aria-hidden className="size-3.5" />
                    </ToggleGroupItem>
                  }
                />
                <TooltipContent side="top">
                  <ToolbarTooltipLabel label={tool.label} shortcut={tool.shortcut} />
                </TooltipContent>
              </Tooltip>
            );
          })}
        </ToggleGroup>

        <Separator orientation="vertical" className="mx-0.5 h-7" />

        <div className="flex gap-1">
          <Toggle
            pressed={showGrid}
            onPressedChange={setShowGrid}
            size="sm"
            variant="outline"
            aria-label="Toggle grid"
            className={cn(showGrid && statusSurface.info)}
          >
            <Grid3x3Icon aria-hidden className="size-3.5" />
          </Toggle>

          <Toggle
            pressed={snapToGrid}
            onPressedChange={setSnapToGrid}
            size="sm"
            variant="outline"
            aria-label="Toggle snap to grid"
            className={cn(snapToGrid && statusSurface.info)}
          >
            <MagnetIcon aria-hidden className="size-3.5" />
          </Toggle>
        </div>

        <Separator orientation="vertical" className="mx-0.5 h-7" />

        <div className="flex gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="Zoom in"
                  onClick={() => setCamera({ zoom: zoomInFrom(camera.zoom) })}
                >
                  <ZoomInIcon aria-hidden className="size-3.5" />
                </Button>
              }
            />
            <TooltipContent side="top">
              <ToolbarTooltipLabel label="Zoom in" shortcut={ZOOM_SHORTCUTS.zoomIn} />
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="Zoom out"
                  onClick={() => setCamera({ zoom: zoomOutFrom(camera.zoom) })}
                >
                  <ZoomOutIcon aria-hidden className="size-3.5" />
                </Button>
              }
            />
            <TooltipContent side="top">
              <ToolbarTooltipLabel label="Zoom out" shortcut={ZOOM_SHORTCUTS.zoomOut} />
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn('px-2', typography.micro, 'font-medium')}
                  aria-label="Reset zoom to 100%"
                  onClick={() => setCamera({ zoom: 1 })}
                >
                  1:1
                </Button>
              }
            />
            <TooltipContent side="top">
              <ToolbarTooltipLabel label="Reset zoom" shortcut={ZOOM_SHORTCUTS.reset} />
            </TooltipContent>
          </Tooltip>
        </div>

        <Separator orientation="vertical" className="mx-0.5 h-7" />

        <div className="flex gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="Undo"
                  disabled={!canUndo}
                  onClick={() => undo?.()}
                >
                  <Undo2Icon aria-hidden className="size-3.5" />
                </Button>
              }
            />
            <TooltipContent side="top">
              <ToolbarTooltipLabel label="Undo" shortcut="⌘Z" />
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="Redo"
                  disabled={!canRedo}
                  onClick={() => redo?.()}
                >
                  <Redo2Icon aria-hidden className="size-3.5" />
                </Button>
              }
            />
            <TooltipContent side="top">
              <ToolbarTooltipLabel label="Redo" shortcut="⌘⇧Z" />
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}
