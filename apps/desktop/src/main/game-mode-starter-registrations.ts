import {
  makeTileborneMap,
  ProjectManifest,
  PROJECT_SHIP_TARGET_SETTINGS_KEY,
  PROJECT_STARTUP_MAP_SETTINGS_KEY,
  type JsonValue,
  type MapId,
  type PackId,
  type TileborneMap,
} from '@tileborne/core';
import {
  applyBattleRoyaleStarterProject,
  BATTLE_ROYALE_CORE_PACK_ID,
  BATTLE_ROYALE_CORE_PACK_VERSION,
  BATTLE_ROYALE_STARTER_TEMPLATE_ID,
  BATTLE_ROYALE_STARTER_VERSION,
  createBattleRoyaleStarterMap,
  readBattleRoyaleStarterMetadata,
} from '@tileborne/plugin-battle-royale';
import { ARENA_PLUGIN_ID } from '@tileborne/plugin-example-arena/constants';

export interface GameModeStarterRegistration {
  readonly capabilityId: string;
  readonly pluginId: string;
  readonly templateId: string;
  readonly version: number;
  readonly mapSize: { readonly width: number; readonly height: number };
  readonly assetPacks: readonly { readonly id: PackId | string; readonly version: string }[];
  readonly readIdempotencyKey: (project: ProjectManifest) => string | undefined;
  readonly applyProject: (
    project: ProjectManifest,
    input: { readonly idempotencyKey: string; readonly starterMapId?: string | undefined },
  ) => ProjectManifest;
  readonly createMap: (mapId: MapId, seed: string) => TileborneMap;
}

const BATTLE_ROYALE_STARTER: GameModeStarterRegistration = {
  capabilityId: 'battle-royale.starter',
  pluginId: '@tileborne-plugins/battle-royale',
  templateId: BATTLE_ROYALE_STARTER_TEMPLATE_ID,
  version: BATTLE_ROYALE_STARTER_VERSION,
  mapSize: { width: 48, height: 48 },
  assetPacks: [{ id: BATTLE_ROYALE_CORE_PACK_ID, version: BATTLE_ROYALE_CORE_PACK_VERSION }],
  readIdempotencyKey: (project) => readBattleRoyaleStarterMetadata(project)?.idempotencyKey,
  applyProject: applyBattleRoyaleStarterProject,
  createMap: createBattleRoyaleStarterMap,
};

const EXAMPLE_ARENA_TEMPLATE_ID = 'example-arena-starter-v1';
const EXAMPLE_ARENA_STARTER: GameModeStarterRegistration = {
  capabilityId: 'example-arena.starter',
  pluginId: ARENA_PLUGIN_ID,
  templateId: EXAMPLE_ARENA_TEMPLATE_ID,
  version: 1,
  mapSize: { width: 32, height: 32 },
  assetPacks: [],
  readIdempotencyKey: (project) => {
    const metadata = project.settings?.newGameWizard as Record<string, unknown> | undefined;
    return metadata?.templateId === EXAMPLE_ARENA_TEMPLATE_ID && typeof metadata.idempotencyKey === 'string'
      ? metadata.idempotencyKey
      : undefined;
  },
  applyProject: (project, input) =>
    new ProjectManifest({
      ...project,
      settings: {
        ...(project.settings ?? {}),
        activeGameMode: ARENA_PLUGIN_ID,
        ...(input.starterMapId === undefined
          ? {}
          : { [PROJECT_STARTUP_MAP_SETTINGS_KEY]: input.starterMapId }),
        [PROJECT_SHIP_TARGET_SETTINGS_KEY]: 'local',
        newGameWizard: {
          idempotencyKey: input.idempotencyKey,
          templateId: EXAMPLE_ARENA_TEMPLATE_ID,
          version: 1,
          sourcePluginId: ARENA_PLUGIN_ID,
          ...(input.starterMapId === undefined ? {} : { starterMapId: input.starterMapId }),
          completed: input.starterMapId !== undefined,
        } as JsonValue,
      },
    }),
  createMap: (mapId, seed) =>
    makeTileborneMap({
      id: mapId,
      width: 32,
      height: 32,
      tileWidth: 16,
      tileHeight: 16,
      properties: {
        title: 'Starter Example Arena',
        sourcePluginId: ARENA_PLUGIN_ID,
        starterTemplateId: EXAMPLE_ARENA_TEMPLATE_ID,
        starterTemplateVersion: 1,
        starterSeed: seed,
        [ARENA_PLUGIN_ID]: { arenaRadius: 32, enemyCount: 8 },
      },
    }),
};

const STARTER_REGISTRATIONS = new Map<string, GameModeStarterRegistration>(
  [BATTLE_ROYALE_STARTER, EXAMPLE_ARENA_STARTER].map((entry) => [entry.capabilityId, entry]),
);

export const resolveGameModeStarterRegistration = (
  capabilityId: string | undefined,
): GameModeStarterRegistration | undefined =>
  capabilityId === undefined ? undefined : STARTER_REGISTRATIONS.get(capabilityId);

/** Current New Game button default; the generic orchestration below does not know which mode it is. */
export const defaultGameModeStarterRegistration = (): GameModeStarterRegistration =>
  BATTLE_ROYALE_STARTER;
