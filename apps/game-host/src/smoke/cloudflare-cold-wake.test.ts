import { env, evictDurableObject, runDurableObjectAlarm, SELF } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';

import { BattleRoyaleProtocol } from '@tileborne/ipc-contracts';

import {
  encodeHeartbeat,
  encodeInputCommand,
  encodeSnapshotAck,
  parseJson,
  type PlaytestStartPayload,
} from './wire-helpers.js';
import { ROOM_BACKPRESSURE_CLOSE_CODE, ROOM_REPLACED_CLOSE_CODE } from '../rooms/room-config.js';
import {
  MAX_UNACKED_SNAPSHOT_TICKS_BEFORE_DROP,
  MAX_UNACKED_SNAPSHOT_TICKS_BEFORE_RESYNC,
  type ClientTransportStats,
} from '../rooms/room-transport.js';

const expectedPlayerIds = ['player-1', 'player-2'] as const;

type SmokeReconstructionPayload = {
  readonly roomId: string;
  readonly constructionSequence: number;
  readonly tick: number;
  readonly acceptedSockets: readonly {
    readonly readyState: number;
    readonly open: boolean;
    readonly attachment: { readonly playerId: string; readonly socketId: string } | null;
  }[];
  readonly connectedPlayers: readonly string[];
  readonly transportClients: readonly ClientTransportStats[];
  readonly playerState: Record<
    string,
    {
      readonly lastHeartbeatAt: string;
      readonly lastSeenAt: string | null;
      readonly presenceStatus: string | null;
    }
  >;
  readonly error?: string;
};

type SmokeDropParticipantSocketPayload = {
  readonly roomId: string;
  readonly playerId: string;
  readonly socketId: string;
  readonly closeCode: number;
  readonly reconnectEligible: boolean;
  readonly connectedPlayers: readonly string[];
};

type RoomBindingEnv = {
  readonly PLAYTEST_ROOM: DurableObjectNamespace;
};

type ActiveRoom = {
  readonly roomId: string;
  readonly stub: DurableObjectStub;
  readonly firstSocket: WebSocket;
  readonly secondSocket: WebSocket;
  readonly firstReconnectToken: string;
  readonly secondReconnectToken: string;
  readonly beforeWake: SmokeReconstructionPayload;
  readonly playerTwoBeforeWake: PlayerMovementBaseline;
  readonly beforeWakeTick: number;
};

type PlayerMovementBaseline = {
  readonly y: number;
};

const testEnv = env as RoomBindingEnv;
const createdRoomIds = new Set<string>();

const fetchWorker = (path: string, init?: RequestInit): Promise<Response> =>
  SELF.fetch(`https://tileborne-smoke.test${path}`, init);

const postJson = (path: string, body: unknown): Promise<Response> =>
  fetchWorker(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const drainBody = async (response: Response): Promise<void> => {
  await response.text();
};

const createRoom = async (roomId: string): Promise<void> => {
  const response = await postJson('/rooms/create', {
    mapId: 'map:smoke',
    seed: 'smoke-seed',
    options: { idempotencyKey: roomId, minReadyPlayers: 2 },
  });
  expect(response.status).toBe(201);
  await drainBody(response);
  createdRoomIds.add(roomId);
};

const joinPlayer = async (roomId: string, playerId: string): Promise<PlaytestStartPayload> => {
  const response = await postJson('/playtest/start', {
    mapId: 'map:smoke',
    seed: 'smoke-seed',
    playerId,
    options: { idempotencyKey: roomId },
  });
  expect(response.status).toBe(201);
  return parseJson<PlaytestStartPayload>(response);
};

const connectPlayer = async (roomId: string, joined: PlaytestStartPayload): Promise<WebSocket> => {
  const response = await fetchWorker(
    `/rooms/${encodeURIComponent(roomId)}/connect?playerId=${encodeURIComponent(
      joined.playerId,
    )}&token=${encodeURIComponent(joined.handoffToken)}`,
    { headers: { Upgrade: 'websocket' } },
  );
  expect([101, 200]).toContain(response.status);
  expect(response.webSocket).toBeTruthy();
  const socket = response.webSocket!;
  socket.accept();
  expect(socket.readyState).toBe(WebSocket.OPEN);
  return socket;
};

const readyPlayer = async (
  roomId: string,
  playerId: string,
  reconnectToken: string,
): Promise<void> => {
  const response = await postJson(`/lobbies/${encodeURIComponent(roomId)}/ready`, {
    playerId,
    ready: true,
    reconnectToken,
  });
  expect(response.status).toBe(200);
  await drainBody(response);
};

const fetchSmokeReconstruction = async (
  roomId: string,
): Promise<{ readonly status: number } & SmokeReconstructionPayload> => {
  const response = await fetchWorker(`/__smoke/rooms/${encodeURIComponent(roomId)}/reconstruction`);
  const payload = (await response.json()) as SmokeReconstructionPayload;
  return { ...payload, status: response.status };
};

const fetchSmokeHibernationState = async (
  roomId: string,
): Promise<{ readonly status: number } & SmokeReconstructionPayload> => {
  const response = await fetchWorker(
    `/__smoke/rooms/${encodeURIComponent(roomId)}/hibernation-state`,
  );
  const payload = (await response.json()) as SmokeReconstructionPayload;
  return { ...payload, status: response.status };
};

const allowHibernation = async (roomId: string): Promise<void> => {
  const response = await fetchWorker(
    `/__smoke/rooms/${encodeURIComponent(roomId)}/allow-hibernation`,
    { method: 'POST' },
  );
  expect(response.status).toBe(200);
  await drainBody(response);
};

const failNextInitialization = async (roomId: string): Promise<void> => {
  const response = await fetchWorker(
    `/__smoke/rooms/${encodeURIComponent(roomId)}/fail-next-initialization`,
    { method: 'POST' },
  );
  expect(response.status).toBe(200);
  await drainBody(response);
};

const dropParticipantSocket = async (
  roomId: string,
  playerId: string,
): Promise<{ readonly status: number } & SmokeDropParticipantSocketPayload> => {
  const response = await fetchWorker(
    `/__smoke/rooms/${encodeURIComponent(roomId)}/drop-participant-socket`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId }),
    },
  );
  const payload = (await response.json()) as SmokeDropParticipantSocketPayload;
  return { ...payload, status: response.status };
};

const roomStub = (roomId: string): DurableObjectStub =>
  testEnv.PLAYTEST_ROOM.get(testEnv.PLAYTEST_ROOM.idFromName(roomId));

const acceptedPlayerIds = (payload: SmokeReconstructionPayload): readonly string[] =>
  payload.acceptedSockets
    .map((socket) => socket.attachment?.playerId)
    .filter((playerId): playerId is string => playerId !== undefined)
    .sort();

const openAcceptedPlayerIds = (payload: SmokeReconstructionPayload): readonly string[] =>
  payload.acceptedSockets
    .filter((socket) => socket.open)
    .map((socket) => socket.attachment?.playerId)
    .filter((playerId): playerId is string => playerId !== undefined)
    .sort();

const expectOpenConnectedPlayers = (
  payload: SmokeReconstructionPayload,
  playerIds: readonly string[],
): void => {
  const detail = JSON.stringify(payload);
  expect(openAcceptedPlayerIds(payload), detail).toEqual(playerIds);
  expect(payload.connectedPlayers, detail).toEqual(playerIds);
};

const clientTransport = (
  payload: SmokeReconstructionPayload,
  playerId: string,
): ClientTransportStats => {
  const stats = payload.transportClients.find((client) => client.playerId === playerId);
  expect(stats, JSON.stringify(payload)).toBeDefined();
  return stats!;
};

const decodeServerMessage = (data: unknown): BattleRoyaleProtocol.ServerToClientMessage | null => {
  if (data instanceof ArrayBuffer) {
    return BattleRoyaleProtocol.decodeServerMessage(new Uint8Array(data));
  }
  if (data instanceof Uint8Array) {
    return BattleRoyaleProtocol.decodeServerMessage(data);
  }
  return null;
};

const attachSnapshotAck = (socket: WebSocket): (() => void) => {
  const onMessage = (event: MessageEvent): void => {
    const decoded = decodeServerMessage(event.data);
    if (decoded?._tag === 'WelcomeSnapshot' || decoded?._tag === 'DeltaSnapshot') {
      socket.send(encodeSnapshotAck(decoded.tick));
    }
  };
  socket.addEventListener('message', onMessage);
  return () => {
    socket.removeEventListener('message', onMessage);
  };
};

const waitForDecodedMessage = (
  socket: WebSocket,
  predicate: (message: BattleRoyaleProtocol.ServerToClientMessage) => boolean,
  label: string,
  timeoutMs = 2_000,
): Promise<BattleRoyaleProtocol.ServerToClientMessage> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${label}`));
    }, timeoutMs);
    const cleanup = (): void => {
      clearTimeout(timer);
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('close', onClose);
    };
    const onMessage = (event: MessageEvent): void => {
      const decoded = decodeServerMessage(event.data);
      if (decoded === null || !predicate(decoded)) {
        return;
      }
      cleanup();
      resolve(decoded);
    };
    const onClose = (event: CloseEvent): void => {
      cleanup();
      reject(new Error(`socket closed while waiting for ${label}: ${event.code} ${event.reason}`));
    };
    socket.addEventListener('message', onMessage);
    socket.addEventListener('close', onClose);
  });

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const closeSocket = (socket: WebSocket): Promise<void> =>
  new Promise((resolve, reject) => {
    if (socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('timed out waiting for smoke cleanup WebSocket close'));
    }, 2_000);
    const cleanup = (): void => {
      clearTimeout(timer);
      socket.removeEventListener('close', onClose);
    };
    const onClose = (): void => {
      cleanup();
      resolve();
    };
    socket.addEventListener('close', onClose);
    try {
      socket.close(1000, 'smoke cleanup');
    } catch (error) {
      cleanup();
      if (!(error instanceof Error) || !error.message.includes('already closed')) {
        reject(error);
        return;
      }
      resolve();
    }
  });

const waitForSocketClose = (
  socket: WebSocket,
  label: string,
  timeoutMs = 5_000,
): Promise<{ readonly code: number; readonly reason: string; readonly wasClean: boolean }> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${label} close`));
    }, timeoutMs);
    const cleanup = (): void => {
      clearTimeout(timer);
      socket.removeEventListener('close', onClose);
    };
    const onClose = (event: CloseEvent): void => {
      cleanup();
      resolve({ code: event.code, reason: event.reason, wasClean: event.wasClean });
    };
    socket.addEventListener('close', onClose);
  });

const playerFromWelcome = (
  message: BattleRoyaleProtocol.ServerToClientMessage,
  playerId: string,
): BattleRoyaleProtocol.PlayerSnapshot | null => {
  if (message._tag !== 'WelcomeSnapshot') {
    return null;
  }
  return message.players.find((player) => player.id === playerId) ?? null;
};

const someNumberValue = (value: {
  readonly _tag: string;
  readonly value?: number;
}): number | null =>
  value._tag === 'Some' && typeof value.value === 'number' ? value.value : null;

const playerMovementBaselineFromDelta = (
  message: BattleRoyaleProtocol.ServerToClientMessage,
  playerId: string,
): PlayerMovementBaseline | null => {
  if (message._tag !== 'DeltaSnapshot') {
    return null;
  }
  const update = message.updated.find((player) => player.id === playerId);
  if (update === undefined) {
    return null;
  }
  const y = someNumberValue(update.y);
  return y === null ? null : { y };
};

const expectDeltaSnapshot = (
  message: BattleRoyaleProtocol.ServerToClientMessage,
): BattleRoyaleProtocol.DeltaSnapshot => {
  expect(message._tag).toBe('DeltaSnapshot');
  if (message._tag !== 'DeltaSnapshot') {
    throw new Error(`expected DeltaSnapshot, got ${message._tag}`);
  }
  return message;
};

const playerUpdateMovesSouthFrom = (
  message: BattleRoyaleProtocol.ServerToClientMessage,
  playerId: string,
  before: PlayerMovementBaseline,
): boolean => {
  if (message._tag !== 'DeltaSnapshot') {
    return false;
  }
  const update = message.updated.find((player) => player.id === playerId);
  if (update === undefined) {
    return false;
  }
  const updatedY = someNumberValue(update.y);
  return updatedY !== null && updatedY > before.y;
};

const expectPlayerStateAdvanced = (
  before: SmokeReconstructionPayload,
  after: SmokeReconstructionPayload,
  playerId: string,
): void => {
  const beforeState = before.playerState[playerId];
  const afterState = after.playerState[playerId];
  expect(beforeState, JSON.stringify(before)).toBeDefined();
  expect(afterState, JSON.stringify(after)).toBeDefined();
  expect(Date.parse(afterState!.lastHeartbeatAt)).toBeGreaterThan(
    Date.parse(beforeState!.lastHeartbeatAt),
  );
  expect(Date.parse(afterState!.lastSeenAt ?? '')).toBeGreaterThan(
    Date.parse(beforeState!.lastSeenAt ?? beforeState!.lastHeartbeatAt),
  );
  expect(afterState!.presenceStatus).toBe('connected');
};

const expectOriginalSocketsCarryPostReconstructionTraffic = async (
  stub: DurableObjectStub,
  roomId: string,
  firstSocket: WebSocket,
  secondSocket: WebSocket,
  beforeWake: SmokeReconstructionPayload,
  playerTwoBeforeWake: PlayerMovementBaseline,
  beforeWakeTick: number,
): Promise<void> => {
  expect(firstSocket.readyState).toBe(WebSocket.OPEN);
  expect(secondSocket.readyState).toBe(WebSocket.OPEN);
  const firstDelta = waitForDecodedMessage(
    firstSocket,
    (message) => message._tag === 'DeltaSnapshot' && message.tick > beforeWakeTick,
    'post-wake delta on original player-1 socket',
    5_000,
  );
  const secondPlayerDelta = waitForDecodedMessage(
    secondSocket,
    (message) =>
      message._tag === 'DeltaSnapshot' &&
      message.tick > beforeWakeTick &&
      playerUpdateMovesSouthFrom(message, 'player-2', playerTwoBeforeWake),
    'post-wake south movement delta on original player-2 socket',
    5_000,
  );

  await delay(5);
  firstSocket.send(encodeHeartbeat());
  secondSocket.send(encodeInputCommand('player-2', 1, { move: 'south' }));
  const postWakeDeltas = Promise.all([firstDelta, secondPlayerDelta]);
  let postWakeSettled = false;
  void postWakeDeltas.then(
    () => {
      postWakeSettled = true;
    },
    () => {
      postWakeSettled = true;
    },
  );
  for (let attempt = 0; attempt < 10 && !postWakeSettled; attempt += 1) {
    await runDurableObjectAlarm(stub);
    await delay(10);
  }
  const [firstPostWakeDelta, secondPostWakeDelta] = await postWakeDeltas;
  expect(firstPostWakeDelta).toMatchObject({ _tag: 'DeltaSnapshot' });
  expect(secondPostWakeDelta).toMatchObject({ _tag: 'DeltaSnapshot' });
  const afterWakeInput = await fetchSmokeReconstruction(roomId);
  expect(afterWakeInput.status).toBe(200);
  expectPlayerStateAdvanced(beforeWake, afterWakeInput, 'player-1');
  expect(firstSocket.readyState).toBe(WebSocket.OPEN);
  expect(secondSocket.readyState).toBe(WebSocket.OPEN);
};

const expectPostWakeReplacementReconnect = async (setup: ActiveRoom): Promise<WebSocket> => {
  const predecessorClose = waitForSocketClose(
    setup.secondSocket,
    'post-wake replaced player-2 predecessor',
  );
  const replacementJoin = await joinPlayer(setup.roomId, 'player-2');
  const replacementSocket = await connectPlayer(setup.roomId, replacementJoin);
  await waitForDecodedMessage(
    replacementSocket,
    (message) => playerFromWelcome(message, 'player-2') !== null,
    'post-wake replacement player-2 WelcomeSnapshot',
    5_000,
  );

  await expect(predecessorClose).resolves.toMatchObject({
    code: ROOM_REPLACED_CLOSE_CODE,
    reason: 'player reconnected',
  });
  const afterPredecessorClose = await fetchSmokeReconstruction(setup.roomId);
  expect(afterPredecessorClose.status).toBe(200);
  expectOpenConnectedPlayers(afterPredecessorClose, expectedPlayerIds);

  const successorDelta = waitForDecodedMessage(
    replacementSocket,
    (message) =>
      message._tag === 'DeltaSnapshot' &&
      message.tick > setup.beforeWakeTick &&
      playerUpdateMovesSouthFrom(message, 'player-2', setup.playerTwoBeforeWake),
    'post-wake replacement player-2 DeltaSnapshot',
    5_000,
  );
  replacementSocket.send(encodeInputCommand('player-2', 2, { move: 'south' }));
  let successorSettled = false;
  void successorDelta.then(
    () => {
      successorSettled = true;
    },
    () => {
      successorSettled = true;
    },
  );
  for (let attempt = 0; attempt < 10 && !successorSettled; attempt += 1) {
    await runDurableObjectAlarm(setup.stub);
    await delay(10);
  }
  await successorDelta;

  const afterSuccessorTraffic = await fetchSmokeReconstruction(setup.roomId);
  expect(afterSuccessorTraffic.status).toBe(200);
  expectOpenConnectedPlayers(afterSuccessorTraffic, expectedPlayerIds);
  expectPlayerStateAdvanced(setup.beforeWake, afterSuccessorTraffic, 'player-2');
  expect(replacementSocket.readyState).toBe(WebSocket.OPEN);

  return replacementSocket;
};

const expectClientInitiatedCloseMirrors = async (
  socket: WebSocket,
  code: number,
  reason: string,
  label: string,
): Promise<void> => {
  const closed = waitForSocketClose(socket, label);
  socket.close(code, reason);
  await expect(closed).resolves.toMatchObject({ code, reason });
};

const expectPostWakeTransportBounds = async (
  stub: DurableObjectStub,
  roomId: string,
  ackingSocket: WebSocket,
  laggingSocket: WebSocket,
  beforeWakeTick: number,
): Promise<void> => {
  const detachAck = attachSnapshotAck(ackingSocket);
  try {
    const ackingDelta = waitForDecodedMessage(
      ackingSocket,
      (message) => message._tag === 'DeltaSnapshot' && message.tick > beforeWakeTick,
      'acknowledged post-wake DeltaSnapshot',
      5_000,
    );
    ackingSocket.send(encodeHeartbeat());
    await runDurableObjectAlarm(stub);
    const acknowledged = await ackingDelta;
    const acknowledgedSnapshot = expectDeltaSnapshot(acknowledged);
    ackingSocket.send(encodeSnapshotAck(acknowledgedSnapshot.tick));

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await runDurableObjectAlarm(stub);
      await delay(10);
      const afterAck = await fetchSmokeReconstruction(roomId);
      const ackingStats = clientTransport(afterAck, 'player-1');
      if (ackingStats.lastAckedSnapshotTick >= acknowledgedSnapshot.tick) {
        break;
      }
      if (attempt === 9) {
        expect(
          ackingStats.lastAckedSnapshotTick,
          JSON.stringify(ackingStats),
        ).toBeGreaterThanOrEqual(acknowledgedSnapshot.tick);
      }
    }

    const laggingClose = waitForSocketClose(laggingSocket, 'lagging post-wake socket');
    for (let tick = 0; tick <= MAX_UNACKED_SNAPSHOT_TICKS_BEFORE_DROP + 1; tick += 1) {
      await runDurableObjectAlarm(stub);
      await delay(1);
    }

    const beforeCloseDrain = await fetchSmokeReconstruction(roomId);
    const laggingStats = clientTransport(beforeCloseDrain, 'player-2');
    expect(laggingStats.pendingSnapshotLagTicks).toBeGreaterThanOrEqual(
      MAX_UNACKED_SNAPSHOT_TICKS_BEFORE_DROP,
    );
    expect(laggingStats.resyncCount).toBeGreaterThan(0);
    expect(laggingStats.droppedOutboundFrames).toBeGreaterThan(0);
    expect(laggingStats.lastAckedSnapshotTick).toBe(-1);
    expect(laggingStats.resyncCount).toBeLessThanOrEqual(
      MAX_UNACKED_SNAPSHOT_TICKS_BEFORE_DROP - MAX_UNACKED_SNAPSHOT_TICKS_BEFORE_RESYNC + 1,
    );
    expect(laggingStats.droppedOutboundFrames).toBeLessThanOrEqual(
      MAX_UNACKED_SNAPSHOT_TICKS_BEFORE_DROP - MAX_UNACKED_SNAPSHOT_TICKS_BEFORE_RESYNC + 2,
    );

    await expect(laggingClose).resolves.toMatchObject({
      code: ROOM_BACKPRESSURE_CLOSE_CODE,
      reason: 'snapshot backpressure',
    });
  } finally {
    detachAck();
  }
};

const waitForRoomSocketDrain = async (roomId: string): Promise<void> => {
  let latest: ({ readonly status: number } & SmokeReconstructionPayload) | null = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    latest = await fetchSmokeHibernationState(roomId);
    if (
      latest.status === 200 &&
      latest.acceptedSockets.every((socket) => !socket.open) &&
      latest.connectedPlayers.length === 0
    ) {
      return;
    }
    await delay(25);
  }
  throw new Error(`room ${roomId} did not drain socket cleanup: ${JSON.stringify(latest)}`);
};

const cleanupActiveRoom = async (setup: ActiveRoom): Promise<void> => {
  await Promise.all([closeSocket(setup.firstSocket), closeSocket(setup.secondSocket)]);
  await waitForRoomSocketDrain(setup.roomId);
};

const initializeActiveRoom = async (roomId: string): Promise<ActiveRoom> => {
  await createRoom(roomId);
  const firstJoin = await joinPlayer(roomId, 'player-1');
  const secondJoin = await joinPlayer(roomId, 'player-2');
  const firstSocket = await connectPlayer(roomId, firstJoin);
  const secondSocket = await connectPlayer(roomId, secondJoin);
  const playerTwoWelcome = await waitForDecodedMessage(
    secondSocket,
    (message) => playerFromWelcome(message, 'player-2') !== null,
    'pre-wake player-2 WelcomeSnapshot',
  );
  const playerTwoBeforeWake = playerFromWelcome(playerTwoWelcome, 'player-2');
  expect(playerTwoBeforeWake).toBeTruthy();
  await readyPlayer(roomId, 'player-1', firstJoin.reconnectToken);
  await readyPlayer(roomId, 'player-2', secondJoin.reconnectToken);
  const stub = roomStub(roomId);
  const playerTwoPreWakeDelta = waitForDecodedMessage(
    secondSocket,
    (message) => playerMovementBaselineFromDelta(message, 'player-2') !== null,
    'pre-wake player-2 DeltaSnapshot',
  );
  secondSocket.send(encodeInputCommand('player-2', 0, { move: 'north' }));
  await runDurableObjectAlarm(stub);
  const playerTwoBeforeWakeDelta = await playerTwoPreWakeDelta;
  const playerTwoBeforeWakeBaseline = playerMovementBaselineFromDelta(
    playerTwoBeforeWakeDelta,
    'player-2',
  );
  expect(playerTwoBeforeWakeBaseline).toBeTruthy();
  const playerTwoBeforeWakeDeltaSnapshot = expectDeltaSnapshot(playerTwoBeforeWakeDelta);
  const beforeWake = await fetchSmokeReconstruction(roomId);
  expect(beforeWake.status).toBe(200);
  expect(acceptedPlayerIds(beforeWake)).toEqual(expectedPlayerIds);
  expectOpenConnectedPlayers(beforeWake, expectedPlayerIds);
  return {
    roomId,
    stub,
    firstSocket,
    secondSocket,
    firstReconnectToken: firstJoin.reconnectToken,
    secondReconnectToken: secondJoin.reconnectToken,
    beforeWake,
    playerTwoBeforeWake: playerTwoBeforeWakeBaseline!,
    beforeWakeTick: playerTwoBeforeWakeDeltaSnapshot.tick,
  };
};

afterEach(async () => {
  try {
    for (const roomId of createdRoomIds) {
      await evictDurableObject(roomStub(roomId));
    }
  } finally {
    createdRoomIds.clear();
  }
});

describe('Cloudflare Workers cold-wake smoke', () => {
  it('drops the exact participant socket through smoke control and preserves reconnect state', async () => {
    const setup = await initializeActiveRoom('cloudflare-smoke-drop-socket-room');
    let replacementSocket: WebSocket | null = null;

    try {
      const beforeDrop = await fetchSmokeReconstruction(setup.roomId);
      const participantSocketId = clientTransport(beforeDrop, 'player-2').socketId;
      const participantClose = waitForSocketClose(
        setup.secondSocket,
        'smoke controlled participant transport loss',
      );
      const dropped = await dropParticipantSocket(setup.roomId, 'player-2');

      expect(dropped).toMatchObject({
        status: 200,
        roomId: setup.roomId,
        playerId: 'player-2',
        socketId: participantSocketId,
        closeCode: 4000,
        reconnectEligible: true,
        connectedPlayers: ['player-1'],
      });
      await expect(participantClose).resolves.toMatchObject({
        code: 4000,
        reason: 'smoke transport loss',
      });

      const afterDrop = await fetchSmokeReconstruction(setup.roomId);
      expect(afterDrop.status).toBe(200);
      expect(openAcceptedPlayerIds(afterDrop)).toEqual(['player-1']);
      expect(afterDrop.connectedPlayers).toEqual(['player-1']);
      expect(afterDrop.playerState['player-2']?.presenceStatus).toBe('disconnected');

      const rejoined = await joinPlayer(setup.roomId, 'player-2');
      replacementSocket = await connectPlayer(setup.roomId, rejoined);
      await waitForDecodedMessage(
        replacementSocket,
        (message) => playerFromWelcome(message, 'player-2') !== null,
        'smoke controlled reconnect player-2 WelcomeSnapshot',
        5_000,
      );
      const afterReconnect = await fetchSmokeReconstruction(setup.roomId);
      expect(afterReconnect.status).toBe(200);
      expectOpenConnectedPlayers(afterReconnect, expectedPlayerIds);
      expect(afterReconnect.acceptedSockets.filter((socket) => socket.open)).toHaveLength(2);
    } finally {
      if (replacementSocket !== null) {
        await closeSocket(replacementSocket);
      }
      await cleanupActiveRoom(setup);
    }
  });

  it('deterministically reconstructs hibernated sockets after Durable Object eviction', async () => {
    const setup = await initializeActiveRoom('cloudflare-cold-wake-room');
    let replacementSecondSocket: WebSocket | null = null;
    let applicationCloseSocket: WebSocket | null = null;

    try {
      await allowHibernation(setup.roomId);
      await evictDurableObject(setup.stub, { webSockets: 'hibernate' });
      const reconstructed = await fetchSmokeReconstruction(setup.roomId);

      expect(reconstructed.status).toBe(200);
      expect(reconstructed.constructionSequence).toBeGreaterThan(
        setup.beforeWake.constructionSequence,
      );
      expect(acceptedPlayerIds(reconstructed), JSON.stringify(reconstructed)).toEqual(
        expectedPlayerIds,
      );
      expectOpenConnectedPlayers(reconstructed, expectedPlayerIds);
      await expectOriginalSocketsCarryPostReconstructionTraffic(
        setup.stub,
        setup.roomId,
        setup.firstSocket,
        setup.secondSocket,
        setup.beforeWake,
        setup.playerTwoBeforeWake,
        setup.beforeWakeTick,
      );
      replacementSecondSocket = await expectPostWakeReplacementReconnect(setup);
      await expectPostWakeTransportBounds(
        setup.stub,
        setup.roomId,
        setup.firstSocket,
        replacementSecondSocket,
        setup.beforeWakeTick,
      );
      await expectClientInitiatedCloseMirrors(
        setup.firstSocket,
        1000,
        'post-wake normal close',
        'post-wake normal close',
      );
      const applicationCloseJoin = await joinPlayer(setup.roomId, 'player-2');
      applicationCloseSocket = await connectPlayer(setup.roomId, applicationCloseJoin);
      await waitForDecodedMessage(
        applicationCloseSocket,
        (message) => playerFromWelcome(message, 'player-2') !== null,
        'post-wake application-close player-2 WelcomeSnapshot',
        5_000,
      );
      await expectClientInitiatedCloseMirrors(
        applicationCloseSocket,
        4001,
        'post-wake application close',
        'post-wake application close',
      );
    } finally {
      if (replacementSecondSocket !== null) {
        await closeSocket(replacementSecondSocket);
      }
      if (applicationCloseSocket !== null) {
        await closeSocket(applicationCloseSocket);
      }
      await cleanupActiveRoom(setup);
    }
  });

  it('retries failed initialization after deterministic Durable Object eviction', async () => {
    const setup = await initializeActiveRoom('cloudflare-initialization-retry-room');

    try {
      await allowHibernation(setup.roomId);
      await failNextInitialization(setup.roomId);
      await evictDurableObject(setup.stub, { webSockets: 'hibernate' });
      const failedReconstruction = await fetchSmokeReconstruction(setup.roomId);
      expect(failedReconstruction.status).toBe(500);
      expect(failedReconstruction.error).toContain(
        'smoke controlled first room initialization failure',
      );
      expect(failedReconstruction.constructionSequence).toBeGreaterThan(
        setup.beforeWake.constructionSequence,
      );

      await evictDurableObject(setup.stub, { webSockets: 'hibernate' });
      const successfulReconstruction = await fetchSmokeReconstruction(setup.roomId);
      expect(successfulReconstruction.status).toBe(200);
      expect(successfulReconstruction.constructionSequence).toBeGreaterThan(
        failedReconstruction.constructionSequence,
      );
      expect(
        acceptedPlayerIds(successfulReconstruction),
        JSON.stringify(successfulReconstruction),
      ).toEqual(expectedPlayerIds);
      expectOpenConnectedPlayers(successfulReconstruction, expectedPlayerIds);
      await expectOriginalSocketsCarryPostReconstructionTraffic(
        setup.stub,
        setup.roomId,
        setup.firstSocket,
        setup.secondSocket,
        setup.beforeWake,
        setup.playerTwoBeforeWake,
        setup.beforeWakeTick,
      );
      await expectPostWakeTransportBounds(
        setup.stub,
        setup.roomId,
        setup.firstSocket,
        setup.secondSocket,
        setup.beforeWakeTick,
      );
    } finally {
      await cleanupActiveRoom(setup);
    }
  });
});
