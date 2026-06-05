import { ProjectManifest, type GameModeId } from '@tileborne/core';
import { resolveActiveGameMode, type GameModeDescriptor } from '@tileborne/plugin-api';

import type { PluginContributionsResponse } from '@/lib/bridge-types';

export const ACTIVE_GAME_MODE_SETTINGS_KEY = 'activeGameMode';
export type RendererGameMode = PluginContributionsResponse['gameModes'][number];

export const readProjectActiveGameModeId = (
  project: Pick<ProjectManifest, 'settings'> | undefined,
): GameModeId | undefined => {
  const value = project?.settings?.[ACTIVE_GAME_MODE_SETTINGS_KEY];
  return typeof value === 'string' ? (value as GameModeId) : undefined;
};

export const writeProjectActiveGameModeId = (
  project: ProjectManifest,
  modeId: GameModeId,
): ProjectManifest =>
  new ProjectManifest({
    ...project,
    settings: {
      ...(project.settings ?? {}),
      [ACTIVE_GAME_MODE_SETTINGS_KEY]: modeId,
    },
  });

export const resolveProjectActiveGameMode = (
  modes: readonly RendererGameMode[],
  project: Pick<ProjectManifest, 'settings'> | undefined,
): RendererGameMode | undefined =>
  resolveActiveGameMode(
    modes as unknown as readonly GameModeDescriptor[],
    readProjectActiveGameModeId(project),
  ) as RendererGameMode | undefined;
