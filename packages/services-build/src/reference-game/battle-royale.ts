import path from 'node:path';

import {
  PROJECT_SHIP_TARGET_SETTINGS_KEY,
  PROJECT_STARTUP_MAP_SETTINGS_KEY,
  MapObject,
  ObjectLayer,
  PluginId,
  ProjectAssetPackRef,
  ProjectManifest,
  ProjectPluginRef,
  gameObjectTypeIdForKey,
  makeLayerId,
  makeMapId,
  makeObjectId,
  makeTileborneMap,
  writePluginMapSettings,
  type GameObjectTypeId,
  type JsonObject,
  type MapId,
  type ProjectId,
  type TileborneMap,
} from '@tileborne/core';
import {
  AssetService,
  DirectoryAssetPackSource,
  MapService,
  ProjectService,
  applyInstalledPluginRuntimeDefaults,
  type InstalledPluginRuntimeDefaultsResult,
  ProjectBehaviorService,
} from '@tileborne/services-app';
import {
  LocalPluginSource,
  PluginInstallerService,
  PluginLoaderService,
} from '@tileborne/services-plugin';
import { Effect, Option, Schema } from 'effect';

export const BATTLE_ROYALE_REFERENCE_PLUGIN_ID = '@tileborne-plugins/battle-royale';
export const BATTLE_ROYALE_REFERENCE_PLUGIN_VERSION = '0.1.0';
export const BATTLE_ROYALE_REFERENCE_MAP_TITLE = 'Complete Reference Battle Royale';
export const BATTLE_ROYALE_REFERENCE_BEHAVIOR_LABEL = 'Reference Match Tick Marker';

const battleRoyalePluginId = Schema.decodeUnknownSync(PluginId)(BATTLE_ROYALE_REFERENCE_PLUGIN_ID);
const referenceMapId = makeMapId('550e8400-e29b-41d4-a716-446655440000');
const referenceLayerId = makeLayerId('550e8400-e29b-41d4-a716-446655440001');
const spawnPointKind = gameObjectTypeIdForKey('spawn-point');
const shrinkZoneAnchorKind = gameObjectTypeIdForKey('shrink-zone-anchor');
const lootCrateKind = gameObjectTypeIdForKey('loot-crate');

export interface BattleRoyaleReferencePlugin {
  readonly installed: import('@tileborne/services-plugin').InstalledPlugin;
  readonly declarative: unknown;
  readonly executable: unknown;
  readonly packageRoot: string;
}

export interface BattleRoyaleReferenceProject {
  readonly projectId: ProjectId;
  readonly mapId: MapId;
  readonly assetPackId: string;
  readonly assetPackVersion: string;
  readonly behaviorId: import('@tileborne/core').BehaviorId;
  readonly manifest: import('@tileborne/plugin-api').PluginManifest;
  readonly runtimeDefaults: InstalledPluginRuntimeDefaultsResult;
}

export const installBattleRoyaleReferencePluginPackage = (pluginPackagePath: string) =>
  Effect.gen(function* () {
    const installer = yield* PluginInstallerService;
    const installed = yield* installer.install(new LocalPluginSource({ path: pluginPackagePath }));
    const loader = yield* PluginLoaderService;
    const declarative = yield* loader.loadDeclarative(battleRoyalePluginId);
    const executable = yield* loader.loadExecutable(battleRoyalePluginId);
    return {
      installed,
      declarative,
      executable,
      packageRoot: pluginPackagePath,
    } satisfies BattleRoyaleReferencePlugin;
  });

const makeReferenceObject = (
  uuidSuffix: string,
  kind: GameObjectTypeId,
  x: number,
  y: number,
  properties: JsonObject = {},
): MapObject =>
  new MapObject({
    id: makeObjectId(`550e8400-e29b-41d4-a716-44665544${uuidSuffix}`),
    kind,
    x,
    y,
    width: Option.none(),
    height: Option.none(),
    layerId: referenceLayerId,
    properties,
  });

export const createBattleRoyaleReferenceMap = (
  mapId: MapId = referenceMapId,
  properties: JsonObject = {},
): TileborneMap => {
  const objects = [
    makeReferenceObject('0010', spawnPointKind, 16, 16, { team: 'solo', weight: 1 }),
    makeReferenceObject('0011', spawnPointKind, 31, 16, { team: 'solo', weight: 1 }),
    makeReferenceObject('0012', spawnPointKind, 50, 50, { team: 'solo', weight: 1 }),
    makeReferenceObject('0013', spawnPointKind, 6, 50, { team: 'solo', weight: 1 }),
    makeReferenceObject('0014', shrinkZoneAnchorKind, 16, 16, {
      initialRadiusTiles: 20,
      finalRadiusTiles: 4,
    }),
    makeReferenceObject('0015', lootCrateKind, 14, 18, { tier: 'common', respawnSeconds: 0 }),
  ] as const;
  const objectLayer = new ObjectLayer({
    id: referenceLayerId,
    name: 'Objects',
    visible: true,
    opacity: 1,
    objectIds: objects.map((object) => object.id),
  });
  return writePluginMapSettings(
    makeTileborneMap({
      id: mapId,
      width: 32,
      height: 32,
      tileWidth: 32,
      tileHeight: 32,
      layers: [objectLayer],
      objects,
      properties: {
        title: BATTLE_ROYALE_REFERENCE_MAP_TITLE,
        ...properties,
      },
    }),
    BATTLE_ROYALE_REFERENCE_PLUGIN_ID,
    {
      maxPlayers: 4,
      zone: {
        damagePerSecOutside: 50,
        schedule: {
          waitSec: 0,
          shrinkSec: 2,
          holdSec: 2,
          shrinkPhases: 1,
          radiusFactor: 0.5,
        },
      },
    } satisfies JsonObject,
  );
};

const referenceBehaviorSource = `import { defineBehavior, events } from '@tileborne/game-sdk';

export default defineBehavior({
  id: 'tileborne.reference.match-tick-marker',
  state: {
    lastTick: 0,
  },
  on: {
    [events.runtime.tick]: ({ event, state }) => state.set('lastTick', event.tick),
  },
});
`;

export const bootstrapBattleRoyaleReferenceProject = (options: {
  readonly pluginPackagePath: string;
  readonly projectId: ProjectId;
  readonly mapId: MapId;
}) =>
  Effect.gen(function* () {
    const referencePlugin = yield* installBattleRoyaleReferencePluginPackage(
      options.pluginPackagePath,
    );
    const executable = (referencePlugin.executable as { readonly module: unknown }).module as {
      readonly validateMap?: (map: TileborneMap) => {
        readonly ok: boolean;
        readonly issues: readonly unknown[];
      };
    };
    if (typeof executable.validateMap !== 'function') {
      throw new Error('Battle Royale executable entry did not expose validateMap');
    }

    const assets = yield* AssetService;
    const corePackId = yield* assets.importPackNow(
      new DirectoryAssetPackSource({
        path: path.join(referencePlugin.packageRoot, 'assets/core'),
      }),
    );
    const corePack = yield* assets.getPack(corePackId);

    const authoredMap = createBattleRoyaleReferenceMap(options.mapId, {
      tilesetPackId: String(corePack.id),
    });
    const validation = executable.validateMap(authoredMap);
    if (!validation.ok) {
      throw new Error(
        `Battle Royale reference map failed validation: ${JSON.stringify(validation.issues)}`,
      );
    }
    const maps = yield* MapService;
    yield* maps.save(options.projectId, authoredMap);

    const projects = yield* ProjectService;
    const project = yield* projects.open(options.projectId);
    yield* projects.save(
      new ProjectManifest({
        ...project,
        plugins: [
          new ProjectPluginRef({
            id: battleRoyalePluginId,
            version: BATTLE_ROYALE_REFERENCE_PLUGIN_VERSION,
          }),
        ],
        assetPacks: [
          new ProjectAssetPackRef({ id: String(corePack.id), version: corePack.version }),
        ],
        settings: {
          ...(project.settings ?? {}),
          activeGameMode: BATTLE_ROYALE_REFERENCE_PLUGIN_ID,
          [PROJECT_STARTUP_MAP_SETTINGS_KEY]: options.mapId,
          [PROJECT_SHIP_TARGET_SETTINGS_KEY]: 'local',
        },
      }),
    );

    const runtimeDefaults = yield* applyInstalledPluginRuntimeDefaults(
      options.projectId,
      BATTLE_ROYALE_REFERENCE_PLUGIN_ID,
      [referencePlugin.installed],
      {
        shell: {
          mainMenuTitle: 'Reference Battle Royale Lobby',
          mainMenuSubtitle: 'Solo and squad deployment',
        },
      },
    );

    const behaviors = yield* ProjectBehaviorService;
    const behaviorSnapshot = yield* behaviors.createTypeScript(options.projectId, {
      label: BATTLE_ROYALE_REFERENCE_BEHAVIOR_LABEL,
      source: referenceBehaviorSource,
    });
    const behaviorId = behaviorSnapshot.resources.find(
      (resource) => resource.manifest.label === BATTLE_ROYALE_REFERENCE_BEHAVIOR_LABEL,
    )?.manifest.id;
    if (behaviorId === undefined) {
      throw new Error('Battle Royale reference behavior was not saved');
    }

    return {
      projectId: options.projectId,
      mapId: options.mapId,
      assetPackId: String(corePack.id),
      assetPackVersion: corePack.version,
      behaviorId,
      manifest: referencePlugin.installed.manifest,
      runtimeDefaults,
    } satisfies BattleRoyaleReferenceProject;
  });
