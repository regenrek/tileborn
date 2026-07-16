import * as BattleRoyaleProtocol from '@tileborne/ipc-contracts/protocols/battle-royale';

export interface QueuedInput<Input> {
  readonly playerId: string;
  readonly input: Input;
  readonly sortKey: {
    readonly tick: number;
    readonly seq: number;
  };
  readonly order: number;
}

export interface SnapshotAckFrame {
  readonly tick: number;
  readonly receivedAtMs: number;
}

export interface RoomSocketRecord {
  readonly socket: WebSocket;
  readonly socketId: string;
  readonly playerId: string;
  lastProducedSnapshotTick: number;
  lastSentSnapshotTick: number;
  lastAckedSnapshotTick: number;
  lastAckReceivedAtMs: number | null;
  lastClientAckReceivedAtMs: number | null;
  staleAckCount: number;
  droppedOutboundFrames: number;
  resyncCount: number;
  resyncSnapshotTick: number | null;
}

export interface ClientTransportStats {
  readonly playerId: string;
  readonly socketId: string;
  readonly lastProducedSnapshotTick: number;
  readonly lastSentSnapshotTick: number;
  readonly lastAckedSnapshotTick: number;
  readonly pendingSnapshotLagTicks: number;
  readonly lastAckReceivedAtMs: number | null;
  readonly lastClientAckReceivedAtMs: number | null;
  readonly staleAckCount: number;
  readonly droppedOutboundFrames: number;
  readonly resyncCount: number;
  readonly resyncSnapshotTick: number | null;
}

export type SnapshotAckResult =
  | { readonly kind: 'accepted' }
  | { readonly kind: 'stale' }
  | { readonly kind: 'future' }
  | { readonly kind: 'invalid' };

export type SnapshotOutboundDecision = 'send' | 'resync' | 'drop' | 'close';

export const MAX_QUEUED_INPUTS_PER_PLAYER = 1;
export const MAX_OUTBOUND_FRAMES_PER_TICK = 64;
export const MAX_OUTBOUND_BUFFERED_BYTES = 256 * 1024;
export const MAX_UNACKED_SNAPSHOT_TICKS_BEFORE_RESYNC = 12;
export const MAX_UNACKED_SNAPSHOT_TICKS_BEFORE_DROP = 48;
export const MAX_STALE_SNAPSHOT_ACKS = 3;

export const compareQueuedInputs = <Input>(
  left: QueuedInput<Input>,
  right: QueuedInput<Input>,
): number =>
  left.sortKey.tick - right.sortKey.tick ||
  left.sortKey.seq - right.sortKey.seq ||
  left.order - right.order;

export const createRoomSocketRecord = (
  playerId: string,
  socket: WebSocket,
  socketId: string,
): RoomSocketRecord => ({
  socket,
  socketId,
  playerId,
  lastProducedSnapshotTick: -1,
  lastSentSnapshotTick: -1,
  lastAckedSnapshotTick: -1,
  lastAckReceivedAtMs: null,
  lastClientAckReceivedAtMs: null,
  staleAckCount: 0,
  droppedOutboundFrames: 0,
  resyncCount: 0,
  resyncSnapshotTick: null,
});

export const decodeSnapshotAckFrame = (bytes: Uint8Array): SnapshotAckFrame | undefined => {
  try {
    const frame = BattleRoyaleProtocol.decodeClientMessage(bytes);
    return frame._tag === 'SnapshotAck'
      ? { tick: frame.tick, receivedAtMs: frame.receivedAtMs }
      : undefined;
  } catch {
    return undefined;
  }
};

export const snapshotTickFromServerFrame = (bytes: Uint8Array): number | undefined => {
  try {
    const frame = BattleRoyaleProtocol.decodeServerMessage(bytes);
    return frame._tag === 'WelcomeSnapshot' || frame._tag === 'DeltaSnapshot'
      ? frame.tick
      : undefined;
  } catch {
    return undefined;
  }
};

export const encodeTransportErrorFrame = (code: string, message: string): Uint8Array =>
  BattleRoyaleProtocol.encodeServerMessage(
    new BattleRoyaleProtocol.WireError({
      code,
      message,
    }),
  );

export const pendingSnapshotLagTicks = (record: RoomSocketRecord): number =>
  record.lastProducedSnapshotTick < 0
    ? 0
    : Math.max(0, record.lastProducedSnapshotTick - record.lastAckedSnapshotTick);

export const recordSnapshotProduced = (record: RoomSocketRecord, tick: number): void => {
  record.lastProducedSnapshotTick = Math.max(record.lastProducedSnapshotTick, tick);
};

export const recordSnapshotSent = (record: RoomSocketRecord, tick: number): void => {
  recordSnapshotProduced(record, tick);
  record.lastSentSnapshotTick = Math.max(record.lastSentSnapshotTick, tick);
};

export const recordSnapshotResyncSent = (record: RoomSocketRecord, tick: number): void => {
  record.resyncCount += 1;
  record.resyncSnapshotTick = tick;
  recordSnapshotSent(record, tick);
};

export const recordOutboundDropped = (record: RoomSocketRecord): void => {
  record.droppedOutboundFrames += 1;
};

export const applySnapshotAck = (
  record: RoomSocketRecord,
  ack: SnapshotAckFrame,
  nowMs: number,
): SnapshotAckResult => {
  if (!Number.isSafeInteger(ack.tick) || ack.tick < 0 || !Number.isFinite(ack.receivedAtMs)) {
    record.staleAckCount += 1;
    return { kind: 'invalid' };
  }
  if (ack.tick > record.lastSentSnapshotTick) {
    record.staleAckCount += 1;
    return { kind: 'future' };
  }
  if (ack.tick <= record.lastAckedSnapshotTick) {
    record.staleAckCount += 1;
    return { kind: 'stale' };
  }
  record.lastAckedSnapshotTick = ack.tick;
  record.lastAckReceivedAtMs = nowMs;
  record.lastClientAckReceivedAtMs = ack.receivedAtMs;
  record.staleAckCount = 0;
  if (record.resyncSnapshotTick !== null && ack.tick >= record.resyncSnapshotTick) {
    record.resyncSnapshotTick = null;
  }
  return { kind: 'accepted' };
};

export const socketBufferedAmount = (socket: WebSocket): number => {
  const maybeSocket = socket as WebSocket & { readonly bufferedAmount?: unknown };
  return typeof maybeSocket.bufferedAmount === 'number' &&
    Number.isFinite(maybeSocket.bufferedAmount)
    ? maybeSocket.bufferedAmount
    : 0;
};

export const decideSnapshotOutbound = (
  record: RoomSocketRecord,
  bufferedAmount: number,
  currentTick: number,
): SnapshotOutboundDecision => {
  const lagTicks = pendingSnapshotLagTicks(record);
  if (lagTicks >= MAX_UNACKED_SNAPSHOT_TICKS_BEFORE_DROP) {
    return 'close';
  }
  if (record.resyncSnapshotTick !== null) {
    if (bufferedAmount > MAX_OUTBOUND_BUFFERED_BYTES && currentTick > record.resyncSnapshotTick) {
      return 'close';
    }
    return 'drop';
  }
  if (bufferedAmount > MAX_OUTBOUND_BUFFERED_BYTES) {
    return 'resync';
  }
  return lagTicks >= MAX_UNACKED_SNAPSHOT_TICKS_BEFORE_RESYNC ? 'resync' : 'send';
};

export const toClientTransportStats = (record: RoomSocketRecord): ClientTransportStats => ({
  playerId: record.playerId,
  socketId: record.socketId,
  lastProducedSnapshotTick: record.lastProducedSnapshotTick,
  lastSentSnapshotTick: record.lastSentSnapshotTick,
  lastAckedSnapshotTick: record.lastAckedSnapshotTick,
  pendingSnapshotLagTicks: pendingSnapshotLagTicks(record),
  lastAckReceivedAtMs: record.lastAckReceivedAtMs,
  lastClientAckReceivedAtMs: record.lastClientAckReceivedAtMs,
  staleAckCount: record.staleAckCount,
  droppedOutboundFrames: record.droppedOutboundFrames,
  resyncCount: record.resyncCount,
  resyncSnapshotTick: record.resyncSnapshotTick,
});
