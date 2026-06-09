import { useCallback, useState } from 'react';
import type {
  HudAnchor,
  HudLayout,
  HudWidgetInstanceId,
  ProjectManifest,
} from '@tileborne/core';

import { useUpdateProject } from '@/hooks/mutations';
import { moveWidgetOrder, setWidgetAnchor, setWidgetEnabled } from '@/lib/hud-layout-editing';
import { writeProjectHudLayout } from '@/lib/project-hud-layout';
import { clearUserHudOverlay, saveUserHudOverlay } from '@/lib/playtest-user-hud';
import { notifyError, notifySuccess } from '@/stores/app-notifications-store';

/**
 * Owns the visual HUD editor's state for a playtest viewport: the edit-mode
 * flag, the draft layout the overlay previews live, the pure edit operations,
 * and the two persistence targets — the PLAYER overlay (renderer prefs store)
 * and the PROJECT layout (project manifest settings bag, via the projects
 * IPC). `onPersisted` fires after each persist so the caller can re-run
 * `resolvePlaytestPlugin` and pick up the freshly saved layers.
 */
export function useHudEditing({
  baseLayout,
  project,
  onPersisted,
}: {
  readonly baseLayout: HudLayout | undefined;
  readonly project: ProjectManifest | undefined;
  readonly onPersisted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<HudLayout | undefined>(undefined);
  const updateProject = useUpdateProject();

  const start = useCallback(() => {
    setDraft(baseLayout);
    setEditing(true);
  }, [baseLayout]);

  const close = useCallback(() => {
    setEditing(false);
    setDraft(undefined);
  }, []);

  const apply = useCallback(
    (operation: (layout: HudLayout) => HudLayout) => {
      setDraft((current) => {
        const layout = current ?? baseLayout;
        return layout === undefined ? current : operation(layout);
      });
    },
    [baseLayout],
  );

  const moveWidget = useCallback(
    (widgetId: HudWidgetInstanceId, anchor: HudAnchor) =>
      apply((layout) => setWidgetAnchor(layout, widgetId, anchor)),
    [apply],
  );

  const toggleWidget = useCallback(
    (widgetId: HudWidgetInstanceId, enabled: boolean) =>
      apply((layout) => setWidgetEnabled(layout, widgetId, enabled)),
    [apply],
  );

  const reorderWidget = useCallback(
    (widgetId: HudWidgetInstanceId, direction: 'up' | 'down') =>
      apply((layout) => moveWidgetOrder(layout, widgetId, direction)),
    [apply],
  );

  const saveForMe = useCallback(() => {
    if (draft === undefined) {
      return;
    }
    saveUserHudOverlay(draft);
    onPersisted();
    notifySuccess('HUD layout saved for you');
    close();
  }, [draft, close, onPersisted]);

  const saveToProject = useCallback(async () => {
    if (draft === undefined || project === undefined) {
      return;
    }
    try {
      await updateProject.mutateAsync({ project: writeProjectHudLayout(project, draft) });
      onPersisted();
      notifySuccess('HUD layout saved to project');
      close();
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Failed to save HUD layout');
    }
  }, [draft, project, updateProject, close, onPersisted]);

  const resetUser = useCallback(() => {
    clearUserHudOverlay();
    onPersisted();
    notifySuccess('Your HUD changes were reset');
    close();
  }, [close, onPersisted]);

  return {
    editing,
    /** The layout the overlay should render: the live draft while editing. */
    layout: editing ? draft : undefined,
    isSaving: updateProject.isPending,
    canSaveProject: project !== undefined,
    start,
    close,
    moveWidget,
    toggleWidget,
    reorderWidget,
    saveForMe,
    saveToProject,
    resetUser,
  };
}
