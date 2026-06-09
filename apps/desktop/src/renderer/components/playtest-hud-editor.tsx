import type { HudAnchor, HudLayout, HudWidgetInstanceId } from '@tileborne/core';
import { Badge, Button, ScrollArea, Switch, cn, typography } from '@tileborne/ui';
import { ChevronDownIcon, ChevronUpIcon, XIcon } from 'lucide-react';

import { hudWidgetKindLabel, widgetsForEditor } from '@/lib/hud-layout-editing';

/**
 * Visual HUD editor panel (chassis-owned, layout-agnostic).
 *
 * Lists every widget of the EFFECTIVE layout — including disabled ones and
 * plugin-declared kinds the chassis cannot render — with anchor placement
 * (3x3 grid), visibility toggle, and stacking order. The panel mutates
 * nothing itself: every action is a callback into the owning editing state
 * (`useHudEditing`), which applies pure `hud-layout-editing` operations to a
 * draft and persists it as the player overlay or the project layout.
 */

const ANCHOR_GRID: readonly HudAnchor[] = [
  'top-left',
  'top-center',
  'top-right',
  'center-left',
  'center',
  'center-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];

export interface PlaytestHudEditorProps {
  readonly layout: HudLayout;
  readonly onSetAnchor: (widgetId: HudWidgetInstanceId, anchor: HudAnchor) => void;
  readonly onSetEnabled: (widgetId: HudWidgetInstanceId, enabled: boolean) => void;
  readonly onMoveOrder: (widgetId: HudWidgetInstanceId, direction: 'up' | 'down') => void;
  readonly onSaveUser: () => void;
  /** Absent when no project manifest is loaded (project save unavailable). */
  readonly onSaveProject?: (() => void) | undefined;
  readonly onResetUser: () => void;
  readonly onClose: () => void;
  readonly isSaving?: boolean;
}

function AnchorGrid({
  current,
  onSelect,
}: {
  readonly current: HudAnchor;
  readonly onSelect: (anchor: HudAnchor) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-0.5" role="group" aria-label="Anchor">
      {ANCHOR_GRID.map((anchor) => (
        <button
          key={anchor}
          type="button"
          title={anchor}
          aria-label={`Anchor ${anchor}`}
          aria-pressed={anchor === current}
          onClick={() => onSelect(anchor)}
          className={cn(
            'h-3.5 w-3.5 rounded-[3px] border transition-colors',
            anchor === current
              ? 'border-info bg-info'
              : 'border-border bg-muted/40 hover:bg-muted',
          )}
        />
      ))}
    </div>
  );
}

export function PlaytestHudEditor({
  layout,
  onSetAnchor,
  onSetEnabled,
  onMoveOrder,
  onSaveUser,
  onSaveProject,
  onResetUser,
  onClose,
  isSaving = false,
}: PlaytestHudEditorProps) {
  const widgets = widgetsForEditor(layout);
  return (
    <div
      className="absolute right-3 top-14 z-40 flex max-h-[calc(100%-7rem)] w-72 flex-col rounded-lg border border-border bg-background/95 shadow-lg backdrop-blur-sm"
      data-testid="playtest-hud-editor"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className={cn(typography.panelTitle)}>HUD Layout</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={onClose}
          aria-label="Close HUD editor"
          data-testid="playtest-hud-editor-close"
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-1 p-2">
          {widgets.map((widget) => (
            <div
              key={widget.id as string}
              className={cn(
                'grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 rounded-md border border-transparent px-2 py-1.5 hover:border-border hover:bg-muted/30',
                !widget.enabled && 'opacity-60',
              )}
              data-testid={`playtest-hud-editor-row-${widget.id as string}`}
            >
              <div className="min-w-0">
                <div className="truncate text-xs font-medium">
                  {hudWidgetKindLabel(widget.kind as string)}
                </div>
                <Badge variant="outline" className="mt-0.5 max-w-full truncate text-[9px]">
                  {widget.anchor}
                </Badge>
              </div>
              <AnchorGrid
                current={widget.anchor}
                onSelect={(anchor) => onSetAnchor(widget.id, anchor)}
              />
              <div className="flex flex-col">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-5"
                  onClick={() => onMoveOrder(widget.id, 'up')}
                  aria-label={`Move ${hudWidgetKindLabel(widget.kind as string)} up`}
                >
                  <ChevronUpIcon className="size-3" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-5"
                  onClick={() => onMoveOrder(widget.id, 'down')}
                  aria-label={`Move ${hudWidgetKindLabel(widget.kind as string)} down`}
                >
                  <ChevronDownIcon className="size-3" />
                </Button>
              </div>
              <Switch
                checked={widget.enabled}
                onCheckedChange={(checked) => onSetEnabled(widget.id, checked === true)}
                aria-label={`Show ${hudWidgetKindLabel(widget.kind as string)}`}
              />
            </div>
          ))}
        </div>
      </ScrollArea>

      <div className="flex flex-col gap-1.5 border-t border-border p-2">
        <div className="flex gap-1.5">
          <Button
            type="button"
            size="sm"
            className="flex-1"
            disabled={isSaving}
            onClick={onSaveUser}
            data-testid="playtest-hud-editor-save-user"
          >
            Save for me
          </Button>
          {onSaveProject !== undefined ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="flex-1"
              disabled={isSaving}
              onClick={onSaveProject}
              data-testid="playtest-hud-editor-save-project"
            >
              Save to project
            </Button>
          ) : null}
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={isSaving}
          onClick={onResetUser}
          data-testid="playtest-hud-editor-reset"
        >
          Reset my changes
        </Button>
      </div>
    </div>
  );
}
