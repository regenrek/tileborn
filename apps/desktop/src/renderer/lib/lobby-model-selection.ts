/**
 * Persisted pre-match lobby model selection. The player's chosen player-model is
 * saved per-project and reused across matches (locked product decision: the
 * selection is persisted, not ephemeral). Persistence is intentionally simple
 * (localStorage keyed by project) so it survives playtest restarts and app
 * reloads without a new IPC contract.
 */
const storageKey = (projectId: string): string => `tileborne.playerModel.selection.${projectId}`;

const storage = (): Storage | undefined => {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

export const readLobbyModelSelection = (projectId: string): string | undefined => {
  const value = storage()?.getItem(storageKey(projectId));
  return value === null || value === undefined || value.length === 0 ? undefined : value;
};

export const writeLobbyModelSelection = (projectId: string, modelId: string): void => {
  storage()?.setItem(storageKey(projectId), modelId);
};

/**
 * Resolve the effective selected model id: the persisted pick when it still
 * exists in the roster, else the first roster model (stable default).
 */
export const resolveSelectedModelId = (
  projectId: string,
  rosterModelIds: readonly string[],
): string | undefined => {
  const persisted = readLobbyModelSelection(projectId);
  if (persisted !== undefined && rosterModelIds.includes(persisted)) {
    return persisted;
  }
  return rosterModelIds[0];
};
