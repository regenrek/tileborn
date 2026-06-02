import { BATTLE_ROYALE_PALETTE_ACTIONS } from '@tileborne/plugin-battle-royale/authoring';
import type { PaletteActionContribution } from '@/lib/palette-actions';

/**
 * App-composition registry of plugin-contributed palette actions. This is the
 * single wiring point that knows which plugins exist; the generic editor path
 * (store, tool-state, Working Palette UI) only ever sees the abstract
 * {@link PaletteActionContribution} shape.
 *
 * Adding a new game-mode plugin (e.g. an RPG top-down spawn) means appending
 * its contribution here — no editor changes required.
 */
export const PLUGIN_PALETTE_CONTRIBUTIONS: readonly PaletteActionContribution[] = [
  BATTLE_ROYALE_PALETTE_ACTIONS,
];
