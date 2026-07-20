import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { hashBytes, type BehaviorId } from '@tileborne/core';
import {
  AUDIO_USER_SETTINGS_STORAGE_KEY,
  type RuntimeAudioPlaybackEngine,
} from '@tileborne/game-client';
import * as BattleRoyaleProtocol from '@tileborne/ipc-contracts/protocols/battle-royale';
import { createInitialFrame, encodeServerFrame } from '@tileborne/plugin-battle-royale';
import {
  applyGameShellAuthoringCommand,
  buildRuntimeGameShellProjection,
  defaultProjectGameShellState,
  type RuntimeAudioSettings,
  type RuntimeBehaviorContext,
} from '@tileborne/runtime';
import { Option } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bundledMapPackages } from '../../game-host/src/.generated/bundled-map-packages.js';
import { mintHandoffToken } from '../../game-host/src/rooms/handoff-token.js';
import { PlaytestRoom } from '../../game-host/src/rooms/room-object.js';
import {
  asDurableObjectState,
  createFakeDurableObjectState,
  installWorkerGlobals,
} from '../../game-host/src/test-helpers/do-fake.js';
import { App } from './app.js';

const TEST_KEY = 'test-handoff-signing-key-32-bytes!!';
const shellE2EBehaviorId = 'behavior:22222222-2222-4222-8222-222222222222' as BehaviorId;
const shellE2ECode = 'export default {}';
const shellE2ECodeHash = hashBytes(new TextEncoder().encode(shellE2ECode));
const shellE2EPackageId = 'mappkg:550e8400-e29b-41d4-a716-446655441000';

vi.mock('../../game-host/src/.generated/bundled-behaviors.js', () => ({
  bundledBehaviorModules: [
    {
      packageId: shellE2EPackageId,
      artifact: {
        behaviorId: shellE2EBehaviorId,
        sourceKind: 'typescript',
        modulePath: 'behaviors/modules/shell-app-e2e.mjs',
        hash: shellE2ECodeHash,
      },
      code: shellE2ECode,
      createNamespace: () => ({
        default: {
          id: 'test.shell-app-e2e',
          sourceKind: 'typescript',
          state: { last: '' },
          requiredCapabilities: ['shell.navigation'],
          on: {
            'shell.event': ({ event, state }: RuntimeBehaviorContext) =>
              state.set('last', String(event.event)),
            'runtime.tick': ({ state, actions }: RuntimeBehaviorContext) =>
              state.get('last') === 'shell.pause.entered'
                ? actions['shell.invoke-action']({ actionId: 'pause.exit' })
                : undefined,
          },
        },
      }),
    },
  ],
}));

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const lobbySummary = (
  input: {
    readonly ready?: boolean;
    readonly canStart?: boolean;
    readonly playerId?: string;
    readonly displayName?: string;
  } = {},
) => ({
  roomId: 'room-1',
  mapId: 'map:fixture',
  phase: input.canStart ? 'countdown' : 'lobby',
  lobby: { visibility: 'private', joinCode: 'ABC234' },
  playerCount: 1,
  maxPlayers: 8,
  minReadyPlayers: 1,
  canStart: input.canStart ?? false,
  players: [
    {
      playerId: input.playerId ?? 'player-1',
      status: 'connected',
      ready: input.ready ?? false,
      reconnectEligible: true,
      lastSeenAt: '2026-06-13T00:00:00.000Z',
      displayName: input.displayName ?? 'Ada',
    },
  ],
});

const createStorage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
};

const USER_INPUT_OVERLAY_STORAGE_KEY = 'tileborne:input:user-overlay:v1';
const PRIMARY_ACTION = 'core.PrimaryAction';

let activeRoomConnection: {
  readonly room: PlaytestRoom;
  readonly playerId: string;
} | null = null;

class RoomBackedWebSocket {
  readyState = MockWebSocket.OPEN;
  bufferedAmount = 0;
  private attachment: unknown;

  constructor(private readonly client: MockWebSocket) {}

  send(data: ArrayBuffer | string): void {
    this.client.emitMessage(data);
  }

  close(): void {
    this.readyState = 3;
  }

  serializeAttachment(value: unknown): void {
    this.attachment = value;
  }

  deserializeAttachment(): unknown {
    return this.attachment;
  }
}

class MockWebSocket {
  static readonly OPEN = 1;
  static readonly instances: MockWebSocket[] = [];

  binaryType: BinaryType = 'blob';
  readyState = WebSocket.OPEN;
  readonly send = vi.fn();
  readonly close = vi.fn();
  readonly url: string;
  readonly listeners = new Map<string, ((event: MessageEvent) => void)[]>();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    const connection = activeRoomConnection;
    if (connection !== null) {
      const server = new RoomBackedWebSocket(this);
      (
        connection.room as unknown as {
          readonly acceptPlayerSocket: (playerId: string, server: WebSocket) => void;
        }
      ).acceptPlayerSocket(connection.playerId, server as unknown as WebSocket);
      this.send.mockImplementation((data: string | ArrayBuffer | ArrayBufferView) => {
        const message = ArrayBuffer.isView(data)
          ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
          : data;
        void connection.room.webSocketMessage(server as unknown as WebSocket, message);
      });
    }
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emitMessage(data: ArrayBuffer | Uint8Array | string): void {
    for (const listener of this.listeners.get('message') ?? []) {
      listener(new MessageEvent('message', { data }));
    }
  }
}

const emitServerFrame = (socket: MockWebSocket, frame: unknown): void => {
  const encoded = encodeServerFrame(frame);
  socket.emitMessage(encoded);
};

const emptyDeltaOptions = {
  team: Option.none<string>(),
  x: Option.none<number>(),
  y: Option.none<number>(),
  health: Option.none<number>(),
  shield: Option.none<number>(),
  armor: Option.none<BattleRoyaleProtocol.PlayerArmorSnapshot>(),
  weapon: Option.none<BattleRoyaleProtocol.PlayerWeaponSnapshot>(),
  inventory: Option.none<BattleRoyaleProtocol.PlayerInventorySnapshot>(),
  pickupPrompt: Option.none<BattleRoyaleProtocol.PlayerPickupPromptSnapshot>(),
  pickupToast: Option.none<BattleRoyaleProtocol.PlayerPickupToastSnapshot>(),
  damageIndicator: Option.none<BattleRoyaleProtocol.PlayerDamageIndicatorSnapshot>(),
  stats: Option.none<BattleRoyaleProtocol.PlayerStatsSnapshot>(),
  statusEffects: Option.none<readonly BattleRoyaleProtocol.PlayerStatusSnapshot[]>(),
  abilityCooldowns: Option.none<readonly BattleRoyaleProtocol.PlayerAbilityCooldownSnapshot[]>(),
  animation: Option.none<BattleRoyaleProtocol.PlayerAnimationState>(),
} as const;

const deltaFrame = (input: {
  readonly tick: number;
  readonly updated?: readonly BattleRoyaleProtocol.PlayerUpdate[];
  readonly zone?: BattleRoyaleProtocol.ZoneState;
}): BattleRoyaleProtocol.DeltaSnapshot =>
  new BattleRoyaleProtocol.DeltaSnapshot({
    tick: input.tick,
    serverTimestampMs: input.tick * 50,
    removed: [],
    updated: [...(input.updated ?? [])],
    projectilesUpdated: [],
    projectilesRemoved: [],
    deployablesUpdated: [],
    deployablesRemoved: [],
    objectsUpdated: [],
    objectsRemoved: [],
    zone: input.zone === undefined ? Option.none() : Option.some(input.zone),
  });

const createSpyAudioEngine = (playedCueIds: string[]): RuntimeAudioPlaybackEngine => {
  let settings: RuntimeAudioSettings = {
    masterVolume: 1,
    muted: false,
    muteOnFocusLoss: true,
    busVolumes: {},
  };
  return {
    playCue: (request) => {
      const cueId = typeof request === 'string' ? request : request.cueId;
      playedCueIds.push(cueId);
      return {
        cueId,
        busId: 'battle-royale.sfx',
        gain: 1,
        audible: true,
        loop: false,
        maxOverlap: 8,
      };
    },
    stopCue: vi.fn(),
    stopAll: vi.fn(),
    setSettings: (nextSettings) => {
      settings = nextSettings;
    },
    setFocusState: vi.fn(),
    snapshot: () => ({
      supported: true,
      focusState: 'focused',
      settings,
      playCount: playedCueIds.length,
      audiblePlayCount: playedCueIds.length,
      unsupportedPlayCount: 0,
      activeSourceCount: 0,
    }),
    dispose: vi.fn(),
  };
};

describe('game-client template App', () => {
  beforeEach(() => {
    MockWebSocket.instances.length = 0;
    const storage = createStorage();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: storage,
    });
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('WebSocket', MockWebSocket);
    activeRoomConnection = null;
    window.localStorage.clear();
  });

  afterEach(() => {
    activeRoomConnection = null;
    vi.unstubAllGlobals();
  });

  it('boots into the neutral menu and surfaces the BR plugin sections', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/lobbies/create')) {
        return jsonResponse(
          {
            roomId: 'room-1',
            wsUrl: 'http://localhost/rooms/room-1/connect?playerId=player-1&token=handoff-1',
            joinCode: 'ABC234',
            joinUrl: 'http://localhost/lobbies/join?code=ABC234',
            playerId: 'player-1',
            handoffToken: 'handoff-1',
            reconnectToken: 'reconnect-1',
            lobby: lobbySummary(),
          },
          201,
        );
      }
      if (url.endsWith('/lobbies/room-1/ready')) {
        return jsonResponse({
          lobby: lobbySummary({ ready: true, canStart: true }),
          canStart: true,
        });
      }
      throw new Error(`unexpected fetch ${url} ${String(init?.method)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    await waitFor(() => expect(screen.getByTestId('shell-screen-main-menu')).not.toBeNull());
    // The shipped shell projection supplies menu copy while the app keeps the neutral brand.
    expect(screen.getByRole('heading', { name: 'Main Menu' })).not.toBeNull();
    expect(screen.getByRole('application').getAttribute('aria-label')).toBe(
      'Tileborne Game runtime shell',
    );
    // BR plugin contributed sections render into named slots.
    expect(screen.getByTestId('br-quick-play')).not.toBeNull();
    expect(screen.getByTestId('br-loadout')).not.toBeNull();
    expect(screen.getByTestId('br-private-room')).not.toBeNull();

    // BR quick-play drives the shell into the network lobby.
    await user.click(screen.getByTestId('br-quick-play'));
    expect(screen.getByTestId('lobby')).not.toBeNull();

    await user.type(screen.getByTestId('lobby-display-name'), 'Ada');
    await user.click(screen.getByTestId('create-lobby'));
    await waitFor(() => expect(screen.getByTestId('lobby-code').textContent).toBe('ABC234'));
    expect(screen.getByTestId('lobby-ws-url').textContent).toBe(
      'ws://localhost/rooms/room-1/connect?token=redacted',
    );
    expect(screen.getByTestId('lobby-ws-url').textContent).not.toContain('handoff-1');
    const createCall = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith('/lobbies/create'),
    );
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
      mapId: 'map:fixture',
      reserveCreator: true,
      playerDisplayName: 'Ada',
    });
    expect(screen.getByTestId('lobby-player-player-1').textContent).toContain('Not ready');

    await user.click(screen.getByTestId('ready-toggle'));
    await waitFor(() =>
      expect(screen.getByTestId('lobby-player-player-1').textContent).toContain('Ready'),
    );
    const readyCall = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith('/lobbies/room-1/ready'),
    );
    expect(JSON.parse(String(readyCall?.[1]?.body))).toEqual({
      playerId: 'player-1',
      ready: true,
      reconnectToken: 'reconnect-1',
    });

    await user.click(screen.getByTestId('start-match'));
    expect(screen.getByTestId('in-match')).not.toBeNull();
    await user.click(screen.getByTestId('end-match'));
    expect(screen.getByTestId('results-screen')).not.toBeNull();
  });

  it('shows the BR match-rules section inside settings', async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('shell-screen-main-menu')).not.toBeNull());
    await user.click(screen.getByTestId('shell-action-menu-settings'));
    expect(screen.getByTestId('br-match-rules')).not.toBeNull();
  });

  it('surfaces BR audio settings in the runtime shell', async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    await waitFor(() => expect(screen.getByTestId('shell-screen-main-menu')).not.toBeNull());

    await user.click(screen.getByTestId('shell-action-menu-settings'));
    await user.click(screen.getByTestId('settings-tab-audio'));

    expect(screen.getByTestId('audio-settings')).not.toBeNull();
    expect((screen.getByTestId('audio-bus-battle-royale.sfx') as HTMLInputElement).value).toBe(
      '85',
    );

    fireEvent.change(screen.getByTestId('audio-master-volume'), { target: { value: '60' } });
    expect((screen.getByTestId('audio-master-volume') as HTMLInputElement).value).toBe('60');
    await user.click(screen.getByTestId('audio-muted'));
    expect((screen.getByTestId('audio-muted') as HTMLInputElement).checked).toBe(true);
    const storedAudio = window.localStorage.getItem(AUDIO_USER_SETTINGS_STORAGE_KEY);
    expect(JSON.parse(String(storedAudio))).toMatchObject({ masterVolume: 0.6, muted: true });

    first.unmount();
    const freshDocumentStorage = createStorage();
    freshDocumentStorage.setItem(AUDIO_USER_SETTINGS_STORAGE_KEY, String(storedAudio));
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: freshDocumentStorage,
    });
    vi.stubGlobal('localStorage', freshDocumentStorage);
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('shell-screen-main-menu')).not.toBeNull());
    await user.click(screen.getByTestId('shell-action-menu-settings'));
    await user.click(screen.getByTestId('settings-tab-audio'));

    expect((screen.getByTestId('audio-master-volume') as HTMLInputElement).value).toBe('60');
    expect((screen.getByTestId('audio-muted') as HTMLInputElement).checked).toBe(true);
  });

  it('loads authored shipped shell.json and recovers to the default shell when it is missing', async () => {
    const authored = applyGameShellAuthoringCommand(
      applyGameShellAuthoringCommand(defaultProjectGameShellState(), {
        type: 'set-entry-screen',
        screenId: 'main-menu',
      }),
      {
        type: 'set-screen-text',
        screenId: 'main-menu',
        title: 'Shipped Arena Shell',
        subtitle: 'Loaded from the packaged map',
      },
    );
    const projection = buildRuntimeGameShellProjection(authored);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'maps/map-fixture/shell.json') {
        return jsonResponse(projection);
      }
      if (url === 'maps/map-fixture/audio.json') {
        return new Response('missing', { status: 404 });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = render(<App />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('maps/map-fixture/shell.json'));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Shipped Arena Shell' })).not.toBeNull(),
    );
    expect(screen.getByText('Loaded from the packaged map')).not.toBeNull();

    first.unmount();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'maps/map-fixture/shell.json' || url === 'maps/map-fixture/audio.json') {
        return new Response('missing', { status: 404 });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    render(<App />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('maps/map-fixture/shell.json'));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Main Menu' })).not.toBeNull());
  });

  it('loads shipped audio.json settings and buses from the copied map package', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'maps/map-fixture/audio.json') {
        return jsonResponse({
          buses: [
            { id: 'project.music', label: 'Project Music', kind: 'music', defaultVolume: 0.25 },
            { id: 'project.sfx', label: 'Project SFX', kind: 'sfx', defaultVolume: 0.5 },
          ],
          cues: [
            {
              id: 'project.shell.menuMusic',
              label: 'Menu Loop',
              busId: 'project.music',
              defaultVolume: 1,
              binding: 'shell.menuMusic',
              classification: 'music',
              source: { url: 'assets/packs/pack-a-1.0.0/audio/menu.ogg', mime: 'audio/ogg' },
              loop: true,
              maxOverlap: 1,
            },
          ],
          settings: {
            masterVolume: 0.42,
            muted: false,
            muteOnFocusLoss: true,
            busVolumes: { 'project.music': 0.33, 'project.sfx': 0.44 },
          },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await waitFor(() => expect(screen.getByTestId('shell-screen-main-menu')).not.toBeNull());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('maps/map-fixture/audio.json'));

    await user.click(screen.getByTestId('shell-action-menu-settings'));
    await user.click(screen.getByTestId('settings-tab-audio'));

    expect((screen.getByTestId('audio-master-volume') as HTMLInputElement).value).toBe('42');
    expect((screen.getByTestId('audio-bus-project.music') as HTMLInputElement).value).toBe('33');
    expect((screen.getByTestId('audio-bus-project.sfx') as HTMLInputElement).value).toBe('44');
    expect(screen.queryByTestId('audio-bus-battle-royale.sfx')).toBeNull();
  });

  it('recovers to fallback shell audio settings when shipped audio resources fail', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'maps/map-fixture/audio.json') {
        return new Response('missing', { status: 404 });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await waitFor(() => expect(screen.getByTestId('shell-screen-main-menu')).not.toBeNull());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('maps/map-fixture/audio.json'));

    await user.click(screen.getByTestId('shell-action-menu-settings'));
    await user.click(screen.getByTestId('settings-tab-audio'));

    expect(screen.getByTestId('audio-settings')).not.toBeNull();
    expect((screen.getByTestId('audio-master-volume') as HTMLInputElement).value).toBe('100');
    expect((screen.getByTestId('audio-bus-battle-royale.sfx') as HTMLInputElement).value).toBe(
      '85',
    );
  });

  it('feeds authoritative shipped room frames through HUD, audio, and results exactly once', async () => {
    const user = userEvent.setup();
    const playedCueIds: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/lobbies/create')) {
        return jsonResponse(
          {
            roomId: 'room-1',
            wsUrl: 'http://localhost/rooms/room-1/connect?playerId=player-1&token=handoff-1',
            joinCode: 'ABC234',
            joinUrl: 'http://localhost/lobbies/join?code=ABC234',
            playerId: 'player-1',
            handoffToken: 'handoff-1',
            reconnectToken: 'reconnect-1',
            lobby: lobbySummary(),
          },
          201,
        );
      }
      if (url.endsWith('/lobbies/room-1/ready')) {
        return jsonResponse({
          lobby: lobbySummary({ ready: true, canStart: true }),
          canStart: true,
        });
      }
      throw new Error(`unexpected fetch ${url} ${String(init?.method)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App audioEngineFactory={() => createSpyAudioEngine(playedCueIds)} />);
    await waitFor(() => expect(screen.getByTestId('shell-screen-main-menu')).not.toBeNull());

    await user.click(screen.getByTestId('br-quick-play'));
    await user.click(screen.getByTestId('create-lobby'));
    await waitFor(() => expect(screen.getByTestId('lobby-code').textContent).toBe('ABC234'));
    await user.click(screen.getByTestId('ready-toggle'));
    await waitFor(() =>
      expect(screen.getByTestId('lobby-player-player-1').textContent).toContain('Ready'),
    );
    await user.click(screen.getByTestId('start-match'));
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0]!;
    expect(socket.url).toBe(
      'ws://localhost/rooms/room-1/connect?playerId=player-1&token=handoff-1',
    );
    expect(playedCueIds).not.toContain('battle-royale.item.collect');
    expect(playedCueIds).not.toContain('battle-royale.player.hit');
    expect(playedCueIds).not.toContain('battle-royale.player.eliminated');
    expect(playedCueIds).not.toContain('battle-royale.zone.warning');
    expect(playedCueIds).not.toContain('battle-royale.match.end');
    socket.send.mockClear();

    emitServerFrame(
      socket,
      createInitialFrame({
        tick: 1,
        zone: { cx: 0, cy: 0, radius: 100 },
        players: [
          {
            playerId: 'player-1',
            x: 0,
            y: 0,
            health: 100,
            inventory: { itemIds: [], capacity: 4 },
            stats: { kills: 0, deaths: 0 },
          },
          {
            playerId: 'player-2',
            x: 10,
            y: 0,
            health: 100,
            inventory: { itemIds: [], capacity: 4 },
            stats: { kills: 0, deaths: 0 },
          },
        ],
      }),
    );
    await waitFor(() => expect(socket.send).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('in-match')).not.toBeNull();
    expect(screen.getByTestId('playtest-hud-player-name').textContent).toBe('You');

    emitServerFrame(
      socket,
      deltaFrame({
        tick: 2,
        updated: [
          {
            id: BattleRoyaleProtocol.makePlayerId('player-1'),
            ...emptyDeltaOptions,
            inventory: Option.some({ itemIds: ['health-pack'], capacity: 4 }),
            pickupToast: Option.some({
              itemKind: 'health-pack',
              tier: 'common',
              quantity: 1,
              tick: 2,
            }),
          },
        ],
      }),
    );
    await waitFor(() => expect(playedCueIds).toContain('battle-royale.item.collect'));
    expect(playedCueIds).not.toContain('battle-royale.player.hit');

    emitServerFrame(
      socket,
      deltaFrame({
        tick: 3,
        updated: [
          {
            id: BattleRoyaleProtocol.makePlayerId('player-1'),
            ...emptyDeltaOptions,
            health: Option.some(65),
            damageIndicator: Option.some({
              sourceId: 'player-2',
              angleDeg: 180,
              amount: 35,
              tick: 3,
            }),
          },
        ],
      }),
    );
    await waitFor(() => expect(playedCueIds).toContain('battle-royale.player.hit'));
    expect(playedCueIds).not.toContain('battle-royale.zone.warning');

    emitServerFrame(
      socket,
      deltaFrame({
        tick: 4,
        zone: { cx: 0, cy: 0, radius: 80 },
      }),
    );
    await waitFor(() => expect(playedCueIds).toContain('battle-royale.zone.warning'));
    expect(playedCueIds).not.toContain('battle-royale.player.eliminated');

    emitServerFrame(
      socket,
      deltaFrame({
        tick: 5,
        updated: [
          {
            id: BattleRoyaleProtocol.makePlayerId('player-2'),
            ...emptyDeltaOptions,
            health: Option.some(0),
            stats: Option.some({ kills: 0, deaths: 1 }),
          },
          {
            id: BattleRoyaleProtocol.makePlayerId('player-1'),
            ...emptyDeltaOptions,
            stats: Option.some({ kills: 1, deaths: 0 }),
          },
        ],
      }),
    );
    emitServerFrame(
      socket,
      new BattleRoyaleProtocol.PlayerKilled({
        killer: BattleRoyaleProtocol.makePlayerId('player-1'),
        victim: BattleRoyaleProtocol.makePlayerId('player-2'),
        tick: 5,
      }),
    );
    await waitFor(() => expect(playedCueIds).toContain('battle-royale.player.eliminated'));
    expect(screen.getByTestId('in-match')).not.toBeNull();
    expect(playedCueIds).not.toContain('battle-royale.match.end');

    emitServerFrame(
      socket,
      new BattleRoyaleProtocol.GameOver({ winner: BattleRoyaleProtocol.makePlayerId('player-1') }),
    );
    emitServerFrame(
      socket,
      new BattleRoyaleProtocol.GameOver({ winner: BattleRoyaleProtocol.makePlayerId('player-1') }),
    );

    await waitFor(() =>
      expect(playedCueIds.filter((cueId) => cueId === 'battle-royale.match.end')).toHaveLength(1),
    );
    expect(screen.getByTestId('results-screen')).not.toBeNull();
    expect(screen.getByText('Victory')).not.toBeNull();
  });

  it('routes shipped shell WebSocket events through the room and Workerd service back into RuntimeRoot', async () => {
    installWorkerGlobals();
    const worker = (await import('../../game-host/src/behavior/workerd/service-worker.js')).default;
    const roomState = createFakeDurableObjectState();
    const room = new PlaytestRoom(asDurableObjectState(roomState), {
      HANDOFF_SIGNING_KEY: TEST_KEY,
      PLAYTEST_ROOM: {
        idFromName: (name: string) => ({ toString: () => name }) as DurableObjectId,
        get: () => ({ fetch: async () => new Response('unused') }),
      },
      ROOM_IDLE_TIMEOUT_SECONDS: 1,
      BEHAVIOR_RUNTIME: {
        fetch: (request: Request) => worker.fetch(request),
      },
    });
    const mapPackage = JSON.parse(JSON.stringify(bundledMapPackages[0]!.mapPackage)) as Record<
      string,
      unknown
    >;
    (mapPackage.manifest as Record<string, unknown>).packageId = shellE2EPackageId;
    mapPackage.behaviors = {
      schemaVersion: 1,
      manifests: [],
      visualDefinitions: [],
      modules: [
        {
          behaviorId: shellE2EBehaviorId,
          sourceKind: 'typescript',
          modulePath: 'behaviors/modules/shell-app-e2e.mjs',
          hash: shellE2ECodeHash,
        },
      ],
    };
    const handoffToken = await mintHandoffToken(
      { HANDOFF_SIGNING_KEY: TEST_KEY },
      { playtestId: 'room-1', playerId: 'player-1', ttlSeconds: 120 },
    );
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/lobbies/create')) {
        const body = JSON.parse(String(init?.body)) as { readonly shellProjection?: unknown };
        await room.create({
          mapId: 'map:fixture',
          seed: 42,
          options: { countdownSeconds: 0, minReadyPlayers: 1 },
          mapPackage,
          ...(body.shellProjection === undefined
            ? {}
            : { shellProjection: body.shellProjection as never }),
        });
        await room.addPlayer('player-1', handoffToken, 'room-1', { broadcast: false });
        return jsonResponse(
          {
            roomId: 'room-1',
            wsUrl: `http://localhost/rooms/room-1/connect?playerId=player-1&token=${handoffToken}`,
            joinCode: 'ABC234',
            joinUrl: 'http://localhost/lobbies/join?code=ABC234',
            playerId: 'player-1',
            handoffToken,
            reconnectToken: 'reconnect-1',
            lobby: lobbySummary(),
          },
          201,
        );
      }
      if (url.endsWith('/lobbies/room-1/ready')) {
        await room.fetch(
          new Request('https://room/lobby/ready?roomId=room-1', {
            method: 'POST',
            body: JSON.stringify({ playerId: 'player-1', ready: true }),
          }),
        );
        await room.alarm();
        return jsonResponse({
          lobby: lobbySummary({ ready: true, canStart: true }),
          canStart: true,
        });
      }
      throw new Error(`unexpected fetch ${url} ${String(init?.method)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await waitFor(() => expect(screen.getByTestId('shell-screen-main-menu')).not.toBeNull());
    await user.click(screen.getByTestId('br-quick-play'));
    await user.click(screen.getByTestId('create-lobby'));
    await waitFor(() => expect(screen.getByTestId('lobby-code').textContent).toBe('ABC234'));
    await user.click(screen.getByTestId('ready-toggle'));
    await waitFor(() =>
      expect(screen.getByTestId('lobby-player-player-1').textContent).toContain('Ready'),
    );
    activeRoomConnection = { room, playerId: 'player-1' };
    await user.click(screen.getByTestId('start-match'));
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0]!;
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() =>
      expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('shell.pause.entered')),
    );

    await room.alarm();

    await waitFor(() => expect(screen.getByTestId('shell-screen-main-menu')).not.toBeNull());
  });

  it('persists BR keybind remaps from the runtime shell Controls tab', async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('shell-screen-main-menu')).not.toBeNull());

    await user.click(screen.getByTestId('shell-action-menu-settings'));
    await user.click(screen.getByTestId('settings-tab-controls'));
    expect(screen.getByTestId(`controls-binding-${PRIMARY_ACTION}`).textContent).toContain('Space');

    await user.click(screen.getByTestId(`controls-rebind-${PRIMARY_ACTION}`));
    await user.keyboard('f');
    expect(screen.getByTestId(`controls-binding-${PRIMARY_ACTION}`).textContent).toBe('F');

    await user.click(screen.getByTestId('controls-save'));
    const stored = JSON.parse(
      String(window.localStorage.getItem(USER_INPUT_OVERLAY_STORAGE_KEY)),
    ) as {
      readonly schemeDefaults?: Record<
        string,
        readonly {
          readonly action: string;
          readonly trigger: { readonly _tag: string; readonly code?: string };
        }[]
      >;
    };
    const primary = stored.schemeDefaults?.['keyboard-mouse']?.find(
      (binding) => binding.action === PRIMARY_ACTION,
    );
    expect(primary?.trigger).toEqual({ _tag: 'key', code: 'KeyF' });

    await user.click(screen.getByTestId(`controls-reset-${PRIMARY_ACTION}`));
    await user.click(screen.getByTestId('controls-save'));
    expect(window.localStorage.getItem(USER_INPUT_OVERLAY_STORAGE_KEY)).toBeNull();
  });

  it('joins a lobby by code with mocked fetch', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/lobbies/join')) {
        return jsonResponse(
          {
            roomId: 'room-1',
            playerId: 'player-2',
            wsUrl: 'http://localhost/rooms/room-1/connect?playerId=player-2&token=handoff-2',
            handoffToken: 'handoff-2',
            reconnectToken: 'reconnect-2',
            lobby: lobbySummary({ playerId: 'player-2', displayName: 'Grace' }),
          },
          201,
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await waitFor(() => expect(screen.getByTestId('shell-screen-main-menu')).not.toBeNull());
    await user.click(screen.getByTestId('br-quick-play'));
    await user.type(screen.getByTestId('lobby-display-name'), 'Grace');
    await user.type(screen.getByTestId('lobby-join-code'), 'abc234');
    await user.click(screen.getByTestId('join-lobby'));

    await waitFor(() =>
      expect(screen.getByTestId('lobby-player-player-2').textContent).toContain('Grace'),
    );
    const joinCall = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith('/lobbies/join'),
    );
    expect(String(joinCall?.[0])).toMatch(/\/lobbies\/join$/);
    expect(JSON.parse(String(joinCall?.[1]?.body))).toEqual({
      joinCode: 'ABC234',
      displayName: 'Grace',
    });
  });

  it('reconnects from stored lobby credentials and stores the fresh reconnect token', async () => {
    window.localStorage.setItem(
      'tileborne.game-client.lobby-reconnect.v1',
      JSON.stringify({
        roomId: 'room-1',
        playerId: 'player-1',
        reconnectToken: 'old-reconnect',
      }),
    );
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/rooms/reconnect')) {
        return jsonResponse({
          roomId: 'room-1',
          playerId: 'player-1',
          wsUrl: 'http://localhost/rooms/room-1/connect?playerId=player-1&token=fresh-handoff',
          handoffToken: 'fresh-handoff',
          reconnectToken: 'fresh-reconnect',
          lobby: lobbySummary({ ready: true }),
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await waitFor(() => expect(screen.getByTestId('shell-screen-main-menu')).not.toBeNull());
    await user.click(screen.getByTestId('br-quick-play'));
    expect(screen.getByTestId('lobby-reconnect-prompt').textContent).toContain('player-1');
    await user.click(screen.getByRole('button', { name: /reconnect/i }));

    await waitFor(() =>
      expect(screen.getByTestId('lobby-ws-url').textContent).toContain(
        'ws://localhost/rooms/room-1/connect',
      ),
    );
    expect(screen.getByTestId('lobby-ws-url').textContent).toContain('token=redacted');
    expect(screen.getByTestId('lobby-ws-url').textContent).not.toContain('fresh-handoff');
    const reconnectCall = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith('/rooms/reconnect'),
    );
    expect(JSON.parse(String(reconnectCall?.[1]?.body))).toEqual({
      roomId: 'room-1',
      playerId: 'player-1',
      reconnectToken: 'old-reconnect',
    });
    expect(
      JSON.parse(String(window.localStorage.getItem('tileborne.game-client.lobby-reconnect.v1'))),
    ).toEqual({
      roomId: 'room-1',
      playerId: 'player-1',
      reconnectToken: 'fresh-reconnect',
    });
  });
});
