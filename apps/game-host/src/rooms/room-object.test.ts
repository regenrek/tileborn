import { Effect, Option } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BattleRoyaleProtocol } from '@tileborne/ipc-contracts';
import { hashBytes, type BehaviorId } from '@tileborne/core';
import {
  buildRuntimeGameShellProjection,
  decodeMessage,
  defaultProjectGameShellState,
  makePluginHost,
  ServerNotice,
  type RuntimeBehaviorContext,
} from '@tileborne/runtime';
import type { PluginHostApi, RuntimeMessage, RuntimePlugin } from '@tileborne/runtime';
import { AuthoritativeBehaviorRuntimeHost } from '@tileborne/runtime/behavior';

import { ARENA_PLUGIN_ID } from '../../../../packages/plugin-example-arena/src/constants.js';
import {
  decodeHostClientFrame as decodeArenaHostClientFrame,
  encodeHostTransportErrorFrame as encodeArenaTransportErrorFrame,
  encodeInvalidClientFrame as encodeInvalidArenaClientFrame,
  snapshotTickFromHostServerFrame as snapshotTickFromArenaServerFrame,
} from '../../../../packages/plugin-example-arena/src/host-protocol-bridge.js';
import { createRuntimeAdapter as createArenaRuntimeAdapter } from '../../../../packages/plugin-example-arena/src/runtime-adapter.js';
import type { ArenaRuntimeInput } from '../../../../packages/plugin-example-arena/src/types/runtime-plugin.js';
import {
  ArenaPlayerInput,
  ArenaSnapshotAck,
  decodeArenaServerMessage,
  encodeArenaClientMessage,
} from '../../../../packages/plugin-example-arena/src/wire-codec.js';
import { bundledMapPackages } from '../.generated/bundled-map-packages.js';
import {
  initialMenuState,
  menuReducer,
} from '../../../../packages/game-client/src/state/menu-machine.js';
import { menuEventForShellNavigationRequest } from '../../../../packages/game-client/src/shell-behavior-bridge.js';
import { mintHandoffToken } from './handoff-token.js';
import { MAX_QUEUED_INPUTS_PER_PLAYER, PlaytestRoom } from './room-object.js';
import type { BundledPluginRuntimeRegistration } from '../bundled-plugin-loader.js';
import { STORAGE_KEY, type RoomStorage } from './storage-schema.js';
import {
  PERSIST_EVERY_N_TICKS,
  ROOM_BACKPRESSURE_CLOSE_CODE,
  ROOM_INVALID_ACK_CLOSE_CODE,
  ROOM_REPLACED_CLOSE_CODE,
  ROOM_SCHEMA_VERSION,
} from './room-config.js';
import {
  MAX_OUTBOUND_BUFFERED_BYTES,
  MAX_UNACKED_SNAPSHOT_TICKS_BEFORE_DROP,
  MAX_UNACKED_SNAPSHOT_TICKS_BEFORE_RESYNC,
  decodeRoomShellServerFrame,
  encodeRoomShellEventClientFrame,
} from './room-transport.js';
import {
  createFakeDurableObjectState,
  installWorkerGlobals,
  registerAlarmHandler,
  asDurableObjectState,
  MemoryWebSocket,
  type FakeDurableObjectState,
} from '../test-helpers/do-fake.js';
import type { Env, PlaytestSummary, RoomLobbySummary } from '../types.js';

const TEST_KEY = 'test-handoff-signing-key-32-bytes!!';

/** Valid encoded `RuntimeMapPackage` wire JSON (rooms validate at /create). */
const cloneDefaultMapPackage = (): Record<string, unknown> =>
  JSON.parse(JSON.stringify(bundledMapPackages[0]!.mapPackage)) as Record<string, unknown>;

const mapPackageWithCapacity = (playerCapacity: number): Record<string, unknown> => {
  const pkg = cloneDefaultMapPackage();
  (pkg.manifest as Record<string, unknown>).playerCapacity = playerCapacity;
  return pkg;
};

const makeEnv = (overrides: Partial<Env> = {}): Env => ({
  PLAYTEST_ROOM: {
    idFromName: (name: string) => ({ toString: () => name }) as DurableObjectId,
    get: () => ({ fetch: async () => new Response('unused') }),
  },
  HANDOFF_SIGNING_KEY: TEST_KEY,
  ROOM_IDLE_TIMEOUT_SECONDS: 1,
  ...overrides,
});

const initRoom = async (
  state: FakeDurableObjectState,
  env: Env,
  deps?: ConstructorParameters<typeof PlaytestRoom>[2],
  options?: Record<string, string | number | boolean | null>,
  mapPackage?: Record<string, unknown>,
): Promise<PlaytestRoom> => {
  installWorkerGlobals();
  const room = new PlaytestRoom(asDurableObjectState(state), env, deps);
  registerAlarmHandler(state, () => room.alarm());
  await room.fetch(
    new Request('https://do/create?roomId=room-1', {
      method: 'POST',
      body: JSON.stringify({
        mapId: 'map:fixture',
        seed: 42,
        ...(options === undefined ? {} : { options }),
        ...(mapPackage === undefined ? {} : { mapPackage }),
      }),
    }),
  );
  return room;
};

const connectPlayer = async (
  room: PlaytestRoom,
  state: FakeDurableObjectState,
  playtestId: string,
  playerId: string,
): Promise<MemoryWebSocket> => {
  const token = await mintHandoffToken(
    { HANDOFF_SIGNING_KEY: TEST_KEY },
    {
      playtestId,
      playerId,
      ttlSeconds: 120,
    },
  );
  await room.fetch(
    new Request(
      `https://do/connect?playtestId=${encodeURIComponent(playtestId)}&playerId=${encodeURIComponent(playerId)}&token=${encodeURIComponent(token)}`,
      { headers: { Upgrade: 'websocket' } },
    ),
  );
  return state.sockets[state.sockets.length - 1] as MemoryWebSocket;
};

const connectPlayerViaFetch = connectPlayer;

const readyPlayer = async (room: PlaytestRoom, playerId: string, ready = true): Promise<Response> =>
  room.fetch(
    new Request('https://do/lobby/ready?roomId=room-1', {
      method: 'POST',
      body: JSON.stringify({ playerId, ready }),
    }),
  );

const decodeBattleRoyaleMessages = (
  server: MemoryWebSocket,
): BattleRoyaleProtocol.ServerToClientMessage[] =>
  server.sent.flatMap((frame) => {
    try {
      return [BattleRoyaleProtocol.decodeServerMessage(new Uint8Array(frame))];
    } catch {
      return [];
    }
  });

const decodeLegacyMessages = (server: MemoryWebSocket): RuntimeMessage[] =>
  server.sent.flatMap((frame) => {
    try {
      return [decodeMessage(new Uint8Array(frame))];
    } catch {
      return [];
    }
  });

const decodeRoomShellNavigationMessages = (server: MemoryWebSocket) =>
  server.sent.flatMap((frame) => {
    const decoded = decodeRoomShellServerFrame(new TextDecoder().decode(frame));
    return decoded === undefined ? [] : [decoded];
  });

const encodeBrInputFrame = (input: {
  readonly tick: number;
  readonly seq: number;
  readonly dir?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  readonly shoot?: boolean;
  readonly reload?: boolean;
  readonly interact?: boolean;
  readonly drop?: boolean;
  readonly abilities?: readonly BattleRoyaleProtocol.BattleRoyaleAbilityId[];
  readonly aimDeg?: number;
  readonly swapSlot?: number;
}): ArrayBuffer => {
  const bytes = BattleRoyaleProtocol.encodeClientMessage(
    new BattleRoyaleProtocol.PlayerInput({
      tick: input.tick,
      seq: input.seq,
      dir: input.dir === undefined ? Option.none() : Option.some(input.dir),
      shoot: input.shoot ?? false,
      reload: input.reload ?? false,
      interact: input.interact ?? false,
      drop: input.drop ?? false,
      abilities: [...(input.abilities ?? [])],
      aimDeg: input.aimDeg === undefined ? Option.none() : Option.some(input.aimDeg),
      swapSlot: input.swapSlot === undefined ? Option.none() : Option.some(input.swapSlot),
    }),
  );
  const frame = new Uint8Array(bytes.byteLength);
  frame.set(bytes);
  return frame.buffer;
};

const encodeBrHeartbeatFrame = (tick: number): ArrayBuffer => {
  const bytes = BattleRoyaleProtocol.encodeClientMessage(
    new BattleRoyaleProtocol.Heartbeat({ tick }),
  );
  const frame = new Uint8Array(bytes.byteLength);
  frame.set(bytes);
  return frame.buffer;
};

const encodeBrSnapshotAckFrame = (tick: number, receivedAtMs = 1_000): ArrayBuffer => {
  const bytes = BattleRoyaleProtocol.encodeClientMessage(
    new BattleRoyaleProtocol.SnapshotAck({ tick, receivedAtMs }),
  );
  const frame = new Uint8Array(bytes.byteLength);
  frame.set(bytes);
  return frame.buffer;
};

const encodeArenaInputFrame = (input: {
  readonly tick: number;
  readonly seq: number;
  readonly dir?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  readonly shoot?: boolean;
  readonly aimDeg?: number;
}): ArrayBuffer => {
  const bytes = encodeArenaClientMessage(
    new ArenaPlayerInput({
      tick: input.tick,
      seq: input.seq,
      dir: input.dir === undefined ? Option.none() : Option.some(input.dir),
      shoot: input.shoot ?? false,
      aimDeg: input.aimDeg === undefined ? Option.none() : Option.some(input.aimDeg),
    }),
  );
  const frame = new Uint8Array(bytes.byteLength);
  frame.set(bytes);
  return frame.buffer;
};

const encodeArenaSnapshotAckFrame = (tick: number, receivedAtMs = 0): ArrayBuffer => {
  const bytes = encodeArenaClientMessage(new ArenaSnapshotAck({ tick, receivedAtMs }));
  const frame = new Uint8Array(bytes.byteLength);
  frame.set(bytes);
  return frame.buffer;
};

const queuedInputCount = (room: PlaytestRoom): number =>
  (room as unknown as { readonly inputQueueByPlayerId: { readonly size: number } })
    .inputQueueByPlayerId.size;

const emitPluginFrameForTest = (room: PlaytestRoom, frame: Uint8Array): void => {
  (
    room as unknown as {
      readonly emitPluginFrame: (value: Uint8Array) => void;
    }
  ).emitPluginFrame(frame);
};

const arenaRuntimeRegistration = (): BundledPluginRuntimeRegistration => ({
  id: ARENA_PLUGIN_ID,
  protocolBridge: {
    decodeClientFrame: decodeArenaHostClientFrame,
    decodeSnapshotAckFrame: (bytes) => {
      const decoded = decodeArenaHostClientFrame(bytes);
      return decoded.kind === 'accepted' && decoded.frame.kind === 'ack'
        ? { tick: decoded.frame.tick, receivedAtMs: decoded.frame.receivedAtMs }
        : undefined;
    },
    decodeServerLifecycleFrame: () => undefined,
    snapshotTickFromServerFrame: snapshotTickFromArenaServerFrame,
    encodeTransportErrorFrame: encodeArenaTransportErrorFrame,
    encodeInvalidClientFrame: encodeInvalidArenaClientFrame,
  },
  createRuntimeAdapter: (host) =>
    createArenaRuntimeAdapter({
      getMapPackage: host.getMapPackage,
      getPlayerInput: (playerId) => {
        const input = host.getPlayerInput?.(playerId);
        return input === undefined || !isArenaRuntimeInput(input) ? undefined : input;
      },
      msgOut: host.msgOut,
      setReplayFrames: host.setReplayFrames,
      seed: host.seed,
    }),
});

const isArenaRuntimeInput = (value: object): value is ArenaRuntimeInput => {
  const input = value as Partial<ArenaRuntimeInput>;
  return (
    Number.isSafeInteger(input.tick) &&
    Number.isSafeInteger(input.seq) &&
    (input.dir === undefined ||
      input.dir === 0 ||
      input.dir === 1 ||
      input.dir === 2 ||
      input.dir === 3 ||
      input.dir === 4 ||
      input.dir === 5 ||
      input.dir === 6 ||
      input.dir === 7) &&
    typeof input.shoot === 'boolean' &&
    (input.aimDeg === undefined || typeof input.aimDeg === 'number')
  );
};

const arenaMapPackage = (): Record<string, unknown> => ({
  manifest: {
    schemaVersion: 1,
    packageId: 'mappkg:arena-room-fixture',
    pluginId: ARENA_PLUGIN_ID,
    playerCapacity: 2,
  },
});

describe('PlaytestRoom lifecycle', () => {
  let state: FakeDurableObjectState;
  let env: Env;
  let room: PlaytestRoom;

  beforeEach(async () => {
    state = createFakeDurableObjectState();
    env = makeEnv();
    room = await initRoom(state, env);
  });

  it('creates room storage in lobby phase', async () => {
    const stored = await state.storage.get<RoomStorage>(STORAGE_KEY);
    expect(stored?.lifecycle.phase).toBe('lobby');
    expect('status' in (stored ?? {})).toBe(false);
    expect(stored?.mapId).toBe('map:fixture');
  });

  it('stores mapPackage and playerModelSelections as room state instead of scalar options', async () => {
    const packageState = createFakeDurableObjectState();
    const mapPackage = cloneDefaultMapPackage();
    const playerModelSelections = [{ playerId: 'player-1', modelId: 'model:test' }];
    const packageRoom = new PlaytestRoom(asDurableObjectState(packageState), makeEnv(), {
      createPluginHost: () => makePluginHost(),
    });

    const created = await packageRoom.fetch(
      new Request('https://do/create?roomId=room-package', {
        method: 'POST',
        body: JSON.stringify({
          mapId: 'map:package',
          seed: 42,
          mapPackage,
          playerModelSelections,
          options: { maxPlayers: 8 },
        }),
      }),
    );
    expect(created.status).toBe(200);

    const stored = await packageState.storage.get<RoomStorage>(STORAGE_KEY);
    // The ORIGINAL wire JSON is stored after validation — never a re-encode.
    expect(stored?.mapPackage).toEqual(mapPackage);
    expect(stored?.playerModelSelections).toEqual(playerModelSelections);
    expect(stored?.options).toEqual({ maxPlayers: 8 });
  });

  it('rejects a malformed mapPackage at /create with a structured 400 (M2 review, F1)', async () => {
    const packageState = createFakeDurableObjectState();
    const packageRoom = new PlaytestRoom(asDurableObjectState(packageState), makeEnv(), {
      createPluginHost: () => makePluginHost(),
    });

    const response = await packageRoom.fetch(
      new Request('https://do/create?roomId=room-bad-package', {
        method: 'POST',
        body: JSON.stringify({
          mapId: 'map:package',
          mapPackage: { manifest: { schemaVersion: 1 } },
        }),
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { readonly error: string };
    expect(body.error).toContain('mapPackage is not a valid RuntimeMapPackage');
    expect(await packageState.storage.get(STORAGE_KEY)).toBeUndefined();
  });

  it('keeps the packageless dev-room path working (omitted mapPackage)', async () => {
    const devState = createFakeDurableObjectState();
    const devRoom = new PlaytestRoom(asDurableObjectState(devState), makeEnv(), {
      createPluginHost: () => makePluginHost(),
    });
    const response = await devRoom.fetch(
      new Request('https://do/create?roomId=room-dev', {
        method: 'POST',
        body: JSON.stringify({ mapId: 'map:dev' }),
      }),
    );
    expect(response.status).toBe(200);
    const stored = await devState.storage.get<RoomStorage>(STORAGE_KEY);
    expect(stored?.mapPackage).toBeUndefined();
  });

  it('keeps one ready player pending until all required players ready up', async () => {
    await connectPlayer(room, state, 'room-1', 'player-a');
    await connectPlayer(room, state, 'room-1', 'player-b');
    const firstReady = await readyPlayer(room, 'player-a');
    expect(firstReady.status).toBe(200);
    let stored = await state.storage.get<RoomStorage>(STORAGE_KEY);
    expect(stored?.lifecycle.phase).toBe('lobby');
    expect(stored?.ready.players['player-a']?.isReady).toBe(true);

    const secondReady = await readyPlayer(room, 'player-b');
    expect(secondReady.status).toBe(200);
    stored = await state.storage.get<RoomStorage>(STORAGE_KEY);
    expect(stored?.lifecycle.phase).toBe('countdown');

    await room.alarm();
    stored = await state.storage.get<RoomStorage>(STORAGE_KEY);
    expect(stored?.lifecycle.phase).toBe('active');
    expect(stored?.tick).toBeGreaterThan(0);
  });

  it('advances packaged behaviors in the authoritative room tick path', async () => {
    const behaviorId = 'behavior:99999999-9999-4999-8999-999999999999' as BehaviorId;
    const code = `export default {id:'test.room-tick',sourceKind:'typescript',state:{ticks:0}};`;
    const behaviorHost = new AuthoritativeBehaviorRuntimeHost();
    expect(
      behaviorHost.load({
        artifact: {
          behaviorId,
          sourceKind: 'typescript',
          modulePath: 'behaviors/modules/room-tick.mjs',
          hash: hashBytes(new TextEncoder().encode(code)),
        },
        code,
        namespace: {
          default: {
            id: 'test.room-tick',
            sourceKind: 'typescript',
            state: { ticks: 0 },
            on: {
              'runtime.tick': (context: {
                readonly event: Readonly<Record<string, unknown>>;
                readonly state: { set(key: string, value: number): unknown };
              }) => context.state.set('ticks', context.event.tick as number),
            },
          },
        },
      }),
    ).toBe(true);
    const behaviorState = createFakeDurableObjectState();
    const behaviorRoom = await initRoom(behaviorState, makeEnv(), {
      createBehaviorRuntime: () => behaviorHost,
    });
    await connectPlayer(behaviorRoom, behaviorState, 'room-1', 'player-a');
    await connectPlayer(behaviorRoom, behaviorState, 'room-1', 'player-b');
    await readyPlayer(behaviorRoom, 'player-a');
    await readyPlayer(behaviorRoom, 'player-b');
    await behaviorRoom.alarm();

    expect(behaviorHost.snapshot.states).toContainEqual({
      behaviorId,
      state: { ticks: 1 },
    });
  });

  it('routes browser shell events through room and Workerd behavior runtime back into the client reducer', async () => {
    const behaviorId = 'behavior:11111111-1111-4111-8111-111111111111' as BehaviorId;
    const packageId = 'mappkg:550e8400-e29b-41d4-a716-446655440999';
    const code = `export default {id:'test.shell-e2e',sourceKind:'typescript'};`;
    const artifact = {
      behaviorId,
      sourceKind: 'typescript' as const,
      modulePath: 'behaviors/modules/shell-e2e.mjs',
      hash: hashBytes(new TextEncoder().encode(code)),
    };
    const mapPackage = cloneDefaultMapPackage();
    (mapPackage.manifest as Record<string, unknown>).packageId = packageId;
    mapPackage.behaviors = {
      schemaVersion: 1,
      manifests: [],
      visualDefinitions: [],
      modules: [artifact],
    };
    const shellProjection = buildRuntimeGameShellProjection(
      defaultProjectGameShellState('tileborne.battle-royale'),
    );
    const binding = {
      fetch: async (request: Request): Promise<Response> => {
        const input = (await request.json()) as {
          readonly packageId: string;
          readonly snapshot?: Parameters<AuthoritativeBehaviorRuntimeHost['restore']>[0];
          readonly shell?: {
            readonly projection?: typeof shellProjection;
            readonly events?: readonly Parameters<
              AuthoritativeBehaviorRuntimeHost['dispatch']
            >[1][];
          };
          readonly operation: {
            readonly tick: number;
            readonly targetBehaviorId: BehaviorId;
          };
        };
        expect(input.packageId).toBe(packageId);
        const host = new AuthoritativeBehaviorRuntimeHost({
          shell: { projection: input.shell!.projection! },
          capabilities: ['shell.navigation'],
        });
        expect(
          host.load({
            artifact,
            code,
            namespace: {
              default: {
                id: 'test.shell-e2e',
                sourceKind: 'typescript',
                state: { last: '' },
                requiredCapabilities: ['shell.navigation'],
                on: {
                  'shell.event': ({ event, state }: RuntimeBehaviorContext) =>
                    state.set('last', String(event.event)),
                  'runtime.tick': ({ state, actions }: RuntimeBehaviorContext) => {
                    if (state.get('last') === 'shell.menu.entered') {
                      return actions['shell.invoke-action']({ actionId: 'menu.settings' });
                    }
                    return undefined;
                  },
                },
              },
            },
          }),
        ).toBe(true);
        if (input.snapshot !== undefined) {
          expect(host.restore(input.snapshot)).toBe(true);
        }
        const shellTraces = [];
        for (const event of input.shell?.events ?? []) {
          shellTraces.push(
            ...(await host.dispatch('shell.event', event, input.operation.targetBehaviorId)),
          );
        }
        const timerTraces = await host.advanceTo(input.operation.tick);
        const tickTraces = await host.dispatch(
          'runtime.tick',
          { tick: input.operation.tick },
          input.operation.targetBehaviorId,
        );
        return Response.json({
          ok: true,
          snapshot: host.snapshot,
          traces: [...shellTraces, ...timerTraces, ...tickTraces],
          diagnostics: host.diagnostics,
          shellNavigationRequests: host.shellNavigationRequests,
        });
      },
    };
    const shellState = createFakeDurableObjectState();
    installWorkerGlobals();
    const shellRoom = new PlaytestRoom(
      asDurableObjectState(shellState),
      makeEnv({ BEHAVIOR_RUNTIME: binding }),
      { createPluginHost: () => makePluginHost() },
    );
    registerAlarmHandler(shellState, () => shellRoom.alarm());
    await shellRoom.create({
      mapId: 'map:fixture',
      seed: 42,
      options: { countdownSeconds: 0, minReadyPlayers: 1 },
      mapPackage,
      shellProjection,
    });
    const token = await mintHandoffToken(
      { HANDOFF_SIGNING_KEY: TEST_KEY },
      { playtestId: 'room-1', playerId: 'player-1', ttlSeconds: 120 },
    );
    await shellRoom.addPlayer('player-1', token, 'room-1', { broadcast: false });
    const server = new MemoryWebSocket();
    (
      shellRoom as unknown as {
        readonly acceptPlayerSocket: (playerId: string, server: WebSocket) => void;
      }
    ).acceptPlayerSocket('player-1', server as unknown as WebSocket);
    expect((await readyPlayer(shellRoom, 'player-1')).status).toBe(200);
    await shellRoom.alarm();

    await shellRoom.webSocketMessage(
      server as unknown as WebSocket,
      encodeRoomShellEventClientFrame({ event: 'shell.menu.entered', screenId: 'main-menu' }),
    );
    await shellRoom.alarm();

    const [navigation] = decodeRoomShellNavigationMessages(server);
    expect(navigation?.request).toEqual({ type: 'navigate', targetScreenId: 'settings' });
    const menuState = { ...initialMenuState, phase: 'menu' as const, screen: 'main' as const };
    const menuEvent =
      navigation === undefined
        ? undefined
        : menuEventForShellNavigationRequest(menuState, navigation.request);
    expect(menuEvent).toEqual({ type: 'OPEN_SETTINGS' });
    expect(menuEvent === undefined ? menuState : menuReducer(menuState, menuEvent)).toMatchObject({
      phase: 'menu',
      screen: 'settings',
    });
  });

  it('persists shell navigation sequence across Durable Object recreation', async () => {
    const shellState = createFakeDurableObjectState();
    installWorkerGlobals();
    const behaviorRuntime = {
      snapshot: undefined,
      diagnostics: [],
      shellNavigationRequests: [{ type: 'navigate' as const, targetScreenId: 'settings' }],
      emitShellEvent: vi.fn(),
      step: vi.fn(async () => ({ status: 'advanced' })),
    };
    const createRoom = () =>
      new PlaytestRoom(asDurableObjectState(shellState), makeEnv(), {
        createPluginHost: () => makePluginHost(),
        createBehaviorRuntime: () => behaviorRuntime,
      });
    const room = createRoom();
    await room.create({
      mapId: 'map:fixture',
      seed: 42,
      options: { countdownSeconds: 0, minReadyPlayers: 1 },
    });
    const token = await mintHandoffToken(
      { HANDOFF_SIGNING_KEY: TEST_KEY },
      { playtestId: 'room-1', playerId: 'player-a', ttlSeconds: 120 },
    );
    await room.addPlayer('player-a', token, 'room-1', { broadcast: false });
    const firstServer = new MemoryWebSocket();
    (
      room as unknown as {
        readonly acceptPlayerSocket: (playerId: string, server: WebSocket) => void;
      }
    ).acceptPlayerSocket('player-a', firstServer as unknown as WebSocket);
    expect((await readyPlayer(room, 'player-a')).status).toBe(200);
    await room.alarm();
    const [firstNavigation] = decodeRoomShellNavigationMessages(firstServer);
    expect(firstNavigation).toMatchObject({ sequence: 0 });

    const recreated = createRoom();
    const secondServer = new MemoryWebSocket();
    (
      recreated as unknown as {
        readonly acceptPlayerSocket: (playerId: string, server: WebSocket) => void;
      }
    ).acceptPlayerSocket('player-a', secondServer as unknown as WebSocket);
    await recreated.alarm();
    const [secondNavigation] = decodeRoomShellNavigationMessages(secondServer);

    expect(secondNavigation?.epoch).toBe(firstNavigation?.epoch);
    expect(secondNavigation).toMatchObject({ sequence: 1 });
  });

  it('keeps countdown pending until configured countdownSeconds elapses', async () => {
    const countdownState = createFakeDurableObjectState();
    let nowMs = Date.now();
    const countdownRoom = await initRoom(
      countdownState,
      makeEnv(),
      { now: () => nowMs },
      { countdownSeconds: 2, minReadyPlayers: 1 },
    );
    await connectPlayer(countdownRoom, countdownState, 'room-1', 'player-a');
    const readyResponse = await readyPlayer(countdownRoom, 'player-a');
    expect(readyResponse.status).toBe(200);
    await countdownRoom.alarm();

    let stored = await countdownState.storage.get<RoomStorage>(STORAGE_KEY);
    expect(stored?.lifecycle.phase).toBe('countdown');
    expect(stored?.tick).toBe(0);

    nowMs += 2_000;
    await countdownRoom.alarm();

    stored = await countdownState.storage.get<RoomStorage>(STORAGE_KEY);
    expect(stored?.lifecycle.phase).toBe('active');
    expect(stored?.tick).toBeGreaterThan(0);
  });

  it('adds a player without injecting legacy PlayerJoined on BR sockets', async () => {
    const server = await connectPlayer(room, state, 'room-1', 'player-a');
    const joined = decodeLegacyMessages(server).find((message) => message._tag === 'PlayerJoined');
    expect(joined).toBeUndefined();
  });

  it('fans out BR DeltaSnapshot on simulation ticks', async () => {
    await connectPlayer(room, state, 'room-1', 'player-a');
    await connectPlayer(room, state, 'room-1', 'player-b');
    expect((await readyPlayer(room, 'player-a')).status).toBe(200);
    expect((await readyPlayer(room, 'player-b')).status).toBe(200);
    await room.alarm();
    const server = state.sockets[0] as MemoryWebSocket;
    const delta = decodeBattleRoyaleMessages(server).find(
      (message) => message._tag === 'DeltaSnapshot',
    );
    expect(delta?._tag).toBe('DeltaSnapshot');
    if (delta?._tag === 'DeltaSnapshot') {
      expect(delta.tick).toBeGreaterThan(0);
    }
  });

  it('removePlayer does not inject legacy PlayerLeft on BR sockets', async () => {
    await connectPlayer(room, state, 'room-1', 'player-a');
    await room.removePlayer('player-a', 'test');
    const stored = await state.storage.get<RoomStorage>(STORAGE_KEY);
    expect(stored?.players['player-a']).toBeUndefined();
    const server = state.sockets[0] as MemoryWebSocket;
    const left = decodeLegacyMessages(server).find((message) => message._tag === 'PlayerLeft');
    expect(left).toBeUndefined();
  });

  it('destroy archives the room', async () => {
    await room.destroy();
    const stored = await state.storage.get<RoomStorage>(STORAGE_KEY);
    expect(stored?.lifecycle.phase).toBe('archived');
  });

  it('rejects admission over configured capacity', async () => {
    const cappedState = createFakeDurableObjectState();
    const cappedRoom = await initRoom(cappedState, makeEnv(), undefined, { maxPlayers: 1 });
    await connectPlayer(cappedRoom, cappedState, 'room-1', 'player-a');

    const token = await mintHandoffToken(
      { HANDOFF_SIGNING_KEY: TEST_KEY },
      {
        playtestId: 'room-1',
        playerId: 'player-b',
        ttlSeconds: 120,
      },
    );

    await expect(cappedRoom.addPlayer('player-b', token, 'room-1')).rejects.toThrow(
      /room capacity reached/,
    );
    const stored = await cappedState.storage.get<RoomStorage>(STORAGE_KEY);
    expect(stored?.players['player-b']).toBeUndefined();
  });

  it('reserves generated player slots before websocket handoff', async () => {
    const first = await room.fetch(
      new Request('https://do/players/reserve', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    );
    const firstBody = (await first.json()) as { readonly playerId: string };
    expect(first.status).toBe(200);
    expect(firstBody.playerId).toBe('player-1');

    const second = await room.fetch(
      new Request('https://do/players/reserve', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    );
    const secondBody = (await second.json()) as { readonly playerId: string };
    expect(second.status).toBe(200);
    expect(secondBody.playerId).toBe('player-2');

    const stored = await state.storage.get<RoomStorage>(STORAGE_KEY);
    expect(Object.keys(stored?.players ?? {})).toEqual(['player-1', 'player-2']);
  });

  it('configures lobby metadata and exposes ready/presence summary from room storage', async () => {
    const configured = await room.fetch(
      new Request('https://do/lobby/configure?roomId=room-1', {
        method: 'POST',
        body: JSON.stringify({
          joinCode: 'ABC2D3',
          visibility: 'public',
          displayName: 'Friday lobby',
        }),
      }),
    );
    expect(configured.status).toBe(200);

    const reserved = await room.fetch(
      new Request('https://do/players/reserve', {
        method: 'POST',
        body: JSON.stringify({ displayName: 'Ada' }),
      }),
    );
    expect(reserved.status).toBe(200);

    const response = await room.fetch(new Request('https://do/lobby/summary?roomId=room-1'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { readonly lobby: RoomLobbySummary };
    expect(body.lobby).toMatchObject({
      roomId: 'room-1',
      mapId: 'map:fixture',
      phase: 'lobby',
      playerCount: 1,
      maxPlayers: 32,
      minReadyPlayers: 2,
      canStart: false,
      lobby: {
        visibility: 'public',
        joinCode: 'ABC2D3',
        title: 'Friday lobby',
      },
    });
    expect(body.lobby.players[0]).toMatchObject({
      playerId: 'player-1',
      displayName: 'Ada',
      status: 'connected',
      ready: false,
      reconnectEligible: true,
    });
  });

  it('runs an Arena package through the real room owner lifecycle, reconnect, diagnostics, metrics, and results path', async () => {
    installWorkerGlobals();
    const arenaState = createFakeDurableObjectState();
    const arenaRoom = new PlaytestRoom(asDurableObjectState(arenaState), makeEnv(), {
      pluginRegistrations: [arenaRuntimeRegistration()],
    });
    registerAlarmHandler(arenaState, () => arenaRoom.alarm());
    await arenaRoom.create({
      mapId: 'map:arena-room-fixture',
      seed: 7,
      options: { minReadyPlayers: 2 },
      mapPackage: arenaMapPackage(),
    });

    const ownerReservation = await arenaRoom.fetch(
      new Request('https://do/players/reserve', {
        method: 'POST',
        body: JSON.stringify({ displayName: 'Owner' }),
      }),
    );
    expect(ownerReservation.status).toBe(200);
    const owner = (await ownerReservation.json()) as { readonly playerId: string };
    const configured = await arenaRoom.fetch(
      new Request('https://do/lobby/configure?roomId=arena-room', {
        method: 'POST',
        body: JSON.stringify({ joinCode: 'ABC2D3', createdByPlayerId: owner.playerId }),
      }),
    );
    expect(configured.status).toBe(200);
    const participantReservation = await arenaRoom.fetch(
      new Request('https://do/players/reserve', {
        method: 'POST',
        body: JSON.stringify({ displayName: 'Participant' }),
      }),
    );
    expect(participantReservation.status).toBe(200);
    const participant = (await participantReservation.json()) as { readonly playerId: string };

    const ownerSocket = await connectPlayer(arenaRoom, arenaState, 'arena-room', owner.playerId);
    const participantSocket = await connectPlayer(
      arenaRoom,
      arenaState,
      'arena-room',
      participant.playerId,
    );
    expect((await readyPlayer(arenaRoom, owner.playerId)).status).toBe(200);
    expect((await readyPlayer(arenaRoom, participant.playerId)).status).toBe(200);

    const participantStart = await arenaRoom.fetch(
      new Request('https://do/lobby/start?roomId=arena-room', {
        method: 'POST',
        body: JSON.stringify({ playerId: participant.playerId }),
      }),
    );
    expect(participantStart.status).toBe(403);

    const ownerStart = await arenaRoom.fetch(
      new Request('https://do/lobby/start?roomId=arena-room', {
        method: 'POST',
        body: JSON.stringify({ playerId: owner.playerId }),
      }),
    );
    expect(ownerStart.status).toBe(200);
    const startBody = (await ownerStart.json()) as { readonly lobby: RoomLobbySummary };
    expect(startBody.lobby.phase).toBe('active');
    expect(startBody.lobby.players.map((player) => [player.playerId, player.role])).toEqual([
      [owner.playerId, 'owner'],
      [participant.playerId, 'participant'],
    ]);

    await arenaRoom.alarm();
    await arenaRoom.webSocketMessage(
      ownerSocket as unknown as WebSocket,
      encodeArenaInputFrame({ tick: 1, seq: 1, shoot: true, aimDeg: 0 }),
    );
    expect(queuedInputCount(arenaRoom)).toBe(1);
    await arenaRoom.alarm();
    const arenaSnapshot = ownerSocket.sent
      .map((frame) => {
        try {
          return decodeArenaServerMessage(new Uint8Array(frame));
        } catch {
          return undefined;
        }
      })
      .find((message) => message?._tag === 'ArenaSnapshot');
    expect(arenaSnapshot?._tag).toBe('ArenaSnapshot');
    const arenaInputSnapshot = ownerSocket.sent
      .map((frame) => {
        try {
          return decodeArenaServerMessage(new Uint8Array(frame));
        } catch {
          return undefined;
        }
      })
      .filter((message) => message?._tag === 'ArenaSnapshot')
      .at(-1);
    expect(
      arenaInputSnapshot?._tag === 'ArenaSnapshot'
        ? arenaInputSnapshot.entities.find((entity) => entity.id === 'player-1')?.attacking
        : undefined,
    ).toBe(true);
    const arenaInputTick =
      arenaInputSnapshot?._tag === 'ArenaSnapshot' ? arenaInputSnapshot.tick : -1;
    expect(arenaRoom.getClientTransportStats(owner.playerId)).toMatchObject({
      lastSentSnapshotTick: arenaInputTick,
      lastAckedSnapshotTick: -1,
      pendingSnapshotLagTicks: arenaInputTick + 1,
      droppedOutboundFrames: 0,
      resyncCount: 0,
    });

    await arenaRoom.webSocketMessage(
      ownerSocket as unknown as WebSocket,
      encodeArenaSnapshotAckFrame(arenaInputTick, 5678),
    );
    expect(arenaRoom.getClientTransportStats(owner.playerId)).toMatchObject({
      lastSentSnapshotTick: arenaInputTick,
      lastAckedSnapshotTick: arenaInputTick,
      pendingSnapshotLagTicks: 0,
      lastClientAckReceivedAtMs: 5678,
      staleAckCount: 0,
      droppedOutboundFrames: 0,
      resyncCount: 0,
    });

    await arenaRoom.webSocketMessage(
      participantSocket as unknown as WebSocket,
      new Uint8Array([0xc1]).buffer,
    );
    const arenaError = participantSocket.sent
      .map((frame) => {
        try {
          return decodeArenaServerMessage(new Uint8Array(frame));
        } catch {
          return undefined;
        }
      })
      .find((message) => message?._tag === 'Error');
    expect(arenaError?._tag).toBe('Error');
    expect(participantSocket.closeCode).toBe(1003);
    expect(participantSocket.closeReason).toBe('invalid frame');

    await arenaRoom.webSocketClose(ownerSocket as unknown as WebSocket);
    const reconnect = await arenaRoom.fetch(
      new Request('https://do/players/reconnect?roomId=arena-room', {
        method: 'POST',
        body: JSON.stringify({ playerId: owner.playerId }),
      }),
    );
    expect(reconnect.status).toBe(200);

    const metrics = await arenaRoom.fetch(new Request('https://do/metrics?roomId=arena-room'));
    expect(metrics.status).toBe(200);
    const metricsBody = (await metrics.json()) as {
      readonly roomId: string;
      readonly metrics: PlaytestSummary['metrics'];
    };
    expect(metricsBody.roomId).toBe('arena-room');
    expect(metricsBody.metrics.lifecyclePhase).toBe('active');

    const diagnostics = await arenaRoom.fetch(
      new Request('https://do/diagnostics?roomId=arena-room'),
    );
    expect(diagnostics.status).toBe(200);
    expect(await diagnostics.json()).toMatchObject({
      diagnostics: {
        roomId: 'arena-room',
        ownerPlayerId: owner.playerId,
        playerCount: 2,
        issues: [],
      },
    });

    const stopped = await arenaRoom.fetch(
      new Request('https://do/room/stop?roomId=arena-room', {
        method: 'POST',
        body: JSON.stringify({ playerId: owner.playerId }),
      }),
    );
    expect(stopped.status).toBe(200);
    const stoppedBody = (await stopped.json()) as {
      readonly stopped: boolean;
      readonly results: NonNullable<RoomStorage['results']>;
    };
    expect(stoppedBody.stopped).toBe(true);
    expect(stoppedBody.results.reason).toBe('owner stopped room');

    const results = await arenaRoom.fetch(new Request('https://do/results?roomId=arena-room'));
    expect(results.status).toBe(200);
    expect(await results.json()).toMatchObject({
      roomId: 'arena-room',
      results: { reason: 'owner stopped room' },
    });
  });

  it('rejects malformed lobby configuration payloads', async () => {
    const response = await room.fetch(
      new Request('https://do/lobby/configure?roomId=room-1', {
        method: 'POST',
        body: JSON.stringify({ joinCode: 'ABC10I' }),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'join code must be 6 characters using A-Z and 2-9, excluding I, O, 0, and 1',
    });
  });

  it('caps reserved generated slots to the manifest playerCapacity', async () => {
    const packageState = createFakeDurableObjectState();
    const packageRoom = await initRoom(
      packageState,
      makeEnv(),
      { createPluginHost: () => makePluginHost() },
      { maxPlayers: 8 },
      mapPackageWithCapacity(1),
    );

    const first = await packageRoom.fetch(
      new Request('https://do/players/reserve', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    );
    expect(first.status).toBe(200);
    expect((await first.json()) as { readonly playerId: string }).toEqual({ playerId: 'player-1' });

    const second = await packageRoom.fetch(
      new Request('https://do/players/reserve', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    );
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: 'room capacity reached' });
  });

  it('rejects admission after finished and archived phases', async () => {
    await connectPlayer(room, state, 'room-1', 'player-a');
    await room.removePlayer('player-a', 'left');
    let stored = await state.storage.get<RoomStorage>(STORAGE_KEY);
    expect(stored?.lifecycle.phase).toBe('finished');

    const token = await mintHandoffToken(
      { HANDOFF_SIGNING_KEY: TEST_KEY },
      {
        playtestId: 'room-1',
        playerId: 'player-b',
        ttlSeconds: 120,
      },
    );
    await expect(room.addPlayer('player-b', token, 'room-1')).rejects.toThrow(
      /room admission closed/,
    );

    await room.destroy();
    stored = await state.storage.get<RoomStorage>(STORAGE_KEY);
    expect(stored?.lifecycle.phase).toBe('archived');
    await expect(room.addPlayer('player-b', token, 'room-1')).rejects.toThrow(
      /room admission closed/,
    );
  });
});

describe('PlaytestRoom websocket auth', () => {
  it('closes with 4001 when token is missing', async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    const room = await initRoom(state, makeEnv(), undefined, { minReadyPlayers: 1 });
    await expect(room.addPlayer('player-a', '', 'room-1')).rejects.toThrow(/invalid handoff token/);
  });

  it('closes with 4001 when token is invalid', async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    const room = await initRoom(state, makeEnv(), undefined, { minReadyPlayers: 1 });
    await expect(room.addPlayer('player-a', 'bad.token', 'room-1')).rejects.toThrow(
      /invalid handoff token/,
    );
  });
});

describe('PlaytestRoom heartbeat and idle destroy', () => {
  it('disconnects stale players after heartbeat timeout', async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    let nowMs = Date.now();
    const room = await initRoom(state, makeEnv(), { now: () => nowMs });
    await connectPlayer(room, state, 'room-1', 'player-a');
    nowMs += 31_000;
    await room.alarm();
    const stored = await state.storage.get<RoomStorage>(STORAGE_KEY);
    expect(stored?.players['player-a']).toBeDefined();
    expect(stored?.presence.players['player-a']).toMatchObject({
      status: 'disconnected',
    });
    expect(stored?.reconnect.seats['player-a']?.expiresAt).toBeDefined();
  });

  it('expires disconnected lobby seats on the reconnect-window alarm', async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    let nowMs = Date.now();
    const room = await initRoom(
      state,
      makeEnv({ ROOM_RECONNECT_WINDOW_SECONDS: 1 }),
      { now: () => nowMs },
      { maxPlayers: 1 },
    );
    const server = await connectPlayer(room, state, 'room-1', 'player-a');

    nowMs += 10 * 60 * 1000;
    await room.webSocketClose(server as WebSocket);

    const reconnect = await room.fetch(
      new Request('https://do/players/reconnect?roomId=room-1', {
        method: 'POST',
        body: JSON.stringify({ playerId: 'player-a' }),
      }),
    );
    expect(reconnect.status).toBe(200);
    let stored = await state.storage.get<RoomStorage>(STORAGE_KEY);
    expect(stored?.players['player-a']).toBeDefined();
    expect(stored?.reconnect.seats['player-a']?.expiresAt).toBeDefined();

    nowMs += 2_000;
    await state.advanceTime(2_000);

    stored = await state.storage.get<RoomStorage>(STORAGE_KEY);
    expect(stored?.players['player-a']).toBeUndefined();
    expect(stored?.reconnect.seats['player-a']).toBeUndefined();
    expect(stored?.results).toMatchObject({
      reason: 'reconnect expired',
      players: [{ playerId: 'player-a', outcome: 'abandoned' }],
    });
  });

  it('destroys an empty room after idle timeout', async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    let nowMs = Date.now();
    const room = await initRoom(state, makeEnv({ ROOM_IDLE_TIMEOUT_SECONDS: 1 }), {
      now: () => nowMs,
    });
    await connectPlayer(room, state, 'room-1', 'player-a');
    await room.removePlayer('player-a', 'left');
    nowMs += 2_000;
    await room.alarm();
    const stored = await state.storage.get<RoomStorage>(STORAGE_KEY);
    expect(stored?.lifecycle.phase).toBe('archived');
  });
});

describe('PlaytestRoom persistence and recovery', () => {
  it('freezes the first plugin GameOver into durable results and stops ticks and inputs', async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    const room = await initRoom(state, makeEnv());
    const playerOne = await connectPlayer(room, state, 'room-1', 'player-1');
    const playerTwo = await connectPlayer(room, state, 'room-1', 'player-2');
    expect((await readyPlayer(room, 'player-1')).status).toBe(200);
    expect((await readyPlayer(room, 'player-2')).status).toBe(200);

    await room.alarm();
    const active = await state.storage.get<RoomStorage>(STORAGE_KEY);
    expect(active?.lifecycle.phase).toBe('active');

    emitPluginFrameForTest(
      room,
      BattleRoyaleProtocol.encodeServerMessage(
        new BattleRoyaleProtocol.GameOver({
          winner: BattleRoyaleProtocol.makePlayerId('player-2'),
        }),
      ),
    );
    await room.alarm();

    const finished = await state.storage.get<RoomStorage>(STORAGE_KEY);
    expect(finished).toMatchObject({
      tick: (active?.tick ?? 0) + 1,
      lastPersistedTick: (active?.tick ?? 0) + 1,
      lifecycle: { phase: 'finished', reason: 'match complete' },
      results: {
        reason: 'match complete',
        players: [
          { playerId: 'player-1', outcome: 'completed', placement: 2 },
          { playerId: 'player-2', outcome: 'completed', placement: 1 },
        ],
      },
    });
    expect(await state.storage.getAlarm()).toBeNull();
    for (const socket of [playerOne, playerTwo]) {
      expect(
        decodeBattleRoyaleMessages(socket).some((message) => message._tag === 'GameOver'),
      ).toBe(true);
    }

    const resultsResponse = await room.fetch(new Request('https://do/results?roomId=room-1'));
    expect(resultsResponse.status).toBe(200);
    await expect(resultsResponse.json()).resolves.toMatchObject({
      roomId: 'room-1',
      results: { reason: 'match complete' },
    });

    await room.webSocketMessage(
      playerOne as WebSocket,
      encodeBrInputFrame({ tick: finished?.tick ?? 0, seq: 99, dir: 4 }),
    );
    expect(queuedInputCount(room)).toBe(0);
    await room.alarm();
    expect((await state.storage.get<RoomStorage>(STORAGE_KEY))?.tick).toBe(finished?.tick);
  });

  it('persists state every N ticks', async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    const room = await initRoom(state, makeEnv(), undefined, { minReadyPlayers: 1 });
    await connectPlayer(room, state, 'room-1', 'player-a');
    expect((await readyPlayer(room, 'player-a')).status).toBe(200);
    for (let index = 0; index < PERSIST_EVERY_N_TICKS; index += 1) {
      await room.alarm();
    }
    const stored = await state.storage.get<RoomStorage>(STORAGE_KEY);
    expect(stored?.lastPersistedTick).toBe(PERSIST_EVERY_N_TICKS);
    expect(stored?.simState.lastTick).toBe(PERSIST_EVERY_N_TICKS);
  });

  it('rehydrates storage on a new DO instance', async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    const room = await initRoom(state, makeEnv(), undefined, { minReadyPlayers: 1 });
    await connectPlayer(room, state, 'room-1', 'player-a');
    expect((await readyPlayer(room, 'player-a')).status).toBe(200);
    await room.alarm();
    const snapshot = await state.storage.get<RoomStorage>(STORAGE_KEY);
    const reloadedState = createFakeDurableObjectState();
    reloadedState.storageMap.set(STORAGE_KEY, snapshot);
    const reloaded = new PlaytestRoom(asDurableObjectState(reloadedState), makeEnv());
    registerAlarmHandler(reloadedState, () => reloaded.alarm());
    await new Promise((resolve) => setTimeout(resolve, 0));
    const stored = await reloadedState.storage.get<RoomStorage>(STORAGE_KEY);
    expect(Object.keys(stored?.players ?? {})).toContain('player-a');
    expect(stored?.tick).toBeGreaterThan(0);
  });

  it('migrates legacy status storage into canonical lifecycle storage', async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    state.storageMap.set(STORAGE_KEY, {
      schemaVersion: 1,
      mapId: 'map:fixture',
      seed: 42,
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'running',
      options: {},
      players: {},
      tick: 7,
      baseTick: 0,
      lastPersistedTick: 0,
      lastTickAt: '2026-01-01T00:00:01.000Z',
      emptySince: null,
      simState: { lastTick: 7 },
    });

    const room = new PlaytestRoom(asDurableObjectState(state), makeEnv());
    registerAlarmHandler(state, () => room.alarm());
    await new Promise((resolve) => setTimeout(resolve, 0));

    const stored = await state.storage.get<RoomStorage>(STORAGE_KEY);
    expect(stored?.schemaVersion).toBe(ROOM_SCHEMA_VERSION);
    expect(stored?.lifecycle).toMatchObject({
      phase: 'active',
      activeStartedAt: '2026-01-01T00:00:01.000Z',
    });
    expect('status' in (stored ?? {})).toBe(false);
  });
});

describe('PlaytestRoom wire protocol and plugins', () => {
  it('forwards plugin welcome bytes verbatim to a BR decoder', async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    const room = await initRoom(state, makeEnv(), undefined, { minReadyPlayers: 1 });
    const server = await connectPlayerViaFetch(room, state, 'room-1', 'player-1');
    const firstFrame = server.sent[0];

    expect(firstFrame).toBeDefined();
    const welcome = BattleRoyaleProtocol.decodeServerMessage(
      new Uint8Array(firstFrame ?? new ArrayBuffer(0)),
    );

    expect(welcome._tag).toBe('WelcomeSnapshot');
    expect(() => decodeMessage(new Uint8Array(firstFrame ?? new ArrayBuffer(0)))).toThrow();
  });

  it('connects, receives welcome, drains input, and emits movement delta', async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    const room = await initRoom(state, makeEnv(), undefined, { minReadyPlayers: 1 });
    const server = await connectPlayerViaFetch(room, state, 'room-1', 'player-1');
    const welcome = decodeBattleRoyaleMessages(server).find(
      (message) => message._tag === 'WelcomeSnapshot',
    );
    expect(welcome?._tag).toBe('WelcomeSnapshot');
    if (welcome?._tag !== 'WelcomeSnapshot') {
      throw new Error('expected BR welcome snapshot');
    }
    const initialPlayer = welcome.players.find((player) => player.id === 'player-1');
    expect(initialPlayer).toBeDefined();

    await room.webSocketMessage(
      server as WebSocket,
      encodeBrInputFrame({ tick: 1, seq: 1, dir: 0 }),
    );
    expect((await readyPlayer(room, 'player-1')).status).toBe(200);
    await room.alarm();
    const delta = decodeBattleRoyaleMessages(server).find(
      (message) =>
        message._tag === 'DeltaSnapshot' &&
        message.updated.some((player) => player.id === 'player-1'),
    );
    expect(delta?._tag).toBe('DeltaSnapshot');
    if (delta?._tag === 'DeltaSnapshot') {
      const movedPlayer = delta.updated.find((player) => player.id === 'player-1');
      expect(movedPlayer?.x._tag).toBe('Some');
      if (movedPlayer?.x._tag === 'Some') {
        expect(movedPlayer.x.value).toBeGreaterThan(initialPlayer?.x ?? 0);
      }
    }
  });

  it('flows stored playerModelSelections through the bundled loader into the adapter (welcome reflects the selection)', async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    const room = new PlaytestRoom(asDurableObjectState(state), makeEnv());
    registerAlarmHandler(state, () => room.alarm());
    // The bundled default package ships ['maltipoo-mae', 'maltipoo-max'];
    // selecting the NON-default second model proves the session selection
    // (room storage → createBundledPluginLoader.getPlayerModelSelections →
    // adapter) wins over the package default.
    await room.fetch(
      new Request('https://do/create?roomId=room-models', {
        method: 'POST',
        body: JSON.stringify({
          mapId: 'map:fixture',
          seed: 42,
          playerModelSelections: [{ playerId: 'player-1', modelId: 'maltipoo-max' }],
        }),
      }),
    );

    const selectedSocket = await connectPlayerViaFetch(room, state, 'room-models', 'player-1');
    const selectedWelcome = decodeBattleRoyaleMessages(selectedSocket).find(
      (message) => message._tag === 'WelcomeSnapshot',
    );
    if (selectedWelcome?._tag !== 'WelcomeSnapshot') {
      throw new Error('expected BR welcome snapshot for player-1');
    }
    expect(selectedWelcome.players.find((player) => player.id === 'player-1')?.modelId).toBe(
      'maltipoo-max',
    );

    const defaultSocket = await connectPlayerViaFetch(room, state, 'room-models', 'player-2');
    const defaultWelcome = decodeBattleRoyaleMessages(defaultSocket)
      .filter((message) => message._tag === 'WelcomeSnapshot')
      .at(-1);
    if (defaultWelcome?._tag !== 'WelcomeSnapshot') {
      throw new Error('expected BR welcome snapshot for player-2');
    }
    expect(defaultWelcome.players.find((player) => player.id === 'player-2')?.modelId).toBe(
      'maltipoo-mae',
    );
  });

  it('sends active late joiners a replay welcome that includes their spawned player', async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    const room = await initRoom(state, makeEnv(), undefined, { minReadyPlayers: 1 });
    await connectPlayerViaFetch(room, state, 'room-1', 'player-1');
    expect((await readyPlayer(room, 'player-1')).status).toBe(200);
    await room.alarm();

    const late = await connectPlayerViaFetch(room, state, 'room-1', 'player-2');
    const welcome = decodeBattleRoyaleMessages(late)
      .filter((message) => message._tag === 'WelcomeSnapshot')
      .at(-1);

    expect(welcome?._tag).toBe('WelcomeSnapshot');
    if (welcome?._tag !== 'WelcomeSnapshot') {
      throw new Error('expected BR welcome snapshot');
    }
    const latePlayer = welcome.players.find((player) => player.id === 'player-2');
    // The second joiner spawns at the SECOND spawn point of the generated
    // default package (deterministic spawn assignment) — derive the expected
    // coordinates from the package instead of pinning magic numbers.
    const packageMap = (
      bundledMapPackages[0]!.mapPackage as unknown as {
        map: { objects: readonly { x: number; y: number }[] };
      }
    ).map;
    const secondSpawn = packageMap.objects[1]!;
    expect(latePlayer).toMatchObject({ id: 'player-2', x: secondSpawn.x, y: secondSpawn.y });
  });

  it('routes a reserved generated player slot into BR shooting simulation', async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    const room = await initRoom(state, makeEnv(), undefined, { minReadyPlayers: 1 });
    const reserved = await room.fetch(
      new Request('https://do/players/reserve', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    );
    expect(await reserved.json()).toEqual({ playerId: 'player-1' });

    const server = await connectPlayerViaFetch(room, state, 'room-1', 'player-1');
    expect((await readyPlayer(room, 'player-1')).status).toBe(200);
    await room.alarm();
    await room.webSocketMessage(
      server as WebSocket,
      encodeBrInputFrame({ tick: 1, seq: 1, shoot: true, aimDeg: 90, swapSlot: 2 }),
    );
    await room.alarm();

    const projectileDelta = decodeBattleRoyaleMessages(server).find(
      (message) => message._tag === 'DeltaSnapshot' && message.projectilesUpdated.length > 0,
    );
    expect(projectileDelta?._tag).toBe('DeltaSnapshot');
    if (projectileDelta?._tag === 'DeltaSnapshot') {
      const projectile = projectileDelta.projectilesUpdated[0];
      expect(projectile?.ownerPlayerId._tag).toBe('Some');
      expect(projectile?.weaponSlot._tag).toBe('Some');
      if (projectile?.ownerPlayerId._tag === 'Some') {
        expect(projectile.ownerPlayerId.value).toBe('player-1');
      }
      if (projectile?.weaponSlot._tag === 'Some') {
        expect(projectile.weaponSlot.value).toBe(2);
      }
    }
  });

  it('rejects malformed BR frames without refreshing heartbeat', async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    let nowMs = Date.now();
    const room = await initRoom(state, makeEnv(), { now: () => nowMs });
    const server = await connectPlayer(room, state, 'room-1', 'player-1');
    const before = (await state.storage.get<RoomStorage>(STORAGE_KEY))?.players['player-1']
      ?.lastHeartbeatAt;

    nowMs += 1_000;
    await room.webSocketMessage(server as WebSocket, new Uint8Array([0xc1]).buffer);

    const after = (await state.storage.get<RoomStorage>(STORAGE_KEY))?.players['player-1']
      ?.lastHeartbeatAt;
    const error = decodeBattleRoyaleMessages(server).find((message) => message._tag === 'Error');
    expect(error?._tag).toBe('Error');
    expect(server.closeCode).toBe(1003);
    expect(server.closeReason).toBe('invalid frame');
    expect(after).toBe(before);
  });

  it('refreshes heartbeat only after accepted BR heartbeat frames', async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    let nowMs = Date.now();
    const room = await initRoom(state, makeEnv(), { now: () => nowMs });
    const server = await connectPlayer(room, state, 'room-1', 'player-1');
    const before = (await state.storage.get<RoomStorage>(STORAGE_KEY))?.players['player-1']
      ?.lastHeartbeatAt;

    nowMs += 1_000;
    await room.webSocketMessage(server as WebSocket, encodeBrHeartbeatFrame(1));

    const after = (await state.storage.get<RoomStorage>(STORAGE_KEY))?.players['player-1']
      ?.lastHeartbeatAt;
    expect(server.closeCode).toBeNull();
    expect(after).not.toBe(before);
  });

  it('sends the current BR baseline to late joiners', async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    const room = await initRoom(state, makeEnv(), undefined, { minReadyPlayers: 1 });
    const first = await connectPlayerViaFetch(room, state, 'room-1', 'player-1');
    const initialWelcome = decodeBattleRoyaleMessages(first).find(
      (message) => message._tag === 'WelcomeSnapshot',
    );
    if (initialWelcome?._tag !== 'WelcomeSnapshot') {
      throw new Error('expected initial welcome snapshot');
    }
    const initialPlayer = initialWelcome.players.find((player) => player.id === 'player-1');
    expect(initialPlayer).toBeDefined();

    await room.webSocketMessage(
      first as WebSocket,
      encodeBrInputFrame({ tick: 1, seq: 1, dir: 0 }),
    );
    expect((await readyPlayer(room, 'player-1')).status).toBe(200);
    await room.alarm();

    const late = await connectPlayerViaFetch(room, state, 'room-1', 'player-2');
    const lateWelcome = decodeBattleRoyaleMessages(late).find(
      (message) => message._tag === 'WelcomeSnapshot',
    );
    expect(lateWelcome?._tag).toBe('WelcomeSnapshot');
    if (lateWelcome?._tag === 'WelcomeSnapshot') {
      const currentPlayer = lateWelcome.players.find((player) => player.id === 'player-1');
      expect(lateWelcome.tick).toBeGreaterThan(initialWelcome.tick);
      expect(currentPlayer?.x).toBeGreaterThan(initialPlayer?.x ?? 0);
    }
  });

  it('replaces a same-player socket without losing durable player state', async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    const room = await initRoom(state, makeEnv(), undefined, { minReadyPlayers: 1 });
    const first = await connectPlayerViaFetch(room, state, 'room-1', 'player-1');
    const initialWelcome = decodeBattleRoyaleMessages(first).find(
      (message) => message._tag === 'WelcomeSnapshot',
    );
    if (initialWelcome?._tag !== 'WelcomeSnapshot') {
      throw new Error('expected initial welcome snapshot');
    }
    const initialPlayer = initialWelcome.players.find((player) => player.id === 'player-1');
    expect(initialPlayer).toBeDefined();

    await room.webSocketMessage(
      first as WebSocket,
      encodeBrInputFrame({ tick: 1, seq: 1, dir: 0 }),
    );
    expect((await readyPlayer(room, 'player-1')).status).toBe(200);
    await room.alarm();
    const beforeReconnect = await state.storage.get<RoomStorage>(STORAGE_KEY);
    const joinedAt = beforeReconnect?.players['player-1']?.joinedAt;

    const replacement = await connectPlayerViaFetch(room, state, 'room-1', 'player-1');
    expect(first.closeCode).toBe(ROOM_REPLACED_CLOSE_CODE);
    expect(first.closeReason).toBe('player reconnected');
    const replacementWelcome = decodeBattleRoyaleMessages(replacement).find(
      (message) => message._tag === 'WelcomeSnapshot',
    );
    expect(replacementWelcome?._tag).toBe('WelcomeSnapshot');
    if (replacementWelcome?._tag === 'WelcomeSnapshot') {
      const currentPlayer = replacementWelcome.players.find((player) => player.id === 'player-1');
      expect(replacementWelcome.tick).toBeGreaterThan(initialWelcome.tick);
      expect(currentPlayer?.x).toBeGreaterThan(initialPlayer?.x ?? 0);
    }

    await room.webSocketClose(first as WebSocket);
    const afterStaleClose = await state.storage.get<RoomStorage>(STORAGE_KEY);
    expect(afterStaleClose?.players['player-1']?.joinedAt).toBe(joinedAt);

    await room.webSocketClose(replacement as WebSocket);
    const afterReplacementClose = await state.storage.get<RoomStorage>(STORAGE_KEY);
    expect(afterReplacementClose?.players['player-1']?.joinedAt).toBe(joinedAt);
    expect(afterReplacementClose?.presence.players['player-1']).toMatchObject({
      status: 'disconnected',
    });
    expect(afterReplacementClose?.reconnect.seats['player-1']?.expiresAt).toBeDefined();
  });

  it('accepts snapshot acks and clears per-client lag counters', async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    let nowMs = Date.now();
    const room = await initRoom(state, makeEnv(), { now: () => nowMs });
    const server = await connectPlayerViaFetch(room, state, 'room-1', 'player-1');
    const welcome = decodeBattleRoyaleMessages(server).find(
      (message) => message._tag === 'WelcomeSnapshot',
    );
    if (welcome?._tag !== 'WelcomeSnapshot') {
      throw new Error('expected BR welcome snapshot');
    }

    let stats = room.getClientTransportStats('player-1');
    expect(stats).toMatchObject({
      lastSentSnapshotTick: welcome.tick,
      lastAckedSnapshotTick: -1,
      pendingSnapshotLagTicks: welcome.tick + 1,
    });

    nowMs += 100;
    await room.webSocketMessage(server as WebSocket, encodeBrSnapshotAckFrame(welcome.tick, 1234));

    stats = room.getClientTransportStats('player-1');
    expect(stats).toMatchObject({
      lastSentSnapshotTick: welcome.tick,
      lastAckedSnapshotTick: welcome.tick,
      pendingSnapshotLagTicks: 0,
      lastAckReceivedAtMs: nowMs,
      lastClientAckReceivedAtMs: 1234,
      staleAckCount: 0,
    });
    expect(server.closeCode).toBeNull();
  });

  it('rejects stale and future snapshot acks deterministically', async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    const room = await initRoom(state, makeEnv(), undefined, { minReadyPlayers: 1 });
    const server = await connectPlayerViaFetch(room, state, 'room-1', 'player-1');
    const welcome = decodeBattleRoyaleMessages(server).find(
      (message) => message._tag === 'WelcomeSnapshot',
    );
    if (welcome?._tag !== 'WelcomeSnapshot') {
      throw new Error('expected BR welcome snapshot');
    }

    await room.webSocketMessage(server as WebSocket, encodeBrSnapshotAckFrame(welcome.tick));
    await room.webSocketMessage(server as WebSocket, encodeBrSnapshotAckFrame(welcome.tick));

    const staleError = decodeBattleRoyaleMessages(server).find(
      (message) => message._tag === 'Error' && message.code === 'stale_snapshot_ack',
    );
    expect(staleError?._tag).toBe('Error');
    expect(room.getClientTransportStats('player-1')?.staleAckCount).toBe(1);
    expect(server.closeCode).toBeNull();

    await room.webSocketMessage(server as WebSocket, encodeBrSnapshotAckFrame(welcome.tick + 99));
    expect(server.closeCode).toBe(ROOM_INVALID_ACK_CLOSE_CODE);
    expect(server.closeReason).toBe('invalid snapshot ack');
  });

  it('resyncs lagging clients before dropping overloaded transport', async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    const room = await initRoom(state, makeEnv(), undefined, { minReadyPlayers: 1 });
    const server = await connectPlayerViaFetch(room, state, 'room-1', 'player-1');
    const welcome = decodeBattleRoyaleMessages(server).find(
      (message) => message._tag === 'WelcomeSnapshot',
    );
    if (welcome?._tag !== 'WelcomeSnapshot') {
      throw new Error('expected BR welcome snapshot');
    }
    expect((await readyPlayer(room, 'player-1')).status).toBe(200);
    await room.alarm();
    const activeBaselineTick =
      room.getClientTransportStats('player-1')?.lastSentSnapshotTick ?? welcome.tick;
    await room.webSocketMessage(server as WebSocket, encodeBrSnapshotAckFrame(activeBaselineTick));

    for (let index = 0; index <= MAX_UNACKED_SNAPSHOT_TICKS_BEFORE_RESYNC + 1; index += 1) {
      await room.alarm();
    }

    let stats = room.getClientTransportStats('player-1');
    expect(stats?.pendingSnapshotLagTicks).toBeGreaterThanOrEqual(
      MAX_UNACKED_SNAPSHOT_TICKS_BEFORE_RESYNC,
    );
    expect(stats?.resyncCount).toBeGreaterThan(0);
    expect(stats?.droppedOutboundFrames).toBeGreaterThan(0);
    const resyncTick = stats?.resyncSnapshotTick;
    expect(resyncTick).toEqual(expect.any(Number));
    expect(server.closeCode).toBeNull();

    await room.webSocketMessage(server as WebSocket, encodeBrSnapshotAckFrame(resyncTick ?? 0));
    stats = room.getClientTransportStats('player-1');
    expect(stats?.resyncSnapshotTick).toBeNull();
    expect(stats?.pendingSnapshotLagTicks).toBeLessThan(MAX_UNACKED_SNAPSHOT_TICKS_BEFORE_RESYNC);

    for (let index = 0; index <= MAX_UNACKED_SNAPSHOT_TICKS_BEFORE_DROP + 1; index += 1) {
      await room.alarm();
    }

    expect(server.closeCode).toBe(ROOM_BACKPRESSURE_CLOSE_CODE);
    expect(server.closeReason).toBe('snapshot backpressure');
  });

  it('exposes authoritative session and transport metrics in playtest summary', async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    let nowMs = Date.parse('2026-01-01T00:00:00.000Z');
    const room = await initRoom(state, makeEnv(), { now: () => nowMs }, { minReadyPlayers: 1 });
    const server = await connectPlayerViaFetch(room, state, 'room-1', 'player-1');
    const welcome = decodeBattleRoyaleMessages(server).find(
      (message) => message._tag === 'WelcomeSnapshot',
    );
    if (welcome?._tag !== 'WelcomeSnapshot') {
      throw new Error('expected BR welcome snapshot');
    }
    await room.webSocketMessage(server as WebSocket, encodeBrSnapshotAckFrame(welcome.tick));
    expect((await readyPlayer(room, 'player-1')).status).toBe(200);

    for (let index = 0; index <= MAX_UNACKED_SNAPSHOT_TICKS_BEFORE_RESYNC + 1; index += 1) {
      nowMs += 50;
      await room.alarm();
    }

    const response = await room.fetch(new Request('https://do/?playtestId=room-1'));
    expect(response.status).toBe(200);
    const summary = (await response.json()) as PlaytestSummary;
    expect(summary.connectedClients).toBe(1);
    expect(summary.metrics).toMatchObject({
      lifecyclePhase: 'active',
      playerCount: 1,
      connectedClients: 1,
      queuedInputPlayers: 0,
      pendingPluginFrames: 0,
      generatedAt: new Date(nowMs).toISOString(),
    });
    expect(summary.metrics.tick).toBeGreaterThan(0);
    expect(summary.metrics.replayFrames).toBeGreaterThan(0);
    expect(summary.metrics.transport.trackedClients).toBe(1);
    expect(summary.metrics.transport.maxPendingSnapshotLagTicks).toBeGreaterThanOrEqual(
      MAX_UNACKED_SNAPSHOT_TICKS_BEFORE_RESYNC,
    );
    expect(summary.metrics.transport.totalDroppedOutboundFrames).toBeGreaterThan(0);
    expect(summary.metrics.transport.totalResyncs).toBeGreaterThan(0);
    expect(JSON.stringify(summary.metrics)).not.toContain('socketId');
    expect(JSON.stringify(summary.metrics)).not.toContain('player-1');
  });

  it('closes buffered clients after one resync attempt', async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    const room = await initRoom(state, makeEnv(), undefined, { minReadyPlayers: 1 });
    const server = await connectPlayerViaFetch(room, state, 'room-1', 'player-1');
    const welcome = decodeBattleRoyaleMessages(server).find(
      (message) => message._tag === 'WelcomeSnapshot',
    );
    if (welcome?._tag !== 'WelcomeSnapshot') {
      throw new Error('expected BR welcome snapshot');
    }
    await room.webSocketMessage(server as WebSocket, encodeBrSnapshotAckFrame(welcome.tick));
    expect((await readyPlayer(room, 'player-1')).status).toBe(200);

    server.bufferedAmount = MAX_OUTBOUND_BUFFERED_BYTES + 1;
    await room.alarm();
    expect(room.getClientTransportStats('player-1')?.resyncCount).toBeGreaterThan(0);
    expect(server.closeCode).toBeNull();

    await room.alarm();
    expect(server.closeCode).toBe(ROOM_BACKPRESSURE_CLOSE_CODE);
    expect(server.closeReason).toBe('snapshot backpressure');
  });

  it('coalesces input floods to the latest queued frame per player', async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    const room = await initRoom(state, makeEnv(), undefined, { minReadyPlayers: 1 });
    const server = await connectPlayerViaFetch(room, state, 'room-1', 'player-1');
    const welcome = decodeBattleRoyaleMessages(server).find(
      (message) => message._tag === 'WelcomeSnapshot',
    );
    if (welcome?._tag !== 'WelcomeSnapshot') {
      throw new Error('expected BR welcome snapshot');
    }
    const initialPlayer = welcome.players.find((player) => player.id === 'player-1');
    expect(initialPlayer).toBeDefined();

    for (let seq = 1; seq <= 64; seq += 1) {
      await room.webSocketMessage(
        server as WebSocket,
        encodeBrInputFrame({ tick: 1, seq, dir: seq === 64 ? 4 : 0 }),
      );
    }

    expect(queuedInputCount(room)).toBe(MAX_QUEUED_INPUTS_PER_PLAYER);
    expect((await readyPlayer(room, 'player-1')).status).toBe(200);
    await room.alarm();
    expect(queuedInputCount(room)).toBe(0);

    const delta = decodeBattleRoyaleMessages(server).find(
      (message) =>
        message._tag === 'DeltaSnapshot' &&
        message.updated.some((player) => player.id === 'player-1'),
    );
    expect(delta?._tag).toBe('DeltaSnapshot');
    if (delta?._tag === 'DeltaSnapshot') {
      const movedPlayer = delta.updated.find((player) => player.id === 'player-1');
      expect(movedPlayer?.x._tag).toBe('Some');
      if (movedPlayer?.x._tag === 'Some') {
        expect(movedPlayer.x.value).toBeLessThan(initialPlayer?.x ?? 0);
      }
    }
  });

  it('invokes plugin onTick and fans out plugin messages', async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    let tickCalls = 0;
    const pluginHostFactory = (emit: (message: RuntimeMessage) => void): PluginHostApi => {
      const host = makePluginHost();
      const plugin: RuntimePlugin = {
        id: 'fixture-plugin',
        onTick: () =>
          Effect.sync(() => {
            tickCalls += 1;
            emit(new ServerNotice({ message: 'plugin tick' }));
          }),
      };
      void Effect.runSync(host.register(plugin));
      return host;
    };
    const room = await initRoom(
      state,
      makeEnv(),
      { createPluginHost: pluginHostFactory },
      { minReadyPlayers: 1 },
    );
    const server = await connectPlayer(room, state, 'room-1', 'player-a');
    expect((await readyPlayer(room, 'player-a')).status).toBe(200);
    await room.alarm();
    expect(tickCalls).toBeGreaterThan(0);
    const notice = server.sent
      .map((frame) => decodeMessage(new Uint8Array(frame)))
      .find((message) => message._tag === 'ServerNotice');
    expect(notice?._tag).toBe('ServerNotice');
  });

  it('broadcasts to three connected clients', async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    const room = await initRoom(state, makeEnv());
    const sockets = await Promise.all([
      connectPlayer(room, state, 'room-1', 'player-a'),
      connectPlayer(room, state, 'room-1', 'player-b'),
      connectPlayer(room, state, 'room-1', 'player-c'),
    ]);
    expect((await readyPlayer(room, 'player-a')).status).toBe(200);
    expect((await readyPlayer(room, 'player-b')).status).toBe(200);
    expect((await readyPlayer(room, 'player-c')).status).toBe(200);
    await room.alarm();
    for (const socket of sockets) {
      const delta = decodeBattleRoyaleMessages(socket).some(
        (message) => message._tag === 'DeltaSnapshot',
      );
      expect(delta).toBe(true);
    }
  });
});

describe('PlaytestRoom alarm cadence', () => {
  it('schedules repeated alarms while running', async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    const room = await initRoom(state, makeEnv(), undefined, { minReadyPlayers: 1 });
    await connectPlayer(room, state, 'room-1', 'player-a');
    expect((await readyPlayer(room, 'player-a')).status).toBe(200);
    await room.alarm();
    const firstTick = (await state.storage.get<RoomStorage>(STORAGE_KEY))?.tick ?? 0;
    await state.advanceTime(60);
    await room.alarm();
    const secondTick = (await state.storage.get<RoomStorage>(STORAGE_KEY))?.tick ?? 0;
    expect(secondTick).toBeGreaterThan(firstTick);
  });
});
