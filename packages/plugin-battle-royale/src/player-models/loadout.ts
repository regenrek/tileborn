import { DEFAULT_BATTLE_ROYALE_MODELS, type BattleRoyaleSelectableModel } from "./models.js";

/**
 * Shipped-client loadout selection sink for the Battle Royale menu surfaces.
 * The chosen model is persisted (locked product decision: the selection
 * survives across matches) via localStorage when available, falling back to the
 * first roster entry. Operates purely on the canonical
 * {@link BattleRoyaleSelectableModel} identity — no parallel model definition.
 */
const STORAGE_KEY = "tileborne.battle-royale.loadout.model";

const storage = (): Storage | undefined => {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

export const readSelectedModelId = (): string | undefined => {
  const value = storage()?.getItem(STORAGE_KEY);
  return value === null || value === undefined || value.length === 0 ? undefined : value;
};

export const writeSelectedModelId = (modelId: string): void => {
  storage()?.setItem(STORAGE_KEY, modelId);
};

/**
 * Resolve the effective selected model id: the persisted pick when it still
 * exists in the roster, else the first roster entry (stable default).
 */
export const resolveSelectedModelId = (
  roster: readonly BattleRoyaleSelectableModel[] = DEFAULT_BATTLE_ROYALE_MODELS,
): string | undefined => {
  const persisted = readSelectedModelId();
  if (persisted !== undefined && roster.some((model) => model.id === persisted)) {
    return persisted;
  }
  return roster[0]?.id;
};
