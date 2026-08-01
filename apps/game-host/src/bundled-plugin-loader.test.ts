import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { JsonValue } from '@tileborne/core';
import { BattleRoyaleProtocol } from '@tileborne/ipc-contracts';
import { LOOT_CRATE_KIND, SPAWN_POINT_KIND } from '@tileborne/plugin-battle-royale/constants';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  bundledPlugin,
  createBundledPluginLoader,
  createDefaultBundledPluginProtocolBridge,
} from './bundled-plugin-loader.js';
import { bundledMapPackages } from './.generated/bundled-map-packages.js';
import {
  playtestHeldBooleanInputFields,
  playtestInputEdgeFields,
} from './.generated/plugin-runtime.js';

const generatedRuntimeTypesPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '.generated/plugin-runtime.d.ts',
);
const optionalDirectionPattern = /readonly dir\?: 0 \| 1 \| 2 \| 3 \| 4 \| 5 \| 6 \| 7;/gu;
const playtestInputEdgeFieldsDeclarationPattern =
  /export declare const playtestInputEdgeFields: readonly string\[\];/u;
const playtestHeldBooleanInputFieldsDeclarationPattern =
  /export declare const playtestHeldBooleanInputFields: readonly string\[\];/u;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * Room-supplied encoded `RuntimeMapPackage`: the bundled default with a
 * single authored tile-space spawn at (10, 20) and one loot crate at (12, 18).
 */
const makeMapPackage = (): unknown => {
  const pkg = clone(bundledMapPackages[0]!.mapPackage) as {
    placements: unknown;
    modeData: Record<string, { maxPlayers: number; lootTables: unknown }>;
  };
  pkg.placements = [
    {
      objectId: 'object:00000000-0000-4000-8000-000000000104',
      typeId: SPAWN_POINT_KIND,
      x: 10,
      y: 20,
      instanceProperties: { team: 'solo', weight: 1 },
    },
    {
      objectId: 'object:00000000-0000-4000-8000-000000000103',
      typeId: LOOT_CRATE_KIND,
      x: 12,
      y: 18,
      instanceProperties: { itemKind: 'rifle', tier: 'rare', weight: 1 },
    },
  ];
  const modeSection = pkg.modeData['@tileborne-plugins/battle-royale'];
  if (modeSection === undefined) {
    throw new Error('default map package is missing the BR modeData section');
  }
  modeSection.maxPlayers = 1;
  modeSection.lootTables = [{ itemKind: 'rifle', tier: 'rare', weight: 1 }];
  return pkg;
};

describe('createBundledPluginLoader', () => {
  it('keeps generated BR input declarations aligned with shoot-only frames', () => {
    const source = readFileSync(generatedRuntimeTypesPath, 'utf8');

    expect(source.match(optionalDirectionPattern)).toHaveLength(2);
    expect(source).not.toMatch(/readonly dir: 0 \| 1 \| 2 \| 3 \| 4 \| 5 \| 6 \| 7;/u);
    expect(source).toMatch(playtestInputEdgeFieldsDeclarationPattern);
    expect(source).toMatch(playtestHeldBooleanInputFieldsDeclarationPattern);
  });

  it('uses the generated BR-owned playtest input edge fields', () => {
    expect(playtestInputEdgeFields).toEqual([
      'shoot',
      'reload',
      'interact',
      'drop',
      'abilities',
      'swapSlot',
    ]);
    expect(playtestHeldBooleanInputFields).toEqual(['shoot']);
  });

  it('registers the bundled BR adapter and emits live tick snapshots', async () => {
    const frames: Uint8Array[] = [];
    let replayFrames: readonly Uint8Array[] = [];
    const loader = createBundledPluginLoader({
      getPlayerIds: () => ['player-1', 'player-2'],
      emitFrame: (frame) => {
        frames.push(frame);
      },
      setReplayFrames: (frames) => {
        replayFrames = frames;
      },
      getInput: (playerId) =>
        playerId === 'player-1'
          ? {
              tick: 1,
              seq: 1,
              dir: 0,
              shoot: false,
              reload: false,
              interact: false,
              drop: false,
              abilities: [],
            }
          : undefined,
    });

    const executable = await Effect.runPromise(loader.loadExecutable(bundledPlugin.id));
    const plugin = 'id' in executable ? executable : executable.default;
    if (!plugin?.onInit || !plugin.onTick) {
      throw new Error('bundled plugin did not expose runtime hooks');
    }

    await Effect.runPromise(plugin.onInit({ pluginId: plugin.id }));
    await Effect.runPromise(plugin.onTick({} as never, 1 / 20, 1));

    const messages = frames.map((frame) => BattleRoyaleProtocol.decodeServerMessage(frame));
    const welcome = messages.find((message) => message._tag === 'WelcomeSnapshot');
    const delta = messages.find((message) => message._tag === 'DeltaSnapshot');

    expect(welcome?._tag).toBe('WelcomeSnapshot');
    expect(delta?._tag).toBe('DeltaSnapshot');
    const replayWelcome = replayFrames
      .map((frame) => BattleRoyaleProtocol.decodeServerMessage(frame))
      .find((message) => message._tag === 'WelcomeSnapshot');
    expect(replayWelcome?._tag).toBe('WelcomeSnapshot');
    if (welcome?._tag === 'WelcomeSnapshot' && delta?._tag === 'DeltaSnapshot') {
      expect(welcome.players).toHaveLength(2);
      const initialPlayer = welcome.players.find((player) => player.id === 'player-1');
      const movedPlayer = delta.updated.find((player) => player.id === 'player-1');
      expect(initialPlayer).toBeDefined();
      expect(movedPlayer).toBeDefined();
      if (replayWelcome?._tag === 'WelcomeSnapshot') {
        const replayPlayer = replayWelcome.players.find((player) => player.id === 'player-1');
        expect(replayWelcome.tick).toBe(1);
        expect(replayPlayer?.x).toBeGreaterThan(initialPlayer?.x ?? 0);
      }
      expect(movedPlayer?.x._tag).toBe('Some');
      if (movedPlayer?.x._tag === 'Some') {
        expect(movedPlayer.x.value).toBeGreaterThan(initialPlayer?.x ?? 0);
      }
    }
  });

  it('accepts shoot-only bundled runtime input without a movement direction', async () => {
    const frames: Uint8Array[] = [];
    const loader = createBundledPluginLoader({
      // Keep this protocol/input test independent from the default arena's
      // edge-distributed fair-spawn layout.
      mapPackage: makeMapPackage(),
      getPlayerIds: () => ['player-1'],
      emitFrame: (frame) => {
        frames.push(frame);
      },
      getInput: (playerId) =>
        playerId === 'player-1'
          ? {
              tick: 1,
              seq: 1,
              shoot: true,
              reload: false,
              interact: false,
              drop: false,
              abilities: [],
              aimDeg: 0,
              swapSlot: 2,
            }
          : undefined,
    });

    const executable = await Effect.runPromise(loader.loadExecutable(bundledPlugin.id));
    const plugin = 'id' in executable ? executable : executable.default;
    if (!plugin?.onInit || !plugin.onTick) {
      throw new Error('bundled plugin did not expose runtime hooks');
    }

    await Effect.runPromise(plugin.onInit({ pluginId: plugin.id }));
    await Effect.runPromise(plugin.onTick({} as never, 1 / 20, 1));

    const delta = frames
      .map((frame) => BattleRoyaleProtocol.decodeServerMessage(frame))
      .find((message) => message._tag === 'DeltaSnapshot');

    expect(delta?._tag).toBe('DeltaSnapshot');
    if (delta?._tag === 'DeltaSnapshot') {
      expect(delta.projectilesUpdated).toHaveLength(1);
      expect(delta.projectilesUpdated[0]?.weaponSlot._tag).toBe('Some');
      expect(
        delta.projectilesUpdated[0]?.weaponSlot._tag === 'Some'
          ? delta.projectilesUpdated[0].weaponSlot.value
          : undefined,
      ).toBe(2);
    }
  });

  it('uses the supplied mapPackage for spawns and object snapshots', async () => {
    const frames: Uint8Array[] = [];
    const loader = createBundledPluginLoader({
      mapPackage: makeMapPackage(),
      emitFrame: (frame) => {
        frames.push(frame);
      },
    });

    const executable = await Effect.runPromise(loader.loadExecutable(bundledPlugin.id));
    const plugin = 'id' in executable ? executable : executable.default;
    if (!plugin?.onInit || !plugin.onTick) {
      throw new Error('bundled plugin did not expose runtime hooks');
    }

    await Effect.runPromise(plugin.onInit({ pluginId: plugin.id }));
    await Effect.runPromise(plugin.onTick({} as never, 1 / 20, 1));

    const welcome = frames
      .map((frame) => BattleRoyaleProtocol.decodeServerMessage(frame))
      .find((message) => message._tag === 'WelcomeSnapshot');

    expect(welcome?._tag).toBe('WelcomeSnapshot');
    if (welcome?._tag === 'WelcomeSnapshot') {
      expect(welcome.players[0]?.x).toBe(320);
      expect(welcome.players[0]?.y).toBe(640);
      expect(
        welcome.objects?.some(
          (object) => object.x === 384 && object.y === 576 && object.lootSource !== undefined,
        ),
      ).toBe(true);
    }
  });

  it('preserves entity allocation high-water across bundled world checkpoints', async () => {
    const checkpoints: JsonValue[] = [];
    const pluginId = '@tileborne-plugins/checkpoint-probe';
    const registration = {
      id: pluginId,
      protocolBridge: createDefaultBundledPluginProtocolBridge(),
      createRuntimeAdapter: (host: {
        readonly getPluginCheckpoint?: (pluginId: string) => JsonValue | undefined;
        readonly setPluginCheckpoint?: (
          pluginId: string,
          checkpoint: JsonValue | undefined,
        ) => void;
      }) => ({
        id: pluginId,
        onInit: (
          _ctx: unknown,
          world: {
            readonly createEntity: () => number;
            readonly destroyEntity: (entity: number) => void;
            readonly createCheckpoint: () => { readonly nextEntity: number };
            readonly restoreCheckpoint: (checkpoint: { readonly nextEntity: number }) => void;
          },
        ) => {
          const checkpoint = host.getPluginCheckpoint?.(pluginId) as
            | { readonly world?: { readonly nextEntity: number } }
            | undefined;
          if (checkpoint?.world !== undefined) {
            world.restoreCheckpoint(checkpoint.world);
            return;
          }
          world.createEntity();
          const high = world.createEntity();
          world.destroyEntity(high);
          host.setPluginCheckpoint?.(pluginId, { world: world.createCheckpoint() });
        },
        onTick: (
          world: {
            readonly createEntity: () => number;
          },
          _dt: number,
          tick: number,
        ) => {
          host.setPluginCheckpoint?.(pluginId, { tick, created: world.createEntity() });
        },
      }),
    };
    const firstLoader = createBundledPluginLoader({
      pluginRegistrations: [registration],
      setPluginCheckpoint: (_pluginId, checkpoint) => {
        if (checkpoint !== undefined) {
          checkpoints.push(checkpoint);
        }
      },
    });
    const firstExecutable = await Effect.runPromise(firstLoader.loadExecutable(pluginId));
    const firstPlugin = 'id' in firstExecutable ? firstExecutable : firstExecutable.default;
    await Effect.runPromise(firstPlugin.onInit!({ pluginId }));
    const allocatorCheckpoint = checkpoints.at(-1)!;

    const restoredCheckpoints: JsonValue[] = [];
    const restoredLoader = createBundledPluginLoader({
      pluginRegistrations: [registration],
      getPluginCheckpoint: (id) => (id === pluginId ? allocatorCheckpoint : undefined),
      setPluginCheckpoint: (_pluginId, checkpoint) => {
        if (checkpoint !== undefined) {
          restoredCheckpoints.push(checkpoint);
        }
      },
    });
    const restoredExecutable = await Effect.runPromise(restoredLoader.loadExecutable(pluginId));
    const restoredPlugin =
      'id' in restoredExecutable ? restoredExecutable : restoredExecutable.default;
    await Effect.runPromise(restoredPlugin.onInit!({ pluginId }));
    await Effect.runPromise(restoredPlugin.onTick!({} as never, 1 / 20, 1));

    expect(restoredCheckpoints.at(-1)).toEqual({ tick: 1, created: 3 });
  });
});
