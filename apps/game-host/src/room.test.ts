import { describe, expect, it } from "vitest";

import {
  broadcastBinaryFrame,
  createRoomMeta,
  parsePlaytestInitBody,
  toPlaytestSummary,
  type BinarySocket,
} from "./room.js";
import { installWorkerGlobals } from "./test-helpers/do-fake.js";

const TEST_KEY = "test-handoff-signing-key-32-bytes!!";

describe("PlaytestRoom stub helpers", () => {
  it("parsePlaytestInitBody requires mapId", () => {
    expect(() => parsePlaytestInitBody("{}")).toThrow(/mapId/);
    const parsed = parsePlaytestInitBody('{"mapId":"map:1","seed":42}');
    expect(parsed.mapId).toBe("map:1");
    expect(parsed.seed).toBe(42);
  });

  it("createRoomMeta stores mapId and timestamps", () => {
    const meta = createRoomMeta("map:fixture", "seed-a");
    expect(meta.mapId).toBe("map:fixture");
    expect(meta.seed).toBe("seed-a");
    expect(meta.lastTickAt).toBeNull();
    expect(meta.createdAt.length).toBeGreaterThan(0);
  });

  it("toPlaytestSummary exposes connected client count", () => {
    const summary = toPlaytestSummary("id-1", createRoomMeta("map:1"), 2);
    expect(summary.playtestId).toBe("id-1");
    expect(summary.connectedClients).toBe(2);
  });

  it("broadcastBinaryFrame sends binary payload to every socket", () => {
    const sent: ArrayBuffer[] = [];
    const sockets: BinarySocket[] = [
      { readyState: WebSocket.OPEN, send: (data: ArrayBuffer) => { sent.push(data); } },
      { readyState: WebSocket.OPEN, send: (data: ArrayBuffer) => { sent.push(data); } },
      { readyState: WebSocket.CLOSED, send: () => undefined },
    ];
    const payload = new Uint8Array([1, 2, 3]).buffer;
    broadcastBinaryFrame(sockets, payload);
    expect(sent).toHaveLength(2);
    expect(new Uint8Array(sent[0] ?? new ArrayBuffer(0))).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe("PlaytestRoom DO fake", () => {
  it("accepts websocket upgrade path via fetch handler contract", async () => {
    installWorkerGlobals();
    const storage = new Map<string, unknown>();
    const state = {
      storage: {
        get: async <T>(key: string) => storage.get(key) as T | undefined,
        put: async (key: string, value: unknown) => {
          storage.set(key, value);
        },
        delete: async (key: string) => {
          storage.delete(key);
        },
        list: async () => ({ keys: [], cursor: "", list_complete: true }),
        setAlarm: async () => undefined,
        getAlarm: async () => null,
        deleteAlarm: async () => undefined,
      },
      acceptWebSocket: (ws: WebSocket) => {
        void ws;
      },
      getWebSockets: () => [] as WebSocket[],
      waitUntil: (promise: Promise<unknown>) => {
        void promise;
      },
      blockConcurrencyWhile: async <T>(callback: () => Promise<T>) => callback(),
    } as DurableObjectState;

    const { PlaytestRoom } = await import("./room.js");
    const room = new PlaytestRoom(state, {
      HANDOFF_SIGNING_KEY: TEST_KEY,
      PLAYTEST_ROOM: {
        idFromName: (name: string) => ({ toString: () => name }) as DurableObjectId,
        get: () => ({ fetch: async () => new Response("unused") }),
      },
    });
    const init = await room.fetch(
      new Request("https://do/playtest/init", {
        method: "POST",
        body: JSON.stringify({ mapId: "map:fixture" }),
      }),
    );
    expect(init.status).toBe(200);
    const summary = await room.fetch(new Request("https://do/?playtestId=abc"));
    expect(summary.status).toBe(200);
    const body = (await summary.json()) as { readonly mapId: string };
    expect(body.mapId).toBe("map:fixture");
  });
});
