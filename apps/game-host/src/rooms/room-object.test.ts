import { Effect, Option } from "effect";
import { beforeEach, describe, expect, it } from "vitest";

import { BattleRoyaleProtocol } from "@tileborne/ipc-contracts";
import {
  decodeMessage,
  makePluginHost,
  ServerNotice,
} from "@tileborne/runtime";
import type { PluginHostApi, RuntimeMessage, RuntimePlugin } from "@tileborne/runtime";

import { mintHandoffToken } from "./handoff-token.js";
import { MAX_QUEUED_INPUTS_PER_PLAYER, PlaytestRoom } from "./room-object.js";
import { STORAGE_KEY, type RoomStorage } from "./storage-schema.js";
import { PERSIST_EVERY_N_TICKS } from "./room-config.js";
import {
  createFakeDurableObjectState,
  installWorkerGlobals,
  registerAlarmHandler,
  asDurableObjectState,
  MemoryWebSocket,
  type FakeDurableObjectState,
} from "../test-helpers/do-fake.js";
import type { Env } from "../types.js";

const TEST_KEY = "test-handoff-signing-key-32-bytes!!";

const makeEnv = (overrides: Partial<Env> = {}): Env => ({
  PLAYTEST_ROOM: {
    idFromName: (name: string) => ({ toString: () => name }) as DurableObjectId,
    get: () => ({ fetch: async () => new Response("unused") }),
  },
  HANDOFF_SIGNING_KEY: TEST_KEY,
  ROOM_IDLE_TIMEOUT_SECONDS: 1,
  ...overrides,
});

const initRoom = async (
  state: FakeDurableObjectState,
  env: Env,
  deps?: ConstructorParameters<typeof PlaytestRoom>[2],
): Promise<PlaytestRoom> => {
  installWorkerGlobals();
  const room = new PlaytestRoom(asDurableObjectState(state), env, deps);
  registerAlarmHandler(state, () => room.alarm());
  await room.fetch(
    new Request("https://do/create?roomId=room-1", {
      method: "POST",
      body: JSON.stringify({ mapId: "map:fixture", seed: 42 }),
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
  const token = await mintHandoffToken({ HANDOFF_SIGNING_KEY: TEST_KEY }, {
    playtestId,
    playerId,
    ttlSeconds: 120,
  });
  const server = new MemoryWebSocket();
  server.serializeAttachment({ playerId });
  state.acceptWebSocket(server);
  await room.addPlayer(playerId, token, playtestId);
  return server;
};

const connectPlayerViaFetch = async (
  room: PlaytestRoom,
  state: FakeDurableObjectState,
  playtestId: string,
  playerId: string,
): Promise<MemoryWebSocket> => {
  const token = await mintHandoffToken({ HANDOFF_SIGNING_KEY: TEST_KEY }, {
    playtestId,
    playerId,
    ttlSeconds: 120,
  });
  await room.fetch(
    new Request(
      `https://do/connect?playtestId=${encodeURIComponent(playtestId)}&playerId=${encodeURIComponent(playerId)}&token=${encodeURIComponent(token)}`,
      { headers: { Upgrade: "websocket" } },
    ),
  );
  return state.sockets[state.sockets.length - 1] as MemoryWebSocket;
};

const decodeBattleRoyaleMessages = (server: MemoryWebSocket): BattleRoyaleProtocol.ServerToClientMessage[] =>
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

const encodeBrInputFrame = (
  input: {
    readonly tick: number;
    readonly seq: number;
    readonly dir: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
    readonly shoot?: boolean;
  },
): ArrayBuffer => {
  const bytes = BattleRoyaleProtocol.encodeClientMessage(
    new BattleRoyaleProtocol.PlayerInput({
      tick: input.tick,
      seq: input.seq,
      dir: input.dir,
      shoot: input.shoot ?? false,
      aimDeg: Option.none(),
      weaponSlot: Option.none(),
    }),
  );
  const frame = new Uint8Array(bytes.byteLength);
  frame.set(bytes);
  return frame.buffer;
};

const encodeBrHeartbeatFrame = (tick: number): ArrayBuffer => {
  const bytes = BattleRoyaleProtocol.encodeClientMessage(new BattleRoyaleProtocol.Heartbeat({ tick }));
  const frame = new Uint8Array(bytes.byteLength);
  frame.set(bytes);
  return frame.buffer;
};

const queuedInputCount = (room: PlaytestRoom): number =>
  (room as unknown as { readonly inputQueueByPlayerId: { readonly size: number } }).inputQueueByPlayerId.size;

describe("PlaytestRoom lifecycle", () => {
  let state: FakeDurableObjectState;
  let env: Env;
  let room: PlaytestRoom;

  beforeEach(async () => {
    state = createFakeDurableObjectState();
    env = makeEnv();
    room = await initRoom(state, env);
  });

  it("creates room storage in lobby state", async () => {
    const stored = await state.storage.get<RoomStorage>(STORAGE_KEY);
    expect(stored?.status).toBe("lobby");
    expect(stored?.mapId).toBe("map:fixture");
  });

  it("adds a player without injecting legacy PlayerJoined on BR sockets", async () => {
    const server = await connectPlayer(room, state, "room-1", "player-a");
    const joined = decodeLegacyMessages(server).find((message) => message._tag === "PlayerJoined");
    expect(joined).toBeUndefined();
  });

  it("fans out BR DeltaSnapshot on simulation ticks", async () => {
    await connectPlayer(room, state, "room-1", "player-a");
    await room.alarm();
    const server = state.sockets[0] as MemoryWebSocket;
    const delta = decodeBattleRoyaleMessages(server).find((message) => message._tag === "DeltaSnapshot");
    expect(delta?._tag).toBe("DeltaSnapshot");
    if (delta?._tag === "DeltaSnapshot") {
      expect(delta.tick).toBeGreaterThan(0);
    }
  });

  it("removePlayer does not inject legacy PlayerLeft on BR sockets", async () => {
    await connectPlayer(room, state, "room-1", "player-a");
    await room.removePlayer("player-a", "test");
    const stored = await state.storage.get<RoomStorage>(STORAGE_KEY);
    expect(stored?.players["player-a"]).toBeUndefined();
    const server = state.sockets[0] as MemoryWebSocket;
    const left = decodeLegacyMessages(server).find((message) => message._tag === "PlayerLeft");
    expect(left).toBeUndefined();
  });

  it("destroy archives the room", async () => {
    await room.destroy();
    const stored = await state.storage.get<RoomStorage>(STORAGE_KEY);
    expect(stored?.status).toBe("archived");
  });
});

describe("PlaytestRoom websocket auth", () => {
  it("closes with 4001 when token is missing", async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    const room = await initRoom(state, makeEnv());
    await expect(room.addPlayer("player-a", "", "room-1")).rejects.toThrow(/invalid handoff token/);
  });

  it("closes with 4001 when token is invalid", async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    const room = await initRoom(state, makeEnv());
    await expect(room.addPlayer("player-a", "bad.token", "room-1")).rejects.toThrow(/invalid handoff token/);
  });
});

describe("PlaytestRoom heartbeat and idle destroy", () => {
  it("disconnects stale players after heartbeat timeout", async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    let nowMs = Date.now();
    const room = await initRoom(state, makeEnv(), { now: () => nowMs });
    await connectPlayer(room, state, "room-1", "player-a");
    nowMs += 31_000;
    await room.alarm();
    const stored = await state.storage.get<RoomStorage>(STORAGE_KEY);
    expect(stored?.players["player-a"]).toBeUndefined();
  });

  it("destroys an empty room after idle timeout", async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    let nowMs = Date.now();
    const room = await initRoom(state, makeEnv({ ROOM_IDLE_TIMEOUT_SECONDS: 1 }), { now: () => nowMs });
    await connectPlayer(room, state, "room-1", "player-a");
    await room.removePlayer("player-a", "left");
    nowMs += 2_000;
    await room.alarm();
    const stored = await state.storage.get<RoomStorage>(STORAGE_KEY);
    expect(stored?.status).toBe("archived");
  });
});

describe("PlaytestRoom persistence and recovery", () => {
  it("persists state every N ticks", async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    const room = await initRoom(state, makeEnv());
    await connectPlayer(room, state, "room-1", "player-a");
    for (let index = 0; index < PERSIST_EVERY_N_TICKS; index += 1) {
      await room.alarm();
    }
    const stored = await state.storage.get<RoomStorage>(STORAGE_KEY);
    expect(stored?.lastPersistedTick).toBe(PERSIST_EVERY_N_TICKS);
    expect(stored?.simState.lastTick).toBe(PERSIST_EVERY_N_TICKS);
  });

  it("rehydrates storage on a new DO instance", async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    const room = await initRoom(state, makeEnv());
    await connectPlayer(room, state, "room-1", "player-a");
    await room.alarm();
    const snapshot = await state.storage.get<RoomStorage>(STORAGE_KEY);
    const reloadedState = createFakeDurableObjectState();
    reloadedState.storageMap.set(STORAGE_KEY, snapshot);
    const reloaded = new PlaytestRoom(asDurableObjectState(reloadedState), makeEnv());
    registerAlarmHandler(reloadedState, () => reloaded.alarm());
    await new Promise((resolve) => setTimeout(resolve, 0));
    const stored = await reloadedState.storage.get<RoomStorage>(STORAGE_KEY);
    expect(Object.keys(stored?.players ?? {})).toContain("player-a");
    expect(stored?.tick).toBeGreaterThan(0);
  });
});

describe("PlaytestRoom wire protocol and plugins", () => {
  it("forwards plugin welcome bytes verbatim to a BR decoder", async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    const room = await initRoom(state, makeEnv());
    const server = await connectPlayerViaFetch(room, state, "room-1", "player-1");
    const firstFrame = server.sent[0];

    expect(firstFrame).toBeDefined();
    const welcome = BattleRoyaleProtocol.decodeServerMessage(new Uint8Array(firstFrame ?? new ArrayBuffer(0)));

    expect(welcome._tag).toBe("WelcomeSnapshot");
    expect(() => decodeMessage(new Uint8Array(firstFrame ?? new ArrayBuffer(0)))).toThrow();
  });

  it("connects, receives welcome, drains input, and emits movement delta", async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    const room = await initRoom(state, makeEnv());
    const server = await connectPlayerViaFetch(room, state, "room-1", "player-1");
    const welcome = decodeBattleRoyaleMessages(server).find((message) => message._tag === "WelcomeSnapshot");
    expect(welcome?._tag).toBe("WelcomeSnapshot");
    if (welcome?._tag !== "WelcomeSnapshot") {
      throw new Error("expected BR welcome snapshot");
    }
    const initialPlayer = welcome.players.find((player) => player.id === "player-1");
    expect(initialPlayer).toBeDefined();

    await room.webSocketMessage(server as WebSocket, encodeBrInputFrame({ tick: 1, seq: 1, dir: 0 }));
    await room.alarm();
    const delta = decodeBattleRoyaleMessages(server).find(
      (message) =>
        message._tag === "DeltaSnapshot" && message.updated.some((player) => player.id === "player-1"),
    );
    expect(delta?._tag).toBe("DeltaSnapshot");
    if (delta?._tag === "DeltaSnapshot") {
      const movedPlayer = delta.updated.find((player) => player.id === "player-1");
      expect(movedPlayer?.x._tag).toBe("Some");
      if (movedPlayer?.x._tag === "Some") {
        expect(movedPlayer.x.value).toBeGreaterThan(initialPlayer?.x ?? 0);
      }
    }
  });

  it("rejects malformed BR frames without refreshing heartbeat", async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    let nowMs = Date.now();
    const room = await initRoom(state, makeEnv(), { now: () => nowMs });
    const server = await connectPlayer(room, state, "room-1", "player-1");
    const before = (await state.storage.get<RoomStorage>(STORAGE_KEY))?.players["player-1"]?.lastHeartbeatAt;

    nowMs += 1_000;
    await room.webSocketMessage(server as WebSocket, new Uint8Array([0xc1]).buffer);

    const after = (await state.storage.get<RoomStorage>(STORAGE_KEY))?.players["player-1"]?.lastHeartbeatAt;
    const error = decodeBattleRoyaleMessages(server).find((message) => message._tag === "Error");
    expect(error?._tag).toBe("Error");
    expect(server.closeCode).toBe(1003);
    expect(server.closeReason).toBe("invalid frame");
    expect(after).toBe(before);
  });

  it("refreshes heartbeat only after accepted BR heartbeat frames", async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    let nowMs = Date.now();
    const room = await initRoom(state, makeEnv(), { now: () => nowMs });
    const server = await connectPlayer(room, state, "room-1", "player-1");
    const before = (await state.storage.get<RoomStorage>(STORAGE_KEY))?.players["player-1"]?.lastHeartbeatAt;

    nowMs += 1_000;
    await room.webSocketMessage(server as WebSocket, encodeBrHeartbeatFrame(1));

    const after = (await state.storage.get<RoomStorage>(STORAGE_KEY))?.players["player-1"]?.lastHeartbeatAt;
    expect(server.closeCode).toBeNull();
    expect(after).not.toBe(before);
  });

  it("sends the current BR baseline to late joiners", async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    const room = await initRoom(state, makeEnv());
    const first = await connectPlayerViaFetch(room, state, "room-1", "player-1");
    const initialWelcome = decodeBattleRoyaleMessages(first).find((message) => message._tag === "WelcomeSnapshot");
    if (initialWelcome?._tag !== "WelcomeSnapshot") {
      throw new Error("expected initial welcome snapshot");
    }
    const initialPlayer = initialWelcome.players.find((player) => player.id === "player-1");
    expect(initialPlayer).toBeDefined();

    await room.webSocketMessage(first as WebSocket, encodeBrInputFrame({ tick: 1, seq: 1, dir: 0 }));
    await room.alarm();

    const late = await connectPlayerViaFetch(room, state, "room-1", "player-2");
    const lateWelcome = decodeBattleRoyaleMessages(late).find((message) => message._tag === "WelcomeSnapshot");
    expect(lateWelcome?._tag).toBe("WelcomeSnapshot");
    if (lateWelcome?._tag === "WelcomeSnapshot") {
      const currentPlayer = lateWelcome.players.find((player) => player.id === "player-1");
      expect(lateWelcome.tick).toBeGreaterThan(initialWelcome.tick);
      expect(currentPlayer?.x).toBeGreaterThan(initialPlayer?.x ?? 0);
    }
  });

  it("coalesces input floods to the latest queued frame per player", async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    const room = await initRoom(state, makeEnv());
    const server = await connectPlayerViaFetch(room, state, "room-1", "player-1");
    const welcome = decodeBattleRoyaleMessages(server).find((message) => message._tag === "WelcomeSnapshot");
    if (welcome?._tag !== "WelcomeSnapshot") {
      throw new Error("expected BR welcome snapshot");
    }
    const initialPlayer = welcome.players.find((player) => player.id === "player-1");
    expect(initialPlayer).toBeDefined();

    for (let seq = 1; seq <= 64; seq += 1) {
      await room.webSocketMessage(server as WebSocket, encodeBrInputFrame({ tick: 1, seq, dir: seq === 64 ? 4 : 0 }));
    }

    expect(queuedInputCount(room)).toBe(MAX_QUEUED_INPUTS_PER_PLAYER);
    await room.alarm();
    expect(queuedInputCount(room)).toBe(0);

    const delta = decodeBattleRoyaleMessages(server).find(
      (message) =>
        message._tag === "DeltaSnapshot" && message.updated.some((player) => player.id === "player-1"),
    );
    expect(delta?._tag).toBe("DeltaSnapshot");
    if (delta?._tag === "DeltaSnapshot") {
      const movedPlayer = delta.updated.find((player) => player.id === "player-1");
      expect(movedPlayer?.x._tag).toBe("Some");
      if (movedPlayer?.x._tag === "Some") {
        expect(movedPlayer.x.value).toBeLessThan(initialPlayer?.x ?? 0);
      }
    }
  });

  it("invokes plugin onTick and fans out plugin messages", async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    let tickCalls = 0;
    const pluginHostFactory = (emit: (message: RuntimeMessage) => void): PluginHostApi => {
      const host = makePluginHost();
      const plugin: RuntimePlugin = {
        id: "fixture-plugin",
        onTick: () =>
          Effect.sync(() => {
            tickCalls += 1;
            emit(new ServerNotice({ message: "plugin tick" }));
          }),
      };
      void Effect.runSync(host.register(plugin));
      return host;
    };
    const room = await initRoom(state, makeEnv(), { createPluginHost: pluginHostFactory });
    const server = await connectPlayer(room, state, "room-1", "player-a");
    await room.alarm();
    expect(tickCalls).toBeGreaterThan(0);
    const notice = server.sent
      .map((frame) => decodeMessage(new Uint8Array(frame)))
      .find((message) => message._tag === "ServerNotice");
    expect(notice?._tag).toBe("ServerNotice");
  });

  it("broadcasts to three connected clients", async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    const room = await initRoom(state, makeEnv());
    const sockets = await Promise.all([
      connectPlayer(room, state, "room-1", "player-a"),
      connectPlayer(room, state, "room-1", "player-b"),
      connectPlayer(room, state, "room-1", "player-c"),
    ]);
    await room.alarm();
    for (const socket of sockets) {
      const delta = decodeBattleRoyaleMessages(socket).some((message) => message._tag === "DeltaSnapshot");
      expect(delta).toBe(true);
    }
  });
});

describe("PlaytestRoom alarm cadence", () => {
  it("schedules repeated alarms while running", async () => {
    installWorkerGlobals();
    const state = createFakeDurableObjectState();
    const room = await initRoom(state, makeEnv());
    await connectPlayer(room, state, "room-1", "player-a");
    await room.alarm();
    const firstTick = (await state.storage.get<RoomStorage>(STORAGE_KEY))?.tick ?? 0;
    await state.advanceTime(60);
    await room.alarm();
    const secondTick = (await state.storage.get<RoomStorage>(STORAGE_KEY))?.tick ?? 0;
    expect(secondTick).toBeGreaterThan(firstTick);
  });
});
