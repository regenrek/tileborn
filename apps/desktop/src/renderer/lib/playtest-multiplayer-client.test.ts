import {
  encodeMessage as encodeRuntimeMessage,
  Events,
  PlayerJoined,
  SnapshotDelta,
} from '@tileborne/runtime';
import { Option } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlaytestMultiplayerClient } from '@/lib/playtest-multiplayer-client';
import type { HudEvent as PlaytestHudEvent } from '@tileborne/game-client';
import type { ResolvedPlaytestPlugin, ServerFrameView } from '@/lib/playtest-plugin-bridge';

class MockWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly sent: ArrayBuffer[] = [];
  private readonly listeners = new Map<
    string,
    Array<
      (event: {
        readonly data?: ArrayBuffer;
        readonly code?: number;
        readonly reason?: string;
      }) => void
    >
  >();
  readyState = MockWebSocket.OPEN;
  binaryType: BinaryType = 'blob';

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: ArrayBuffer): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ''): void {
    this.readyState = MockWebSocket.CLOSED;
    for (const listener of this.listeners.get('close') ?? []) {
      listener({ code, reason });
    }
  }

  addEventListener(
    type: string,
    listener: (event: {
      readonly data?: ArrayBuffer;
      readonly code?: number;
      readonly reason?: string;
    }) => void,
  ): void {
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
  hudLayout: { id: 'test-hud', widgets: [] } as unknown as ResolvedPlaytestPlugin['hudLayout'],
  decodeServerFrame: (bytes) => ({ key: bytes[0] }),
  serverFrameToView: (frame) =>
    typeof frame === 'object' && frame !== null && 'key' in frame && typeof frame.key === 'number'
      ? views[frame.key]
      : undefined,
  createInitialFrame: (input) => ({ kind: 'initial-frame', input }),
  encodeClientInputFrame: vi.fn(() => new Uint8Array([1])),
  encodeHeartbeatFrame: vi.fn(() => new Uint8Array([2])),
  encodeSnapshotAckFrame: vi.fn(() => new Uint8Array([4])),
  encodeServerFrame: vi.fn(() => new Uint8Array([3])),
  decodeClientFrameView: () => undefined,
  inputMap: {
    id: 'test',
    actions: [],
    schemeDefaults: {},
  } as unknown as ResolvedPlaytestPlugin['inputMap'],
  controlScheme: 'keyboard-mouse' as unknown as ResolvedPlaytestPlugin['controlScheme'],
  inputCaptureProfile: { boundKeyCodes: new Set<string>(), usesMouseButtons: false },
  resolveInputIntent: () => ({
    dir: undefined,
    shoot: false,
    reload: false,
    interact: false,
    drop: false,
    abilities: [],
  }),
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
      reload: false,
      interact: false,
      drop: false,
      abilities: [],
    });
  });

  it('propagates action flags, abilities, aimDeg, and swapSlot through to the encoded BR frame', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const plugin = makePlugin();
    const client = new PlaytestMultiplayerClient(64, 64, vi.fn(), vi.fn(), plugin);

    client.connect('ws://localhost/rooms/test/connect', 'player-1');
    client.sendInput(0, true, {
      reload: true,
      interact: true,
      drop: true,
      abilities: ['dash'],
      aimDeg: 90,
      swapSlot: 2,
    });

    expect(plugin.encodeClientInputFrame).toHaveBeenCalledWith({
      tick: 0,
      seq: 1,
      dir: 0,
      shoot: true,
      reload: true,
      interact: true,
      drop: true,
      abilities: ['dash'],
      aimDeg: 90,
      swapSlot: 2,
    });
  });

  it('omits movement direction for shoot-only frames', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const plugin = makePlugin();
    const client = new PlaytestMultiplayerClient(64, 64, vi.fn(), vi.fn(), plugin);

    client.connect('ws://localhost/rooms/test/connect', 'player-1');
    client.sendInput(undefined, true);

    expect(plugin.encodeClientInputFrame).toHaveBeenCalledWith({
      tick: 0,
      seq: 1,
      shoot: true,
      reload: false,
      interact: false,
      drop: false,
      abilities: [],
    });
  });

  it('omits aimDeg/swapSlot from the encoded frame when not provided', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const plugin = makePlugin();
    const client = new PlaytestMultiplayerClient(64, 64, vi.fn(), vi.fn(), plugin);

    client.connect('ws://localhost/rooms/test/connect', 'player-1');
    client.sendInput(0, false);

    const call = (plugin.encodeClientInputFrame as ReturnType<typeof vi.fn>).mock.lastCall;
    const frame = call?.[0];
    expect(frame).toEqual({
      tick: 0,
      seq: 1,
      dir: 0,
      shoot: false,
      reload: false,
      interact: false,
      drop: false,
      abilities: [],
    });
    expect(frame).not.toHaveProperty('aimDeg');
    expect(frame).not.toHaveProperty('swapSlot');
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
    expect(onStateChange).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'error' }));
  });

  it('stays connecting for admission frames and becomes live only on a runtime snapshot', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const onStateChange = vi.fn();
    const onInitialFrame = vi.fn();
    const client = new PlaytestMultiplayerClient(
      64,
      64,
      onStateChange,
      onInitialFrame,
      makePlugin(),
    );

    client.connect('ws://localhost/rooms/test/connect', 'player-1');
    const socket = MockWebSocket.instances[0];
    socket?.receive(
      toArrayBuffer(
        encodeRuntimeMessage(
          new PlayerJoined({ playerId: 'player-1', displayName: Option.none() }),
        ),
      ),
    );

    expect(client.getState()).toMatchObject({ phase: 'connecting', tick: 0 });
    expect(onInitialFrame).not.toHaveBeenCalled();

    socket?.receive(
      toArrayBuffer(
        encodeRuntimeMessage(
          new SnapshotDelta({
            tick: 1,
            baseTick: 0,
            diff: Option.some([{ tick: 1, players: 1 }]),
          }),
        ),
      ),
    );

    expect(client.getState()).toMatchObject({ phase: 'live', tick: 1 });
  });

  it('projects BR snapshots and match events into HUD state', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const onStateChange = vi.fn();
    const plugin = makePlugin({
      1: {
        kind: 'initial',
        tick: 0,
        players: [
          {
            playerId: 'player-1',
            team: 'blue',
            x: 10,
            y: 10,
            health: 100,
            shield: 20,
            armor: { mitigation: 0.25, durability: 80 },
            weapon: {
              weaponId: 'weapon:primary',
              slot: 2,
              ammoInMagazine: 1,
              magazineSize: 3,
              reserveAmmo: 6,
              reloadRemainingTicks: 4,
              reloadTotalTicks: 12,
            },
            inventory: { itemIds: ['health-pack'], capacity: 5 },
            pickupPrompt: {
              itemKind: 'ammo-box',
              tier: 'common',
              action: 'pickup-loot',
              available: true,
            },
            pickupToast: { itemKind: 'ammo-box', tier: 'common', quantity: 1, tick: 0 },
            damageIndicator: { sourceId: 'player-2', angleDeg: 180, amount: 12, tick: 0 },
            stats: { kills: 1, deaths: 0 },
            abilityCooldowns: [{ abilityId: 'dash', remainingTicks: 8 }],
          },
          { playerId: 'player-2', x: 20, y: 20, health: 100 },
        ],
        objects: [
          {
            objectId: 'crate-1',
            x: 12,
            y: 18,
            pickup: { itemKind: 'ammo-box', tier: 'common', quantity: 1, available: true },
          },
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
    socket?.receive(toArrayBuffer(new Uint8Array([1])));
    socket?.receive(toArrayBuffer(new Uint8Array([2])));
    socket?.receive(toArrayBuffer(new Uint8Array([3])));
    socket?.receive(toArrayBuffer(new Uint8Array([4])));

    const latestState = onStateChange.mock.lastCall?.[0];
    expect(latestState).toMatchObject({
      tick: 10,
      players: [{ playerId: 'player-1' }],
      hud: {
        totalPlayers: 2,
        zoneStatus: { phase: 'shrinking' },
        localPlayer: {
          team: 'blue',
          shield: 20,
          armor: { mitigation: 0.25, durability: 80 },
          weapon: {
            weaponId: 'weapon:primary',
            slot: 2,
            ammoInMagazine: 1,
            magazineSize: 3,
            reserveAmmo: 6,
            reloadRemainingTicks: 4,
            reloadTotalTicks: 12,
          },
          inventory: { itemIds: ['health-pack'], capacity: 5 },
          pickupPrompt: {
            itemKind: 'ammo-box',
            tier: 'common',
            action: 'pickup-loot',
            available: true,
          },
          pickupToast: { itemKind: 'ammo-box', tier: 'common', quantity: 1, tick: 0 },
          damageIndicator: { sourceId: 'player-2', angleDeg: 180, amount: 12, tick: 0 },
          stats: { kills: 1, deaths: 0 },
          abilityCooldowns: [{ abilityId: 'dash', remainingTicks: 8 }],
        },
        scoreboard: [
          expect.objectContaining({ playerId: 'player-1', team: 'blue', kills: 1, deaths: 0 }),
        ],
        minimap: {
          objects: [
            expect.objectContaining({ objectId: 'crate-1', kind: 'pickup', available: true }),
          ],
        },
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
      latestState?.hud.gameplayEvents.some(
        (event: PlaytestHudEvent) => event._tag === 'EntityDefeated',
      ),
    ).toBe(true);
    expect(
      latestState?.hud.gameplayEvents.some(
        (event: PlaytestHudEvent) => event._tag === 'ItemGranted',
      ),
    ).toBe(true);
  });

  it('acks each decoded snapshot tick once', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const plugin = makePlugin({
      1: {
        kind: 'initial',
        tick: 6,
        players: [{ playerId: 'player-1', x: 10, y: 10, health: 100 }],
        zone: { cx: 32, cy: 32, radius: 64 },
      },
      2: {
        kind: 'delta',
        tick: 6,
        removed: [],
        updated: [],
        zone: undefined,
      },
      3: {
        kind: 'delta',
        tick: 7,
        removed: [],
        updated: [],
        zone: undefined,
      },
    });
    const client = new PlaytestMultiplayerClient(64, 64, vi.fn(), vi.fn(), plugin);

    client.connect('ws://localhost/rooms/test/connect', 'player-1');
    const socket = MockWebSocket.instances[0];
    socket?.receive(toArrayBuffer(new Uint8Array([1])));
    socket?.receive(toArrayBuffer(new Uint8Array([2])));
    socket?.receive(toArrayBuffer(new Uint8Array([3])));

    expect(plugin.encodeSnapshotAckFrame).toHaveBeenNthCalledWith(1, 6, expect.any(Number));
    expect(plugin.encodeSnapshotAckFrame).toHaveBeenNthCalledWith(2, 7, expect.any(Number));
    expect(socket?.sent).toHaveLength(2);
  });

  it('replaces the socket and accepts the reconnect welcome as authoritative state', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const onStateChange = vi.fn();
    const onInitialFrame = vi.fn();
    const plugin = makePlugin({
      1: {
        kind: 'initial',
        tick: 1,
        players: [{ playerId: 'player-1', x: 10, y: 10, health: 100 }],
        zone: { cx: 32, cy: 32, radius: 64 },
      },
      2: {
        kind: 'initial',
        tick: 12,
        players: [{ playerId: 'player-1', x: 36, y: 10, health: 90 }],
        zone: { cx: 32, cy: 32, radius: 48 },
      },
    });
    const client = new PlaytestMultiplayerClient(64, 64, onStateChange, onInitialFrame, plugin);

    client.connect('ws://localhost/rooms/test/connect?playerId=player-1', 'player-1');
    const firstSocket = MockWebSocket.instances[0];
    firstSocket?.receive(toArrayBuffer(new Uint8Array([1])));

    client.connect('ws://localhost/rooms/test/connect?playerId=player-1&reconnect=1', 'player-1');
    const replacementSocket = MockWebSocket.instances[1];
    replacementSocket?.receive(toArrayBuffer(new Uint8Array([2])));

    expect(firstSocket?.readyState).toBe(MockWebSocket.CLOSED);
    expect(replacementSocket?.url).toContain('reconnect=1');
    expect(onInitialFrame).toHaveBeenLastCalledWith({ key: 2 });
    expect(onStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        phase: 'live',
        tick: 12,
        players: [{ playerId: 'player-1', x: 36, y: 10, health: 90 }],
      }),
    );
  });
});
