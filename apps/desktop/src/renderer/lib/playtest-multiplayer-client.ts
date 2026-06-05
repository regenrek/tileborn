import {
  decodeMessage as decodeRuntimeMessage,
  type RuntimeMessage,
} from '@tileborne/runtime';

import type { PlaytestHudEvent, PlaytestHudState } from '@/lib/playtest-hud-utils';
import {
  BATTLE_ROYALE_PLUGIN_ID,
  resolvePlaytestPlugin,
  type InputDirection,
  type ResolvedPlaytestPlugin,
  type ServerFrameView,
  type ZoneView,
} from '@/lib/playtest-plugin-bridge';

type ZoneStatusState = NonNullable<PlaytestHudState['zoneStatus']>;

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

export type MultiplayerConnectionPhase = 'idle' | 'connecting' | 'live' | 'error' | 'disconnected';

export interface MultiplayerPlayerState {
  readonly playerId: string;
  readonly x: number;
  readonly y: number;
  readonly health: number;
}

export interface MultiplayerSessionState {
  readonly phase: MultiplayerConnectionPhase;
  readonly localPlayerId: string | null;
  readonly tick: number;
  readonly players: readonly MultiplayerPlayerState[];
  readonly zone: ZoneView;
  readonly hud: PlaytestHudState;
  readonly errorMessage: string | null;
}

const defaultZone = (mapWidth: number, mapHeight: number): ZoneView => ({
  cx: mapWidth / 2,
  cy: mapHeight / 2,
  radius: Math.max(mapWidth, mapHeight),
});

const resolveRequiredPlugin = (): ResolvedPlaytestPlugin => {
  const plugin = resolvePlaytestPlugin(BATTLE_ROYALE_PLUGIN_ID);
  if (plugin === undefined) {
    throw new Error(`Missing playtest plugin ${BATTLE_ROYALE_PLUGIN_ID}`);
  }
  return plugin;
};

const toInitialFrame = (
  plugin: ResolvedPlaytestPlugin,
  tick: number,
  players: readonly MultiplayerPlayerState[],
  zone: ZoneView,
): unknown =>
  plugin.createInitialFrame({
    tick,
    players: players.map((player) => ({
      playerId: player.playerId,
      x: player.x,
      y: player.y,
      health: player.health,
    })),
    zone,
  });

const formatPlayerDisplayName = (playerId: string): string => {
  const match = /^player-(\d+)$/.exec(playerId);
  if (match) {
    return `Player ${match[1]}`;
  }
  return playerId;
};

export class PlaytestMultiplayerClient {
  private socket: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private seq = 0;
  private tick = 0;
  private players = new Map<string, MultiplayerPlayerState>();
  private localPlayerId: string | null = null;
  private zone: ZoneView = defaultZone(64, 64);
  private zoneStatus: ZoneStatusState = { phase: 'stable' };
  private readonly recentEvents: PlaytestHudEvent[] = [];
  private gameOver: PlaytestHudState['gameOver'];
  private maxPlayersSeen = 0;
  private phase: MultiplayerConnectionPhase = 'idle';
  private errorMessage: string | null = null;
  private onSnapshotFrame: ((frame: unknown) => void) | undefined;

  constructor(
    private readonly mapWidth: number,
    private readonly mapHeight: number,
    private readonly onStateChange: (state: MultiplayerSessionState) => void,
    private readonly onInitialFrame: (snapshot: unknown) => void,
    private readonly plugin: ResolvedPlaytestPlugin = resolveRequiredPlugin(),
  ) {
    this.zone = defaultZone(mapWidth, mapHeight);
  }

  /**
   * Subscribe to decoded plugin snapshot frames as opaque `unknown`
   * values. Used by the playtest viewport to drive a `SnapshotEntityStore`
   * without naming plugin wire protocol types. Returns an unsubscribe.
   */
  setSnapshotFrameListener(handler: (frame: unknown) => void): () => void {
    this.onSnapshotFrame = handler;
    return () => {
      if (this.onSnapshotFrame === handler) {
        this.onSnapshotFrame = undefined;
      }
    };
  }

  getLocalPlayerId(): string | null {
    return this.localPlayerId;
  }

  getState(): MultiplayerSessionState {
    return {
      phase: this.phase,
      localPlayerId: this.localPlayerId,
      tick: this.tick,
      players: [...this.players.values()],
      zone: this.zone,
      hud: this.getHudState(),
      errorMessage: this.errorMessage,
    };
  }

  private getHudState(): PlaytestHudState {
    const totalPlayers = Math.max(this.maxPlayersSeen, this.players.size);
    const localPlayer = this.localPlayerId ? this.players.get(this.localPlayerId) : undefined;
    const gameOver =
      this.gameOver === undefined
        ? undefined
        : {
            ...this.gameOver,
            alivePlayers: this.players.size,
            totalPlayers,
            tickCount: this.tick,
          };
    return {
      totalPlayers,
      recentEvents: gameOver
        ? this.recentEvents.map((event) =>
            event._tag === 'GameOver'
              ? {
                  ...event,
                  alivePlayers: gameOver.alivePlayers,
                  totalPlayers: gameOver.totalPlayers,
                  tickCount: gameOver.tickCount,
                }
              : event,
          )
        : [...this.recentEvents],
      ...(localPlayer
        ? {
            localPlayer: {
              playerId: localPlayer.playerId,
              displayName: formatPlayerDisplayName(localPlayer.playerId),
              health: localPlayer.health,
              maxHealth: 100,
            },
          }
        : {}),
      zoneStatus: this.zoneStatus,
      ...(gameOver ? { gameOver } : {}),
    };
  }

  private emitState(): void {
    this.onStateChange(this.getState());
  }

  private emitWelcomeIfReady(): void {
    if (this.phase === 'live' || this.players.size === 0) {
      return;
    }
    this.phase = 'live';
    const snapshot = toInitialFrame(this.plugin, this.tick, [...this.players.values()], this.zone);
    this.onInitialFrame(snapshot);
    this.emitState();
  }

  private handleRuntimeMessage(message: RuntimeMessage): void {
    if (message._tag === 'PlayerJoined') {
      const existing = this.players.get(message.playerId);
      if (!existing) {
        this.players.set(message.playerId, {
          playerId: message.playerId,
          x: this.mapWidth / 2,
          y: this.mapHeight / 2,
          health: 100,
        });
      }
      this.emitWelcomeIfReady();
      this.emitState();
      return;
    }
    if (message._tag === 'PlayerLeft') {
      this.players.delete(message.playerId);
      this.emitState();
      return;
    }
    if (message._tag === 'SnapshotDelta') {
      this.tick = message.tick;
      this.emitState();
      return;
    }
    if (message._tag === 'SnapshotFull') {
      this.tick += 1;
      this.emitWelcomeIfReady();
      this.emitState();
    }
  }

  private handlePluginFrameView(message: ServerFrameView): void {
    if (message.kind === 'initial') {
      this.tick = message.tick;
      this.zone = message.zone;
      this.zoneStatus = { phase: 'stable' };
      this.players.clear();
      for (const player of message.players) {
        this.players.set(player.playerId, {
          playerId: player.playerId,
          x: player.x,
          y: player.y,
          health: player.health,
        });
      }
      this.maxPlayersSeen = Math.max(this.maxPlayersSeen, this.players.size);
      this.phase = 'live';
      this.emitState();
      return;
    }
    if (message.kind === 'delta') {
      this.tick = message.tick;
      if (message.zone !== undefined) {
        const nextZone = message.zone;
        this.zoneStatus =
          nextZone.radius < this.zone.radius ? { phase: 'shrinking' } : { phase: 'stable' };
        this.zone = nextZone;
      }
      for (const removed of message.removed) {
        this.players.delete(removed);
      }
      for (const updated of message.updated) {
        const current = this.players.get(updated.playerId) ?? {
          playerId: updated.playerId,
          x: this.mapWidth / 2,
          y: this.mapHeight / 2,
          health: 100,
        };
        this.players.set(updated.playerId, {
          playerId: updated.playerId,
          x: updated.x ?? current.x,
          y: updated.y ?? current.y,
          health: updated.health ?? current.health,
        });
      }
      this.maxPlayersSeen = Math.max(this.maxPlayersSeen, this.players.size);
      this.emitState();
      return;
    }
    if (message.kind === 'joined') {
      const playerId = message.id;
      if (!this.players.has(playerId)) {
        this.players.set(playerId, {
          playerId,
          x: this.mapWidth / 2,
          y: this.mapHeight / 2,
          health: 100,
        });
      }
      this.maxPlayersSeen = Math.max(this.maxPlayersSeen, this.players.size);
      this.emitWelcomeIfReady();
      this.emitState();
      return;
    }
    if (message.kind === 'left') {
      this.players.delete(message.id);
      this.emitState();
      return;
    }
    if (message.kind === 'killed') {
      this.recentEvents.push({
        _tag: 'PlayerKilled',
        victimId: message.victim,
        victimDisplayName: formatPlayerDisplayName(message.victim),
        killerId: message.killer,
        tick: message.tick,
        emittedAtMs: Date.now(),
      });
      this.emitState();
      return;
    }
    if (message.kind === 'game-over') {
      const winnerDisplayName = formatPlayerDisplayName(message.winner);
      this.gameOver = {
        winnerId: message.winner,
        winnerDisplayName,
        alivePlayers: this.players.size,
        totalPlayers: Math.max(this.maxPlayersSeen, this.players.size),
        tickCount: this.tick,
      };
      this.recentEvents.push({
        _tag: 'GameOver',
        winnerId: message.winner,
        winnerDisplayName,
        alivePlayers: this.gameOver.alivePlayers,
        totalPlayers: this.gameOver.totalPlayers,
        tickCount: this.gameOver.tickCount,
        emittedAtMs: Date.now(),
      });
      this.emitState();
    }
  }

  connect(wsUrl: string, localPlayerId: string): void {
    this.disconnect();
    this.localPlayerId = localPlayerId;
    this.phase = 'connecting';
    this.errorMessage = null;
    this.emitState();

    const socket = new WebSocket(wsUrl);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.heartbeatTimer = setInterval(() => {
        if (socket.readyState !== WebSocket.OPEN) {
          return;
        }
        const heartbeatBytes = this.plugin.encodeHeartbeatFrame(this.tick);
        socket.send(toArrayBuffer(heartbeatBytes));
      }, 2_000);
    });

    socket.addEventListener('message', (event) => {
      const data = event.data;
      if (!(data instanceof ArrayBuffer)) {
        return;
      }
      const frame = new Uint8Array(data);
      try {
        const pluginFrame = this.plugin.decodeServerFrame(frame);
        if (pluginFrame === undefined) {
          throw new Error('Invalid plugin frame');
        }
        const frameView = this.plugin.serverFrameToView(pluginFrame);
        if (frameView === undefined) {
          throw new Error('Unsupported plugin frame');
        }
        if (frameView.kind === 'initial') {
          this.onInitialFrame(pluginFrame);
          this.onSnapshotFrame?.(pluginFrame);
        } else if (frameView.kind === 'delta') {
          this.onSnapshotFrame?.(pluginFrame);
        }
        this.handlePluginFrameView(frameView);
        return;
      } catch {
        // Fall through to runtime wire codec used by game-host.
      }
      try {
        this.handleRuntimeMessage(decodeRuntimeMessage(frame));
      } catch {
        this.phase = 'error';
        this.errorMessage = 'Invalid protocol frame';
        this.emitState();
      }
    });

    socket.addEventListener('error', () => {
      this.phase = 'error';
      this.errorMessage = 'WebSocket connection failed';
      this.emitState();
    });

    socket.addEventListener('close', () => {
      if (this.phase !== 'error') {
        this.phase = 'disconnected';
      }
      this.emitState();
    });
  }

  /**
   * Send a single client input frame. The renderer hands us a high-level
   * direction + shoot flag + optional aim/weapon hints; we encode them through
   * the plugin bridge (`encodeClientInputFrame`) which is the single point
   * that knows the on-the-wire shape. ADR-0014 Phase 1 boundary invariant:
   * this is the only place outgoing inputs are constructed.
   */
  sendInput(
    dir: InputDirection | undefined,
    shoot = false,
    options?: { readonly aimDeg?: number; readonly weaponSlot?: number },
  ): void {
    const socket = this.socket;
    const localPlayerId = this.localPlayerId;
    if (!socket || socket.readyState !== WebSocket.OPEN || !localPlayerId) {
      return;
    }
    this.seq += 1;
    const brFrame = this.plugin.encodeClientInputFrame({
      tick: this.tick,
      seq: this.seq,
      ...(dir === undefined ? {} : { dir }),
      shoot,
      ...(options?.aimDeg !== undefined ? { aimDeg: options.aimDeg } : {}),
      ...(options?.weaponSlot !== undefined ? { weaponSlot: options.weaponSlot } : {}),
    });
    socket.send(toArrayBuffer(brFrame));
  }

  disconnect(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.players.clear();
    this.localPlayerId = null;
    this.seq = 0;
    this.tick = 0;
    this.phase = 'idle';
    this.errorMessage = null;
    this.zone = defaultZone(this.mapWidth, this.mapHeight);
    this.zoneStatus = { phase: 'stable' };
    this.recentEvents.length = 0;
    this.gameOver = undefined;
    this.maxPlayersSeen = 0;
  }
}
