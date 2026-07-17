import type { MenuSectionRegistration } from '@tileborne/game-client';

import {
  BattleRoyaleLoadoutSection,
  BattleRoyaleLobbySection,
  BattleRoyaleMatchRulesSection,
  BattleRoyalePrivateRoomSection,
} from './sections.js';

/**
 * Battle Royale menu sections, registered into the generic shell's named slots
 * (ADR-0022). The app composes these with any brand `menuExtensions` before
 * mounting `RuntimeRoot`. Ids mirror the executable `menuSections` declared in
 * `tileborne-plugin.json` (entry `./dist/menu.js`).
 */
export const battleRoyaleMenuSections: readonly MenuSectionRegistration[] = [
  {
    id: 'br-lobby',
    slot: 'main.primaryActions',
    order: 10,
    source: 'plugin',
    Component: BattleRoyaleLobbySection,
  },
  {
    id: 'br-loadout',
    slot: 'main.tabs',
    order: 20,
    source: 'plugin',
    Component: BattleRoyaleLoadoutSection,
  },
  {
    id: 'br-private-room',
    slot: 'main.secondaryActions',
    order: 30,
    source: 'plugin',
    Component: BattleRoyalePrivateRoomSection,
  },
  {
    id: 'br-match-rules',
    slot: 'settings.tabs',
    order: 40,
    source: 'plugin',
    Component: BattleRoyaleMatchRulesSection,
  },
];

export {
  BattleRoyaleLoadoutSection,
  BattleRoyaleLobbySection,
  BattleRoyaleMatchRulesSection,
  BattleRoyalePrivateRoomSection,
} from './sections.js';
export {
  DEFAULT_BATTLE_ROYALE_MODELS,
  type BattleRoyaleSelectableModel,
} from '../player-models/models.js';
export {
  readSelectedModelId,
  resolveSelectedModelId,
  writeSelectedModelId,
} from '../player-models/loadout.js';
