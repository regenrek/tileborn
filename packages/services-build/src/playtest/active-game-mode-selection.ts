import type { GameModeId, ProjectManifest } from "@tileborne/core";

export const ACTIVE_GAME_MODE_SETTINGS_KEY = "activeGameMode";

export const readProjectActiveGameModeId = (
  project: Pick<ProjectManifest, "settings"> | undefined,
): GameModeId | undefined => {
  const value = project?.settings?.[ACTIVE_GAME_MODE_SETTINGS_KEY];
  return typeof value === "string" ? (value as GameModeId) : undefined;
};
