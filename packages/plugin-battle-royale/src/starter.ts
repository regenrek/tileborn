import {
  ProjectManifest,
  PROJECT_SHIP_TARGET_SETTINGS_KEY,
  PROJECT_STARTUP_MAP_SETTINGS_KEY,
  HudLayout,
  InputMap,
  TileborneMap,
  type JsonValue,
  type MapId,
} from '@tileborne/core';
import { Schema } from 'effect';

import {
  BATTLE_ROYALE_CORE_PACK_ID,
  BATTLE_ROYALE_CORE_PACK_VERSION,
  DEFAULT_BATTLE_ROYALE_PLAYER_MODEL_REFS,
} from './content-assets.js';
import { PLUGIN_ID } from './constants.js';
import { generateMap } from './generate-map.js';
import { battleRoyaleDefaultHudLayout, BR_HUD_LAYOUT_ID } from './hud-layout.js';
import { battleRoyaleDefaultInputMap, BR_INPUT_MAP_ID } from './input-map.js';
import { applyBattleRoyalePlayerModels } from './player-models/roster.js';

export const BATTLE_ROYALE_STARTER_TEMPLATE_ID = 'battle-royale-starter-v1';
export const BATTLE_ROYALE_STARTER_VERSION = 1;

export const BATTLE_ROYALE_STARTER_CONTENT_TEMPLATE_IDS = [
  'gobj:e0e56b8c-aa3f-89be-8e2c-00c296acebf4',
  'gobj:7fa4f2e6-ea31-873b-8c6a-4cae28615f78',
  'gobj:9aeedc25-bee2-8d64-8f80-7a922d8cb826',
  'loot:1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
] as const;

export interface BattleRoyaleStarterMetadata {
  readonly idempotencyKey: string;
  readonly templateId: typeof BATTLE_ROYALE_STARTER_TEMPLATE_ID;
  readonly version: typeof BATTLE_ROYALE_STARTER_VERSION;
  readonly sourcePluginId: typeof PLUGIN_ID;
  readonly sourceAssetPackId: string;
  readonly sourceAssetPackVersion: string;
  readonly starterMapId?: string | undefined;
  readonly playerModelIds: readonly string[];
  readonly hudLayoutId: typeof BR_HUD_LAYOUT_ID;
  readonly inputMapId: typeof BR_INPUT_MAP_ID;
  readonly contentTemplateIds: readonly string[];
  readonly completed: boolean;
}

export const readBattleRoyaleStarterMetadata = (
  project: Pick<ProjectManifest, 'settings'>,
): BattleRoyaleStarterMetadata | undefined => {
  const value = project.settings?.newGameWizard;
  const record = value as Record<string, unknown> | undefined;
  if (
    typeof record !== 'object' ||
    record === null ||
    Array.isArray(value) ||
    record.templateId !== BATTLE_ROYALE_STARTER_TEMPLATE_ID ||
    typeof record.idempotencyKey !== 'string'
  ) {
    return undefined;
  }
  return record as unknown as BattleRoyaleStarterMetadata;
};

export const applyBattleRoyaleStarterProject = (
  project: ProjectManifest,
  input: { readonly idempotencyKey: string; readonly starterMapId?: string | undefined },
): ProjectManifest => {
  const withModels = applyBattleRoyalePlayerModels(
    project,
    DEFAULT_BATTLE_ROYALE_PLAYER_MODEL_REFS,
  );
  const metadata: BattleRoyaleStarterMetadata = {
    idempotencyKey: input.idempotencyKey,
    templateId: BATTLE_ROYALE_STARTER_TEMPLATE_ID,
    version: BATTLE_ROYALE_STARTER_VERSION,
    sourcePluginId: PLUGIN_ID,
    sourceAssetPackId: String(BATTLE_ROYALE_CORE_PACK_ID),
    sourceAssetPackVersion: BATTLE_ROYALE_CORE_PACK_VERSION,
    ...(input.starterMapId === undefined ? {} : { starterMapId: input.starterMapId }),
    playerModelIds: DEFAULT_BATTLE_ROYALE_PLAYER_MODEL_REFS.map((model) => model.id),
    hudLayoutId: BR_HUD_LAYOUT_ID,
    inputMapId: BR_INPUT_MAP_ID,
    contentTemplateIds: BATTLE_ROYALE_STARTER_CONTENT_TEMPLATE_IDS,
    completed: input.starterMapId !== undefined,
  };
  return new ProjectManifest({
    ...withModels,
    settings: {
      ...(withModels.settings ?? {}),
      activeGameMode: PLUGIN_ID,
      ...(input.starterMapId === undefined
        ? {}
        : { [PROJECT_STARTUP_MAP_SETTINGS_KEY]: input.starterMapId }),
      [PROJECT_SHIP_TARGET_SETTINGS_KEY]: 'local',
      hudLayout: Schema.encodeUnknownSync(HudLayout)(battleRoyaleDefaultHudLayout()) as JsonValue,
      inputMap: Schema.encodeUnknownSync(InputMap)(battleRoyaleDefaultInputMap()) as JsonValue,
      newGameWizard: metadata as unknown as JsonValue,
    },
  });
};

export const createBattleRoyaleStarterMap = (mapId: MapId, seed: string): TileborneMap => {
  const generated = generateMap(seed, {
    width: 48,
    height: 48,
    spawnCount: 8,
    lootDensity: 0.7,
  });
  return new TileborneMap({
    ...generated,
    id: mapId,
    properties: {
      ...generated.properties,
      title: 'Starter Battle Royale Arena',
      sourcePluginId: PLUGIN_ID,
      starterTemplateId: BATTLE_ROYALE_STARTER_TEMPLATE_ID,
      starterTemplateVersion: BATTLE_ROYALE_STARTER_VERSION,
      starterSeed: seed,
      tilesetPackId: BATTLE_ROYALE_CORE_PACK_ID,
    },
  });
};
