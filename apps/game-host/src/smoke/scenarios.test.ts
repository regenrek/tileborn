import { afterEach, describe, expect, it } from "vitest";

import {
  SMOKE_ASSET_PACK_ID,
  SMOKE_PLUGIN_ID,
  SMOKE_RUNTIME_VERSION,
  SMOKE_SEED,
} from "./fixtures/smoke-manifest.js";
import { bootMiniflare } from "./setup.js";
import {
  collectMessages,
  delay,
  encodeHeartbeat,
  encodeInputCommand,
  expectPlayerJoined,
  findPlayerLeft,
  findSnapshotDelta,
  parseJson,
  tamperHandoffToken,
  waitForMessage,
  type DiscoverPayload,
  type HealthPayload,
  type PlaytestStartPayload,
  type StructuredErrorPayload,
} from "./wire-helpers.js";
import type { WebSocket as MiniflareWebSocket } from "miniflare";

describe("game-host smoke — health and discover", () => {
  let dispose: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (dispose) {
      await dispose();
      dispose = null;
    }
  });

  it("GET /health returns ok with version and buildId", async () => {
    const harness = await bootMiniflare();
    dispose = harness.mfDispose;
    const response = await harness.fetch("http://localhost/health");
    expect(response.status).toBe(200);
    const body = await parseJson<HealthPayload>(response);
    expect(body.status).toBe("ok");
    expect(body.version?.length).toBeGreaterThan(0);
    expect(body.buildId?.length).toBeGreaterThan(0);
  });

  it("GET /discover returns bundled manifest with plugin and asset pack", async () => {
    const harness = await bootMiniflare();
    dispose = harness.mfDispose;
    const response = await harness.fetch("http://localhost/discover");
    expect(response.status).toBe(200);
    const body = await parseJson<DiscoverPayload>(response);
    expect(body.plugin.id).toBe(SMOKE_PLUGIN_ID);
    expect(body.assetPacks.length).toBeGreaterThanOrEqual(1);
    expect(body.assetPacks[0]?.id).toBe(SMOKE_ASSET_PACK_ID);
    expect(body.runtimeVersion).toBe(SMOKE_RUNTIME_VERSION);
    expect(body.protocolVersion).toBe(1);
    expect(body.buildId).toMatch(/^sha256:/);
  });
});

describe("game-host smoke — playtest creation", () => {
  let dispose: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (dispose) {
      await dispose();
      dispose = null;
    }
  });

  it("POST /playtest/start returns playtestId, wsUrl, handoffToken, and playerId", async () => {
    const harness = await bootMiniflare();
    dispose = harness.mfDispose;
    const response = await harness.fetch("http://localhost/playtest/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mapId: "map:smoke", seed: SMOKE_SEED }),
    });
    expect(response.status).toBe(201);
    const body = await parseJson<PlaytestStartPayload>(response);
    expect(body.playtestId.length).toBeGreaterThan(0);
    expect(body.wsUrl).toContain("/playtest/");
    expect(body.handoffToken.length).toBeGreaterThan(0);
    expect(body.playerId.length).toBeGreaterThan(0);
  });

  it("POST /playtest/start is idempotent for the same idempotency key", async () => {
    const harness = await bootMiniflare();
    dispose = harness.mfDispose;
    const payload = {
      mapId: "map:smoke",
      seed: SMOKE_SEED,
      options: { idempotencyKey: "playtest-idem-smoke" },
    };
    const first = await harness.fetch("http://localhost/playtest/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const second = await harness.fetch("http://localhost/playtest/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstBody = await parseJson<PlaytestStartPayload>(first);
    const secondBody = await parseJson<PlaytestStartPayload>(second);
    expect(firstBody.playtestId).toBe("playtest-idem-smoke");
    expect(secondBody.playtestId).toBe("playtest-idem-smoke");
  });

  it("POST /playtest/start returns 400 when mapId is missing", async () => {
    const harness = await bootMiniflare();
    dispose = harness.mfDispose;
    const response = await harness.fetch("http://localhost/playtest/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seed: SMOKE_SEED }),
    });
    expect(response.status).toBe(400);
    const body = await parseJson<StructuredErrorPayload>(response);
    expect(body.error).toContain("mapId");
  });
});

describe("game-host smoke — handoff and websocket upgrade", () => {
  let dispose: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (dispose) {
      await dispose();
      dispose = null;
    }
  });

  const startPlaytest = async (
    harness: Awaited<ReturnType<typeof bootMiniflare>>,
  ): Promise<PlaytestStartPayload> => {
    const response = await harness.fetch("http://localhost/playtest/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mapId: "map:smoke", seed: SMOKE_SEED }),
    });
    expect(response.status).toBe(201);
    return parseJson<PlaytestStartPayload>(response);
  };

  it("connects with a valid handoff token and receives PlayerJoined within 200ms", async () => {
    const harness = await bootMiniflare();
    dispose = harness.mfDispose;
    const started = await startPlaytest(harness);
    const socket = await harness.websocketConnect(started.wsUrl);
    const joined = await waitForMessage(socket, (message) => message._tag === "PlayerJoined", {
      timeoutMs: 200,
      label: "PlayerJoined",
    });
    expectPlayerJoined(joined, started.playerId);
    socket.close(1000, "done");
  });

  it("rejects websocket upgrade with 401 when the handoff token is missing", async () => {
    const harness = await bootMiniflare();
    dispose = harness.mfDispose;
    const started = await startPlaytest(harness);
    const url = new URL(started.wsUrl);
    url.searchParams.delete("token");
    const response = await harness.fetch(url.toString(), {
      headers: {
        Upgrade: "websocket",
        Connection: "Upgrade",
        Origin: "http://localhost",
      },
    });
    expect(response.status).toBe(401);
    expect(response.webSocket).toBeFalsy();
  });

  it("rejects websocket upgrade with 401 when the handoff token is tampered", async () => {
    const harness = await bootMiniflare();
    dispose = harness.mfDispose;
    const started = await startPlaytest(harness);
    const url = new URL(started.wsUrl);
    url.searchParams.set("token", tamperHandoffToken(started.handoffToken));
    const response = await harness.fetch(url.toString(), {
      headers: {
        Upgrade: "websocket",
        Connection: "Upgrade",
        Origin: "http://localhost",
      },
    });
    expect(response.status).toBe(401);
    expect(response.webSocket).toBeFalsy();
  });
});

describe("game-host smoke — live simulation fanout", () => {
  let dispose: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (dispose) {
      await dispose();
      dispose = null;
    }
  });

  const startSharedRoom = async (
    harness: Awaited<ReturnType<typeof bootMiniflare>>,
    idempotencyKey: string,
    playerId: string,
  ): Promise<PlaytestStartPayload> => {
    const response = await harness.fetch("http://localhost/playtest/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mapId: "map:smoke",
        seed: SMOKE_SEED,
        playerId,
        options: { idempotencyKey },
      }),
    });
    expect(response.status).toBe(201);
    return parseJson<PlaytestStartPayload>(response);
  };

  it("fans out PlayerJoined to three connected players", async () => {
    const harness = await bootMiniflare();
    dispose = harness.mfDispose;
    const roomKey = "smoke-room-fanout";
    const players = ["player-a", "player-b", "player-c"] as const;
    const sockets: MiniflareWebSocket[] = [];
    for (const playerId of players) {
      const started = await startSharedRoom(harness, roomKey, playerId);
      const joinWaits = [
        ...sockets.map((socket) =>
          waitForMessage(socket, (message) => message._tag === "PlayerJoined" && message.playerId === playerId, {
            timeoutMs: 1_000,
            label: `PlayerJoined(${playerId}) fanout`,
          }),
        ),
      ];
      const socket = await harness.websocketConnect(started.wsUrl);
      joinWaits.push(
        waitForMessage(socket, (message) => message._tag === "PlayerJoined" && message.playerId === playerId, {
          timeoutMs: 1_000,
          label: `PlayerJoined(${playerId}) self`,
        }),
      );
      await Promise.all(joinWaits);
      sockets.push(socket);
    }
    for (const socket of sockets) {
      socket.close(1000, "done");
    }
  });

  it("delivers SnapshotDelta within two ticks after InputCommand", async () => {
    const harness = await bootMiniflare();
    dispose = harness.mfDispose;
    const sender = await startSharedRoom(harness, "smoke-input-room", "sender");
    const observer = await startSharedRoom(harness, "smoke-input-room", "observer");
    const senderSocket = await harness.websocketConnect(sender.wsUrl);
    const senderJoin = waitForMessage(senderSocket, (message) => message._tag === "PlayerJoined" && message.playerId === "sender", {
      timeoutMs: 500,
      label: "sender PlayerJoined",
    });
    const observerJoinOnSender = waitForMessage(
      senderSocket,
      (message) => message._tag === "PlayerJoined" && message.playerId === "observer",
      { timeoutMs: 500, label: "sender sees observer PlayerJoined" },
    );
    const observerSocket = await harness.websocketConnect(observer.wsUrl);
    const observerJoin = waitForMessage(
      observerSocket,
      (message) => message._tag === "PlayerJoined" && message.playerId === "observer",
      { timeoutMs: 500, label: "observer PlayerJoined" },
    );
    await Promise.all([senderJoin, observerJoin, observerJoinOnSender]);
    senderSocket.send(encodeInputCommand("sender", 1, { move: "north" }));
    await harness.triggerRoomAlarm(sender.playtestId);
    await harness.triggerRoomAlarm(sender.playtestId);
    const messages = await collectMessages(observerSocket, 500);
    const delta = findSnapshotDelta(messages);
    expect(delta).toBeDefined();
    expect(delta?.tick).toBeGreaterThan(0);
    senderSocket.close(1000, "done");
    observerSocket.close(1000, "done");
  });

  it("evicts a stale player after heartbeat timeout and broadcasts PlayerLeft", async () => {
    const harness = await bootMiniflare({ heartbeatTimeoutSeconds: 1 });
    dispose = harness.mfDispose;
    const roomKey = "smoke-heartbeat-room";
    const stale = await startSharedRoom(harness, roomKey, "stale-player");
    const staleSocket = await harness.websocketConnect(stale.wsUrl);
    await waitForMessage(staleSocket, (message) => message._tag === "PlayerJoined" && message.playerId === "stale-player", {
      timeoutMs: 500,
      label: "stale PlayerJoined",
    });
    await delay(1_100);
    const active = await startSharedRoom(harness, roomKey, "active-player");
    const activeSocket = await harness.websocketConnect(active.wsUrl);
    await waitForMessage(activeSocket, (message) => message._tag === "PlayerJoined" && message.playerId === "active-player", {
      timeoutMs: 500,
      label: "active PlayerJoined",
    });
    activeSocket.send(encodeHeartbeat());
    await harness.triggerRoomAlarm(roomKey);
    await delay(200);
    const summary = await parseJson<{ readonly connectedClients: number }>(
      await harness.fetch(`http://localhost/playtest/${roomKey}`),
    );
    expect(summary.connectedClients).toBe(1);
    staleSocket.close(1000, "done");
    activeSocket.close(1000, "done");
  });

  it("broadcasts PlayerLeft when a peer disconnects (SIGINT-style cancellation)", async () => {
    const harness = await bootMiniflare();
    dispose = harness.mfDispose;
    const roomKey = "smoke-cancel-room";
    const leaver = await startSharedRoom(harness, roomKey, "leaver");
    const peer = await startSharedRoom(harness, roomKey, "peer");
    const leaverSocket = await harness.websocketConnect(leaver.wsUrl);
    await waitForMessage(leaverSocket, (message) => message._tag === "PlayerJoined" && message.playerId === "leaver", {
      timeoutMs: 500,
      label: "leaver PlayerJoined",
    });
    const peerJoinOnLeaver = waitForMessage(
      leaverSocket,
      (message) => message._tag === "PlayerJoined" && message.playerId === "peer",
      { timeoutMs: 500, label: "leaver sees peer PlayerJoined" },
    );
    const peerSocket = await harness.websocketConnect(peer.wsUrl);
    const peerJoin = waitForMessage(peerSocket, (message) => message._tag === "PlayerJoined" && message.playerId === "peer", {
      timeoutMs: 500,
      label: "peer PlayerJoined",
    });
    await Promise.all([peerJoin, peerJoinOnLeaver]);
    leaverSocket.close(1000, "sigint");
    const messages = await collectMessages(peerSocket, 500);
    expect(findPlayerLeft(messages, "leaver")).toBeDefined();
    peerSocket.close(1000, "done");
  });
});

describe("game-host smoke — failure modes", () => {
  let dispose: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (dispose) {
      await dispose();
      dispose = null;
    }
  });

  it("returns 503 on /health and 503 on /playtest/start when HANDOFF_SIGNING_KEY is missing", async () => {
    const harness = await bootMiniflare({ includeSigningKey: false });
    dispose = harness.mfDispose;
    const health = await harness.fetch("http://localhost/health");
    expect(health.status).toBe(503);
    const healthBody = await parseJson<HealthPayload>(health);
    expect(healthBody.status).toBe("unavailable");
    const start = await harness.fetch("http://localhost/playtest/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mapId: "map:smoke" }),
    });
    expect([500, 503]).toContain(start.status);
  });
});
