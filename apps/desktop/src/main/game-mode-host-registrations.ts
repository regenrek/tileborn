import type {
  GameObjectType,
  JsonObject,
  PlayerModelRef,
  ProjectManifest,
  TileborneMap,
} from '@tileborne/core';
import type { WeaponCatalogEntryView } from '@tileborne/ipc-contracts';
import {
  BATTLE_ROYALE_PLAYER_MODEL_POLICY,
  readBattleRoyalePlayerModels,
  resolveBattleRoyalePlayerModels,
} from '@tileborne/plugin-battle-royale/player-models';

import { diagnoseBattleRoyaleMapReadiness } from './battle-royale-readiness.js';

export const BATTLE_ROYALE_READINESS_CAPABILITY_ID = 'battle-royale.readiness' as const;

export interface GameModeHostRegistration {
  readonly capabilityId: string;
  readonly requiresPlayerModel: boolean;
  readonly supportsLocalMultiplayer: boolean;
  readonly resolvePlayerModels: (project: ProjectManifest) => readonly PlayerModelRef[];
  readonly hasInvalidAuthoredPlayerModels: (project: ProjectManifest) => boolean;
  readonly playerModelPolicy?: {
    readonly requiredClipKeys: readonly string[];
    readonly placeholderModelIds: readonly string[];
  };
  readonly diagnoseMap: (
    map: TileborneMap,
    weapons: readonly WeaponCatalogEntryView[],
    objectTypes: readonly GameObjectType[],
  ) => readonly {
    readonly code: string;
    readonly title: string;
    readonly message: string;
    readonly path: string;
  }[];
}

const BATTLE_ROYALE_HOST_REGISTRATION: GameModeHostRegistration = {
  capabilityId: BATTLE_ROYALE_READINESS_CAPABILITY_ID,
  requiresPlayerModel: true,
  supportsLocalMultiplayer: true,
  resolvePlayerModels: resolveBattleRoyalePlayerModels,
  hasInvalidAuthoredPlayerModels: (project) => {
    const authored = project.settings?.battleRoyale;
    const raw =
      typeof authored === 'object' && authored !== null && !Array.isArray(authored)
        ? (authored as JsonObject).playerModels
        : undefined;
    return Array.isArray(raw) && readBattleRoyalePlayerModels(project).length === 0;
  },
  playerModelPolicy: {
    requiredClipKeys: BATTLE_ROYALE_PLAYER_MODEL_POLICY.requiredClipKeys,
    placeholderModelIds: BATTLE_ROYALE_PLAYER_MODEL_POLICY.placeholderModelIds,
  },
  diagnoseMap: diagnoseBattleRoyaleMapReadiness,
};

const HOST_REGISTRATIONS = new Map<string, GameModeHostRegistration>([
  [BATTLE_ROYALE_HOST_REGISTRATION.capabilityId, BATTLE_ROYALE_HOST_REGISTRATION],
]);

/** The only main-process boundary allowed to bind a manifest capability to bundled mode code. */
export const resolveGameModeHostRegistration = (
  capabilityId: string | undefined,
): GameModeHostRegistration | undefined =>
  capabilityId === undefined ? undefined : HOST_REGISTRATIONS.get(capabilityId);
