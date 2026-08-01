import type { RuntimeAudioPlaybackEngine } from '@tileborne/game-client';
import * as BattleRoyaleProtocol from '@tileborne/ipc-contracts/protocols/battle-royale';
import { encodeServerFrame } from '@tileborne/plugin-battle-royale';
import { acceptedBattleRoyaleFireFlow } from '@tileborne/plugin-battle-royale/test';
import type { PixiRendererAdapter } from '@tileborne/runtime';
import { Option } from 'effect';
import { createRoot } from 'react-dom/client';

import { App } from '../app.js';

interface SmokeWindow {
  tileborneSmoke?: {
    readonly playedCueIds: readonly string[];
    readonly emitAcceptedFireFlow: () => void;
    readonly emitReplayFlow: () => void;
    readonly emitRemoteMovementFlow: () => void;
    readonly muzzleIds: () => readonly string[];
    readonly muzzleSnapshot: () => readonly {
      readonly id: string;
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly spriteOrdinal: number;
    }[];
    readonly socketUrl: () => string | undefined;
    readonly sentCount: () => number;
    readonly sentInputSeqs: () => readonly number[];
    readonly spriteIds: () => readonly string[];
    readonly spritePosition: (id: string) => { readonly x: number; readonly y: number } | undefined;
  };
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const lobbySummary = (input: { readonly ready?: boolean; readonly canStart?: boolean } = {}) => ({
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
      playerId: 'player-1',
      displayName: 'You',
      ready: input.ready ?? false,
      connected: true,
      isHost: true,
    },
  ],
});

class SmokeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static readonly instances: SmokeWebSocket[] = [];

  binaryType: BinaryType = 'arraybuffer';
  readyState = SmokeWebSocket.OPEN;
  onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null = null;
  onerror: ((this: WebSocket, ev: Event) => unknown) | null = null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null = null;
  onopen: ((this: WebSocket, ev: Event) => unknown) | null = null;
  readonly listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  readonly sent: unknown[] = [];
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    SmokeWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.onopen?.call(this as unknown as WebSocket, new Event('open'));
    });
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = SmokeWebSocket.CLOSED;
    this.onclose?.call(this as unknown as WebSocket, new CloseEvent('close', { code: 1000 }));
  }

  emitMessage(data: ArrayBuffer | Uint8Array | string): void {
    const event = new MessageEvent('message', { data });
    this.onmessage?.call(this as unknown as WebSocket, event);
    for (const listener of this.listeners.get('message') ?? []) {
      listener(event);
    }
  }
}

const installFetch = (): void => {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.startsWith('data:')) {
      return nativeFetch(input, init);
    }
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
      return jsonResponse({ lobby: lobbySummary({ ready: true, canStart: true }), canStart: true });
    }
    throw new Error(`unexpected fetch ${url} ${String(init?.method)}`);
  };
};

const createSmokeAudioEngine = (playedCueIds: string[]): RuntimeAudioPlaybackEngine => ({
  playCue: (cue) => {
    const cueId = typeof cue === 'string' ? cue : cue.cueId;
    playedCueIds.push(cueId);
    return {
      cueId,
      busId: 'battle-royale.sfx',
      gain: 1,
      audible: true,
      loop: false,
      maxOverlap: 4,
    };
  },
  stopCue: () => undefined,
  stopAll: () => undefined,
  setSettings: () => undefined,
  setFocusState: () => undefined,
  snapshot: () => ({
    supported: true,
    focusState: 'focused',
    settings: { masterVolume: 1, muted: false, muteOnFocusLoss: true, busVolumes: {} },
    playCount: playedCueIds.length,
    audiblePlayCount: playedCueIds.length,
    unsupportedPlayCount: 0,
    activeSourceCount: 0,
  }),
  dispose: () => undefined,
});

installFetch();
Object.defineProperty(window, 'WebSocket', { configurable: true, value: SmokeWebSocket });

const flow = acceptedBattleRoyaleFireFlow();
const playedCueIds: string[] = [];
let adapter: PixiRendererAdapter | undefined;

const socket = (): SmokeWebSocket => {
  const current = SmokeWebSocket.instances[0];
  if (current === undefined) {
    throw new Error('runtime socket is not connected');
  }
  return current;
};

const emitFrame = (frame: unknown): void => {
  socket().emitMessage(encodeServerFrame(frame));
};

const spritePool = (): Map<string, unknown> =>
  (adapter as unknown as { readonly spritePoolByStringId: Map<string, unknown> })
    .spritePoolByStringId;

(window as SmokeWindow).tileborneSmoke = {
  playedCueIds,
  emitAcceptedFireFlow: () => {
    emitFrame(flow.welcomeFrame);
    for (const [sequence, event] of flow.events.entries()) {
      const decodedFrame = BattleRoyaleProtocol.decodeServerMessage(
        BattleRoyaleProtocol.encodeServerMessage(
          new BattleRoyaleProtocol.GameplayEventFrame({ sequence, event }),
        ),
      );
      emitFrame(decodedFrame);
    }
    emitFrame(flow.acceptedDeltaFrame);
  },
  emitReplayFlow: () => {
    emitFrame(flow.replayDeltaFrame);
    emitFrame(new BattleRoyaleProtocol.GameplayEventFrame({ sequence: 1, event: flow.events[1]! }));
  },
  emitRemoteMovementFlow: () => {
    const remoteUpdate = flow.acceptedDeltaFrame.updated.find(
      (update) => update.id === 'player-2',
    );
    if (remoteUpdate === undefined) {
      throw new Error('accepted fire fixture has no remote player update');
    }
    emitFrame(
      new BattleRoyaleProtocol.DeltaSnapshot({
        ...flow.replayDeltaFrame,
        tick: flow.replayDeltaFrame.tick + 1,
        serverTimestampMs: flow.replayDeltaFrame.serverTimestampMs + 100,
        updated: [
          {
            ...remoteUpdate,
            x: Option.some(110),
            y: Option.some(10),
          },
        ],
      }),
    );
  },
  muzzleIds: () => [...spritePool().keys()].filter((id) => id.startsWith('br:muzzle:')),
  muzzleSnapshot: () =>
    ['br:muzzle:player-1', 'br:muzzle:player-2'].map((id, index, sprites) => {
      const sprite = spritePool().get(id) as {
        readonly position: { readonly x: number; readonly y: number };
        readonly texture: { readonly source: { readonly width: number; readonly height: number } };
      };
      return {
        id,
        x: sprite.position.x,
        y: sprite.position.y,
        width: sprite.texture.source.width,
        height: sprite.texture.source.height,
        spriteOrdinal: sprites.findIndex((spriteId) => spritePool().get(spriteId) === sprite),
      };
    }),
  socketUrl: () => SmokeWebSocket.instances[0]?.url,
  sentCount: () => SmokeWebSocket.instances[0]?.sent.length ?? 0,
  sentInputSeqs: () =>
    (SmokeWebSocket.instances[0]?.sent ?? []).flatMap((frame) => {
      const bytes =
        frame instanceof Uint8Array
          ? frame
          : frame instanceof ArrayBuffer
            ? new Uint8Array(frame)
            : undefined;
      if (bytes === undefined) return [];
      try {
        const decoded = BattleRoyaleProtocol.decodeClientMessage(bytes);
        return decoded._tag === 'PlayerInput' ? [decoded.seq] : [];
      } catch {
        return [];
      }
    }),
  spriteIds: () => [...spritePool().keys()],
  spritePosition: (id: string) => {
    const sprite = spritePool().get(id) as
      | { readonly position: { readonly x: number; readonly y: number } }
      | undefined;
    return sprite === undefined ? undefined : { x: sprite.position.x, y: sprite.position.y };
  },
};

createRoot(document.getElementById('root')!).render(
  <App
    audioEngineFactory={() => createSmokeAudioEngine(playedCueIds)}
    onRuntimeRendererReady={(nextAdapter) => {
      adapter = nextAdapter;
    }}
  />,
);
