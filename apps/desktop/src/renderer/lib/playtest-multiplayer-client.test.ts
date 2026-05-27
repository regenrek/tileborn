import {
  encodeMessage as encodeRuntimeMessage,
  Events,
  SnapshotDelta,
} from '@tileborne/runtime';
import { Option } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlaytestMultiplayerClient } from '@/lib/playtest-multiplayer-client';
import type { PlaytestHudEvent } from '@/lib/playtest-hud-utils';
import type { ResolvedPlaytestPlugin, ServerFrameView } from '@/lib/playtest-plugin-bridge';

class MockWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly sent: ArrayBuffer[] = [];
  private readonly listeners = new Map<string, Array<(event: { readonly data?: ArrayBuffer }) => void>>();
  readyState = MockWebSocket.OPEN;
  binaryType: BinaryType = 'blob';

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: ArrayBuffer): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }

  addEventListener(type: string, listener: (event: { readonly data?: ArrayBuffer }) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(): void {
    return;
  }

  receive(data: ArrayBuffer): void {
    for (const listener of this.listeners.get('message') ?? []) {
      listener({ data });
    }
  }
}

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

const makePlugin = (views: Record<number, ServerFrameView> = {}): ResolvedPlaytestPlugin => ({
  projector: {
    project: () => [],
    mergeFrame: (_previous, frame) => frame,
  },
  bundledAssets: [],
  manifest: {
    fixedZoom: 4,
    hudInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  },
  decodeServerFrame: (bytes) => ({ key: bytes[0] }),
  serverFrameToView: (frame) =>
    typeof frame === 'object' && frame !== null && 'key' in frame && typeof frame.key === 'number'
      ? views[frame.key]
      : undefined,
  createInitialFrame: (input) => ({ kind: 'initial-frame', input }),
  encodeClientInputFrame: vi.fn(() => new Uint8Array([1])),
  encodeHeartbeatFrame: vi.fn(() => new Uint8Array([2])),
  encodeServerFrame: vi.fn(() => new Uint8Array([3])),
  decodeClientFrameView: () => undefined,
});

describe('PlaytestMultiplayerClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    MockWebSocket.instances = [];
  });

  it('sends one BR protocol frame per input', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const plugin = makePlugin();
    const client = new PlaytestMultiplayerClient(64, 64, vi.fn(), vi.fn(), plugin);

    client.connect('ws://localhost/rooms/test/connect', 'player-1');
    client.sendInput(0, true);

    const socket = MockWebSocket.instances[0];
    expect(socket?.sent).toHaveLength(1);
    expect(plugin.encodeClientInputFrame).toHaveBeenCalledWith({
      tick: 0,
      seq: 1,
      dir: 0,
      shoot: true,
    });
  });

  it('propagates aimDeg and weaponSlot through to the encoded BR frame', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const plugin = makePlugin();
    const client = new PlaytestMultiplayerClient(64, 64, vi.fn(), vi.fn(), plugin);

    client.connect('ws://localhost/rooms/test/connect', 'player-1');
    client.sendInput(0, true, { aimDeg: 90, weaponSlot: 2 });

    expect(plugin.encodeClientInputFrame).toHaveBeenCalledWith({
      tick: 0,
      seq: 1,
      dir: 0,
      shoot: true,
      aimDeg: 90,
      weaponSlot: 2,
    });
  });

  it('omits aimDeg/weaponSlot from the encoded frame when not provided', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const plugin = makePlugin();
    const client = new PlaytestMultiplayerClient(64, 64, vi.fn(), vi.fn(), plugin);

    client.connect('ws://localhost/rooms/test/connect', 'player-1');
    client.sendInput(0, false);

    const call = (plugin.encodeClientInputFrame as ReturnType<typeof vi.fn>).mock.lastCall;
    const frame = call?.[0];
    expect(frame).toEqual({ tick: 0, seq: 1, dir: 0, shoot: false });
    expect(frame).not.toHaveProperty('aimDeg');
    expect(frame).not.toHaveProperty('weaponSlot');
  });

  it('accepts canonical runtime frames emitted by the game host', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const onStateChange = vi.fn();
    const client = new PlaytestMultiplayerClient(64, 64, onStateChange, vi.fn(), makePlugin());

    client.connect('ws://localhost/rooms/test/connect', 'player-1');
    const socket = MockWebSocket.instances[0];
    socket?.receive(
      toArrayBuffer(
        encodeRuntimeMessage(
          new SnapshotDelta({
            tick: 5,
            baseTick: 0,
            diff: Option.some([{ tick: 5, players: 2 }]),
          }),
        ),
      ),
    );
    socket?.receive(
      toArrayBuffer(
        encodeRuntimeMessage(
          new Events({
            events: Option.some([{ type: 'tick', tick: 5 }]),
          }),
        ),
      ),
    );

    expect(onStateChange).toHaveBeenCalledWith(
      expect.objectContaining({ tick: 5, errorMessage: null }),
    );
    expect(onStateChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'error' }),
    );
  });

  it('projects BR snapshots and match events into HUD state', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const onStateChange = vi.fn();
    const plugin = makePlugin({
      1: {
        kind: 'initial',
        tick: 0,
        players: [
          { playerId: 'player-1', x: 10, y: 10, health: 100 },
          { playerId: 'player-2', x: 20, y: 20, health: 100 },
        ],
        zone: { cx: 32, cy: 32, radius: 64 },
      },
      2: {
        kind: 'delta',
        tick: 10,
        removed: ['player-2'],
        updated: [],
        zone: { cx: 32, cy: 32, radius: 48 },
      },
      3: { kind: 'killed', killer: 'player-1', victim: 'player-2', tick: 10 },
      4: { kind: 'game-over', winner: 'player-1' },
    });
    const client = new PlaytestMultiplayerClient(64, 64, onStateChange, vi.fn(), plugin);

    client.connect('ws://localhost/rooms/test/connect', 'player-1');
    const socket = MockWebSocket.instances[0];
    socket?.receive(
      toArrayBuffer(new Uint8Array([1])),
    );
    socket?.receive(
      toArrayBuffer(new Uint8Array([2])),
    );
    socket?.receive(
      toArrayBuffer(new Uint8Array([3])),
    );
    socket?.receive(
      toArrayBuffer(new Uint8Array([4])),
    );

    const latestState = onStateChange.mock.lastCall?.[0];
    expect(latestState).toMatchObject({
      tick: 10,
      players: [{ playerId: 'player-1' }],
      hud: {
        totalPlayers: 2,
        zoneStatus: { phase: 'shrinking' },
        gameOver: {
          winnerId: 'player-1',
          winnerDisplayName: 'Player 1',
          alivePlayers: 1,
          totalPlayers: 2,
          tickCount: 10,
        },
      },
    });
    expect(
      latestState?.hud.recentEvents.some(
        (event: PlaytestHudEvent) => event._tag === 'PlayerKilled',
      ),
    ).toBe(true);
  });
});
