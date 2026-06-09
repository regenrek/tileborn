import { useParams } from '@tanstack/react-router';
import {
  Button,
  ScrollArea,
  Separator,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
  typography,
} from '@tileborne/ui';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';

import { LayersSection } from '@/components/inspector/layers-section';
import { PropertiesPanel } from '@/components/inspector/properties-panel';
import { SelectionSummary } from '@/components/inspector/selection-summary';
import { ViewportOverlaysSection } from '@/components/inspector/viewport-overlays-section';
import { GenericModeSettingsPanel } from '@/components/plugins/generic-mode-settings-panel';
import { resolveModeAuthoringPanel } from '@/components/plugins/mode-authoring-panels';
import { PluginSlot } from '@/components/plugins/plugin-slot';
import { useMap, usePluginContributions, useProject } from '@/hooks/queries';
import { resolveProjectActiveGameMode } from '@/lib/active-game-mode-selection';
import { PLUGIN_SLOTS } from '@/lib/plugin-slots';
import { useEditorUiStore } from '@/stores/editor-ui-store';

export function RightInspector() {
  const { projectId, mapId } = useParams({ strict: false });
  const inspectorCollapsed = useEditorUiStore((s) => s.inspectorCollapsed);
  const setInspectorCollapsed = useEditorUiStore((s) => s.setInspectorCollapsed);
  const selection = useEditorUiStore((s) => s.selection);
  const activeTool = useEditorUiStore((s) => s.activeTool);
  const mapQuery = useMap(projectId, mapId);
  const projectQuery = useProject(projectId);
  const contributionsQuery = usePluginContributions();
  // ADR-0023 section B: mount the ACTIVE game mode's authoring panel by manifest
  // discovery (a plugin declaring a runtime system + settings panel), resolving
  // the bundled panel component by plugin id — not a `battleRoyaleEnabled`
  // literal-id check. Multi-mode projects must store an explicit
  // `project.settings.activeGameMode` selection before a mode panel is mounted.
  const activeMode = resolveProjectActiveGameMode(
    contributionsQuery.data?.gameModes ?? [],
    projectQuery.data?.project,
  );
  const ActiveModePanel =
    activeMode?.hasAuthoringPanel === true
      ? resolveModeAuthoringPanel(activeMode.pluginId)
      : undefined;
  // ADR-0023 section A: consume the active mode's first-class
  // `EditorGameSettingsForm` IPC projection. The renderer does not read forms
  // from settings-panel `data`.
  const activeModeSettingsForm = activeMode?.gameSettingsForm;

  if (inspectorCollapsed) {
    return (
      <TooltipProvider>
        <aside
          className="flex h-full w-full min-w-0 shrink-0 flex-col items-center overflow-hidden border-l border-border bg-sidebar py-2"
          data-testid="inspector-collapsed"
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Expand inspector"
                  onClick={() => setInspectorCollapsed(false)}
                >
                  <ChevronLeftIcon />
                </Button>
              }
            />
            <TooltipContent side="left">Expand inspector</TooltipContent>
          </Tooltip>
        </aside>
      </TooltipProvider>
    );
  }

  const selectionCount = selection.size;
  const selectedObjectIds = [...selection];

  return (
    <aside
      className="flex h-full min-w-0 flex-col overflow-hidden border-l border-border bg-sidebar"
      data-testid="inspector-expanded"
    >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2 py-1.5">
          <span className={cn('min-w-0 truncate', typography.panelTitle)}>Inspector</span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Collapse inspector"
            onClick={() => setInspectorCollapsed(true)}
          >
            <ChevronRightIcon />
          </Button>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="min-w-0 space-y-3 p-3">
            <SelectionSummary selectionCount={selectionCount} activeTool={activeTool} />

            <Separator />

            <section
              className="min-w-0 space-y-2"
              aria-labelledby="inspector-properties-title"
            >
              <h3 id="inspector-properties-title" className={typography.subsectionLabel}>
                Properties
              </h3>
              <PropertiesPanel
                selectionCount={selectionCount}
                isLoading={mapQuery.isLoading && Boolean(mapId)}
                projectId={projectId}
                map={mapQuery.data?.map}
                selectedObjectIds={selectedObjectIds}
              />
            </section>

            <Separator />

            <LayersSection />

            <Separator />

            <ViewportOverlaysSection />

            <Separator />

            <section
              className="min-w-0 space-y-2"
              data-testid="inspector-plugins-section"
              aria-labelledby="inspector-plugins-title"
            >
              <h3 id="inspector-plugins-title" className={typography.subsectionLabel}>
                Plugins
              </h3>
              {projectId !== undefined && mapQuery.data?.map !== undefined ? (
                ActiveModePanel !== undefined ? (
                  <ActiveModePanel
                    projectId={projectId}
                    map={mapQuery.data.map}
                    settingsForm={activeModeSettingsForm}
                  />
                ) : activeMode !== undefined && activeModeSettingsForm !== undefined ? (
                  <GenericModeSettingsPanel
                    projectId={projectId}
                    map={mapQuery.data.map}
                    pluginId={activeMode.pluginId}
                    label={activeMode.label}
                    form={activeModeSettingsForm}
                  />
                ) : null
              ) : null}
              <PluginSlot
                id={PLUGIN_SLOTS.inspectorRight}
                projectId={projectId}
                mapId={mapId}
              />
            </section>
          </div>
        </ScrollArea>
    </aside>
  );
}
