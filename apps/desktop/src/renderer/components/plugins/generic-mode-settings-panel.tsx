import { useMemo } from 'react';
import {
  readPluginMapSettings,
  readPluginProjectSettings,
  writePluginMapSettings,
  writePluginProjectSettings,
  type JsonObject,
  type ProjectId,
  type TileborneMap,
} from '@tileborne/core';
import type { MaterializedGameSettingsForm } from '@tileborne/plugin-api';

import { useProject } from '@/hooks/queries';
import { useUpdateMap, useUpdateProject } from '@/hooks/mutations';
import { notifyError, notifySuccess } from '@/stores/app-notifications-store';

import { GameSettingsForm } from './game-settings-form';

interface GenericModeSettingsPanelProps {
  readonly projectId: string;
  readonly map: TileborneMap;
  readonly pluginId: string;
  readonly label: string;
  readonly form: MaterializedGameSettingsForm;
}

/**
 * The DEFAULT authoring settings panel the inspector mounts for a discovered
 * game mode that ships an `EditorGameSettingsForm` but no bespoke React panel
 * (ADR-0023 section A). It round-trips the form's FLAT values directly under the
 * neutral per-plugin namespace owned by `@tileborne/core` — honoring the form's
 * declared {@link MaterializedGameSettingsForm.scope}: `"map"` persists under
 * `map.properties.<pluginId>` (via {@link useUpdateMap}); `"project"` persists
 * under `project.settings.<pluginId>` (via {@link useUpdateProject}). No engine
 * edit per genre. A mode wanting richer authoring (e.g. Battle Royale's
 * player-model roster) registers a custom panel in `mode-authoring-panels`.
 */
export function GenericModeSettingsPanel({
  projectId,
  map,
  pluginId,
  label,
  form,
}: GenericModeSettingsPanelProps) {
  const isProjectScope = form.scope === 'project';
  const updateMap = useUpdateMap();
  const updateProject = useUpdateProject();
  // Only fetch the project manifest when the form declares project scope; the
  // query is disabled (no IPC) for map-scoped forms.
  const projectQuery = useProject(isProjectScope ? projectId : undefined);
  const project = projectQuery.data?.project;

  const values = useMemo<JsonObject>(
    () =>
      isProjectScope
        ? project === undefined
          ? {}
          : readPluginProjectSettings(project, pluginId)
        : readPluginMapSettings(map, pluginId),
    [isProjectScope, project, map, pluginId],
  );

  // A project-scoped save can't run until the manifest has loaded; block the
  // form (rather than silently dropping the write) until it is available.
  const isPending = isProjectScope ? updateProject.isPending : updateMap.isPending;
  const disabled = isPending || (isProjectScope && project === undefined);

  const save = async (next: Record<string, number>) => {
    try {
      if (isProjectScope) {
        if (project === undefined) {
          throw new Error(`${label} settings: project not loaded`);
        }
        await updateProject.mutateAsync({
          project: writePluginProjectSettings(project, pluginId, next),
        });
      } else {
        await updateMap.mutateAsync({
          projectId: projectId as ProjectId,
          map: writePluginMapSettings(map, pluginId, next),
        });
      }
      notifySuccess(`${label} settings saved`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : `${label} settings save failed`);
      throw error;
    }
  };

  return (
    <div className="space-y-3" data-testid="generic-mode-settings-panel">
      <GameSettingsForm
        form={form}
        values={values}
        disabled={disabled}
        saveLabel={`Save ${label} settings`}
        testIdPrefix="mode-setting"
      onSave={save}
      onInvalid={notifyError}
      document={{
        id: `game-settings:${projectId}:${map.id}:${pluginId}`,
        scopeId: `map:${projectId}:${map.id}`,
        label: `${label} settings`,
      }}
      />
    </div>
  );
}
