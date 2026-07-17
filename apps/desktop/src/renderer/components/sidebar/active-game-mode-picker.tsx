import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
  typography,
} from '@tileborne/ui';
import type { GameModeId } from '@tileborne/core';

import { useUpdateProject } from '@/hooks/mutations';
import { usePluginContributions, useProject } from '@/hooks/queries';
import {
  resolveProjectActiveGameMode,
  writeProjectActiveGameModeId,
} from '@/lib/active-game-mode-selection';
import { notifyError, notifySuccess } from '@/stores/app-notifications-store';

const UNSELECTED_GAME_MODE_VALUE = 'tileborne:select-active-game-mode';

export function ActiveGameModePicker({ projectId }: { readonly projectId: string | undefined }) {
  const contributionsQuery = usePluginContributions();
  const projectQuery = useProject(projectId);
  const updateProject = useUpdateProject();
  const project = projectQuery.data?.project;
  const gameModes = contributionsQuery.data?.gameModes ?? [];
  const activeMode = resolveProjectActiveGameMode(gameModes, project);

  if (projectId === undefined || contributionsQuery.isLoading || gameModes.length === 0) {
    return null;
  }

  const updateActiveMode = async (modeId: string) => {
    if (modeId === UNSELECTED_GAME_MODE_VALUE) {
      return;
    }
    if (project === undefined) {
      notifyError('Open a project before selecting a game mode.');
      return;
    }
    const nextMode = gameModes.find((mode) => mode.modeId === modeId);
    if (nextMode === undefined) {
      notifyError('That game mode is no longer available.');
      return;
    }
    try {
      await updateProject.mutateAsync({
        project: writeProjectActiveGameModeId(project, nextMode.modeId as GameModeId),
      });
      notifySuccess(`Active game mode set to ${nextMode.label}`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Failed to save active game mode');
    }
  };

  return (
    <section
      className="space-y-2 px-2"
      data-testid="active-game-mode-picker"
      aria-labelledby="active-game-mode-picker-title"
    >
      <div className="space-y-1">
        <p id="active-game-mode-picker-title" className={typography.panelTitle}>
          Active game mode
        </p>
        <p className={cn('text-muted-foreground', typography.bodyMicro)}>
          Choose which discovered mode drives authoring and playtest.
        </p>
      </div>
      <Select
        value={activeMode?.modeId ?? UNSELECTED_GAME_MODE_VALUE}
        onValueChange={(modeId) => {
          if (modeId !== null) {
            void updateActiveMode(modeId);
          }
        }}
        disabled={project === undefined || updateProject.isPending}
      >
        <SelectTrigger
          className="w-full"
          aria-label="Active game mode"
          data-testid="active-game-mode-select"
        >
          <SelectValue placeholder="Select game mode" />
        </SelectTrigger>
        <SelectContent>
          {activeMode === undefined ? (
            <SelectItem value={UNSELECTED_GAME_MODE_VALUE}>Select game mode</SelectItem>
          ) : null}
          {gameModes.map((mode) => (
            <SelectItem key={mode.modeId} value={mode.modeId}>
              {mode.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </section>
  );
}
