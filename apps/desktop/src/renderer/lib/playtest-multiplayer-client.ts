import {
  decodeMessage as decodeRuntimeMessage,
  type RuntimeMessage,
} from '@tileborne/runtime';
import type { BattleRoyaleAbilityId } from '@tileborne/ipc-contracts/protocols/battle-royale';
import {
  GameplayEntityDefeated,
  GameplayItemGranted,
  GameplayMatchPhaseChanged,
  makeGameplayEntityId,
  makeGameplayItemId,
} from '@tileborne/ipc-contracts';

import type {
  HudEvent as PlaytestHudEvent,
  HudState as PlaytestHudState,
} from '@tileborne/game-client';
import {
  type InputDirection,
  type ResolvedPlaytestPlugin,
  type ServerFrameView,
  type ZoneView,
} from '@/lib/playtest-plugin-bridge';

type ZoneStatusState = NonNullable<PlaytestHudState['zoneStatus']>;
type InitialServerFrameView = Extract<ServerFrameView, { readonly kind: 'initial' }>;
type ServerFrameObjectView = NonNullable<InitialServerFrameView['objects']>[number];
type MinimapObject = NonNullable<PlaytestHudState['minimap']>['objects'][number];
type LocalPlayerState = NonNullable<PlaytestHudState['localPlayer']>;

const MAX_GAMEPLAY_EVENTS = 20;

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

export type MultiplayerConnectionPhase = 'idle' | 'connecting' | 'live' | 'error' | 'disconnected';

export interface MultiplayerPlayerState {
  readonly playerId: string;
  readonly team?: string;
  readonly x: number;
  readonly y: number;
  readonly health: number;
  readonly shield?: number;
  readonly armor?: NonNullable<PlaytestHudState['localPlayer']>['armor'];
  readonly weapon?: NonNullable<PlaytestHudState['localPlayer']>['weapon'];
  readonly inventory?: NonNullable<PlaytestHudState['localPlayer']>['inventory'];
  readonly pickupPrompt?: NonNullable<PlaytestHudState['localPlayer']>['pickupPrompt'];
  readonly pickupToast?: NonNullable<LocalPlayerState['pickupToast']>;
  readonly damageIndicator?: NonNullable<LocalPlayerState['damageIndicator']>;
  readonly stats?: NonNullable<PlaytestHudState['localPlayer']>['stats'];
  readonly statusEffects?: NonNullable<PlaytestHudState['localPlayer']>['statusEffects'];
  readonly abilityCooldowns?: NonNullable<PlaytestHudState['localPlayer']>['abilityCooldowns'];
}

interface MultiplayerObjectState {
  readonly objectId: string;
  readonly x: number;
  readonly y: number;
  readonly pickup?: ServerFrameObjectView['pickup'];
  readonly lootSource?: ServerFrameObjectView['lootSource'];
  readonly hazard?: ServerFrameObjectView['hazard'];
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
      ...(player.team === undefined ? {} : { team: player.team }),
      x: player.x,
      y: player.y,
      health: player.health,
      ...(player.shield === undefined ? {} : { shield: player.shield }),
      ...(player.armor === undefined ? {} : { armor: player.armor }),
      ...(player.weapon === undefined ? {} : { weapon: player.weapon }),
      ...(player.inventory === undefined ? {} : { inventory: player.inventory }),
      ...(player.pickupPrompt === undefined ? {} : { pickupPrompt: player.pickupPrompt }),
      ...(player.pickupToast === undefined ? {} : { pickupToast: player.pickupToast }),
      ...(player.damageIndicator === undefined ? {} : { damageIndicator: player.damageIndicator }),
      ...(player.stats === undefined ? {} : { stats: player.stats }),
      ...(player.statusEffects === undefined ? {} : { statusEffects: player.statusEffects }),
      ...(player.abilityCooldowns === undefined ? {} : { abilityCooldowns: player.abilityCooldowns }),
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
  private readonly gameplayEvents: PlaytestHudEvent[] = [];
  private readonly seenPickupToastKeys = new Set<string>();
  private gameOver: PlaytestHudState['gameOver'];
  private maxPlayersSeen = 0;
  private objects = new Map<string, MultiplayerObjectState>();
  private phase: MultiplayerConnectionPhase = 'idle';
  private errorMessage: string | null = null;
  private onSnapshotFrame: ((frame: unknown) => void) | undefined;
  private lastSnapshotAckTick = -1;

  constructor(
    private readonly mapWidth: number,
    private readonly mapHeight: number,
    private readonly onStateChange: (state: MultiplayerSessionState) => void,
    private readonly onInitialFrame: (snapshot: unknown) => void,
    /**
     * The ACTIVE game mode's resolved playtest runtime (ADR-0023 section B):
     * the caller resolves it from the discovered mode selection — this client
     * never names a plugin id.
     */
    private readonly plugin: ResolvedPlaytestPlugin,
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
    const scoreboard = [...this.players.values()]
      .map((player) => ({
        playerId: player.playerId,
        displayName: formatPlayerDisplayName(player.playerId),
        ...(player.team === undefined ? {} : { team: player.team }),
        health: player.health,
        alive: player.health > 0,
        kills: player.stats?.kills ?? 0,
        deaths: player.stats?.deaths ?? 0,
      }))
      .sort((left, right) => right.kills - left.kills || left.playerId.localeCompare(right.playerId));
    const minimapObjects: MinimapObject[] = [...this.objects.values()]
      .flatMap((object): MinimapObject[] => {
        if (object.hazard?.enabled) {
          return [{ objectId: object.objectId, x: object.x, y: object.y, kind: 'hazard' as const }];
        }
        if (object.pickup !== undefined) {
          return [{
            objectId: object.objectId,
            x: object.x,
            y: object.y,
            kind: 'pickup' as const,
            tier: object.pickup.tier,
            available: object.pickup.available,
          }];
        }
        if (object.lootSource !== undefined) {
          return [{
            objectId: object.objectId,
            x: object.x,
            y: object.y,
            kind: 'loot' as const,
            tier: object.lootSource.tier,
            available: !object.lootSource.collected,
          }];
        }
        return [];
      })
      .sort((left, right) => left.objectId.localeCompare(right.objectId));
    const hud: PlaytestHudState = {
      totalPlayers,
      gameplayEvents: gameOver
        ? this.gameplayEvents.map((event) =>
            event._tag === 'MatchPhaseChanged' && event.phase === 'finished'
              ? new GameplayMatchPhaseChanged({
                  ...event,
                  tick: gameOver.tickCount,
                })
              : event,
          )
        : [...this.gameplayEvents],
      ...(localPlayer
        ? {
            localPlayer: {
              playerId: localPlayer.playerId,
              displayName: formatPlayerDisplayName(localPlayer.playerId),
              ...(localPlayer.team === undefined ? {} : { team: localPlayer.team }),
              health: localPlayer.health,
              maxHealth: 100,
              position: { x: localPlayer.x, y: localPlayer.y },
              ...(localPlayer.shield === undefined ? {} : { shield: localPlayer.shield }),
              ...(localPlayer.armor === undefined ? {} : { armor: localPlayer.armor }),
              ...(localPlayer.weapon === undefined ? {} : { weapon: localPlayer.weapon }),
              ...(localPlayer.inventory === undefined ? {} : { inventory: localPlayer.inventory }),
              ...(localPlayer.pickupPrompt === undefined ? {} : { pickupPrompt: localPlayer.pickupPrompt }),
              ...(localPlayer.pickupToast === undefined ? {} : { pickupToast: localPlayer.pickupToast }),
              ...(localPlayer.damageIndicator === undefined ? {} : { damageIndicator: localPlayer.damageIndicator }),
              ...(localPlayer.stats === undefined ? {} : { stats: localPlayer.stats }),
              ...(localPlayer.statusEffects === undefined ? {} : { statusEffects: localPlayer.statusEffects }),
              ...(localPlayer.abilityCooldowns === undefined ? {} : { abilityCooldowns: localPlayer.abilityCooldowns }),
            },
          }
        : {}),
      zoneStatus: this.zoneStatus,
      scoreboard,
      minimap: {
        zone: this.zone,
        players: [...this.players.values()]
          .map((player) => ({
            playerId: player.playerId,
            x: player.x,
            y: player.y,
            local: player.playerId === this.localPlayerId,
            alive: player.health > 0,
            health: player.health,
          }))
          .sort((left, right) => left.playerId.localeCompare(right.playerId)),
        objects: minimapObjects,
      },
      ...(gameOver ? { gameOver } : {}),
    };
    return hud;
  }

  private pushGameplayEvent(event: PlaytestHudEvent): void {
    this.gameplayEvents.push(event);
    if (this.gameplayEvents.length > MAX_GAMEPLAY_EVENTS) {
      this.gameplayEvents.shift();
    }
  }

  private recordLocalPickupToast(): void {
    const localPlayer = this.localPlayerId ? this.players.get(this.localPlayerId) : undefined;
    const pickupToast = localPlayer?.pickupToast;
    if (localPlayer === undefined || pickupToast === undefined) {
      return;
    }
    const key = `${localPlayer.playerId}:${pickupToast.itemKind}:${pickupToast.tier}:${pickupToast.quantity}:${pickupToast.tick}`;
    if (this.seenPickupToastKeys.has(key)) {
      return;
    }
    this.seenPickupToastKeys.add(key);
    this.pushGameplayEvent(new GameplayItemGranted({
      targetId: makeGameplayEntityId(localPlayer.playerId),
      itemId: makeGameplayItemId(`${pickupToast.itemKind}:${pickupToast.tier}`),
      quantity: pickupToast.quantity,
      tick: pickupToast.tick,
    }));
  }

  private emitState(): void {
    this.onStateChange(this.getState());
  }

  private emitRuntimeSnapshotStarted(): void {
    this.phase = 'live';
    const snapshot = toInitialFrame(this.plugin, this.tick, [...this.players.values()], this.zone);
    this.onInitialFrame(snapshot);
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
      this.phase = 'live';
      this.emitState();
      return;
    }
    if (message._tag === 'SnapshotFull') {
      this.tick += 1;
      this.emitRuntimeSnapshotStarted();
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
          ...(player.team === undefined ? {} : { team: player.team }),
          x: player.x,
          y: player.y,
          health: player.health,
          ...(player.shield === undefined ? {} : { shield: player.shield }),
          ...(player.armor === undefined ? {} : { armor: player.armor }),
          ...(player.weapon === undefined ? {} : { weapon: player.weapon }),
          ...(player.inventory === undefined ? {} : { inventory: player.inventory }),
          ...(player.pickupPrompt === undefined ? {} : { pickupPrompt: player.pickupPrompt }),
          ...(player.pickupToast === undefined ? {} : { pickupToast: player.pickupToast }),
          ...(player.damageIndicator === undefined ? {} : { damageIndicator: player.damageIndicator }),
          ...(player.stats === undefined ? {} : { stats: player.stats }),
          ...(player.statusEffects === undefined ? {} : { statusEffects: player.statusEffects }),
          ...(player.abilityCooldowns === undefined ? {} : { abilityCooldowns: player.abilityCooldowns }),
        });
      }
      this.objects.clear();
      for (const object of message.objects ?? []) {
        this.objects.set(object.objectId, {
          objectId: object.objectId,
          x: object.x,
          y: object.y,
          ...(object.pickup === undefined ? {} : { pickup: object.pickup }),
          ...(object.lootSource === undefined ? {} : { lootSource: object.lootSource }),
          ...(object.hazard === undefined ? {} : { hazard: object.hazard }),
        });
      }
      this.maxPlayersSeen = Math.max(this.maxPlayersSeen, this.players.size);
      this.phase = 'live';
      this.recordLocalPickupToast();
      this.emitState();
      return;
    }
    if (message.kind === 'delta') {
      this.tick = message.tick;
      this.phase = 'live';
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
        const shield = updated.shield ?? current.shield;
        const armor = updated.armor ?? current.armor;
        const weapon = updated.weapon ?? current.weapon;
        const inventory = updated.inventory ?? current.inventory;
        const pickupPrompt = updated.pickupPrompt ?? current.pickupPrompt;
        const pickupToast = updated.pickupToast ?? current.pickupToast;
        const damageIndicator = updated.damageIndicator ?? current.damageIndicator;
        const stats = updated.stats ?? current.stats;
        const statusEffects = updated.statusEffects ?? current.statusEffects;
        const abilityCooldowns = updated.abilityCooldowns ?? current.abilityCooldowns;
        const team = updated.team ?? current.team;
        this.players.set(updated.playerId, {
          playerId: updated.playerId,
          ...(team === undefined ? {} : { team }),
          x: updated.x ?? current.x,
          y: updated.y ?? current.y,
          health: updated.health ?? current.health,
          ...(shield === undefined ? {} : { shield }),
          ...(armor === undefined ? {} : { armor }),
          ...(weapon === undefined ? {} : { weapon }),
          ...(inventory === undefined ? {} : { inventory }),
          ...(pickupPrompt === undefined ? {} : { pickupPrompt }),
          ...(pickupToast === undefined ? {} : { pickupToast }),
          ...(damageIndicator === undefined ? {} : { damageIndicator }),
          ...(stats === undefined ? {} : { stats }),
          ...(statusEffects === undefined ? {} : { statusEffects }),
          ...(abilityCooldowns === undefined ? {} : { abilityCooldowns }),
        });
      }
      for (const removed of message.objectsRemoved ?? []) {
        this.objects.delete(removed);
      }
      for (const object of message.objectsUpdated ?? []) {
        this.objects.set(object.objectId, {
          objectId: object.objectId,
          x: object.x,
          y: object.y,
          ...(object.pickup === undefined ? {} : { pickup: object.pickup }),
          ...(object.lootSource === undefined ? {} : { lootSource: object.lootSource }),
          ...(object.hazard === undefined ? {} : { hazard: object.hazard }),
        });
      }
      this.maxPlayersSeen = Math.max(this.maxPlayersSeen, this.players.size);
      this.recordLocalPickupToast();
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
      this.emitState();
      return;
    }
    if (message.kind === 'left') {
      this.players.delete(message.id);
      this.emitState();
      return;
    }
    if (message.kind === 'killed') {
      this.pushGameplayEvent(new GameplayEntityDefeated({
        targetId: makeGameplayEntityId(message.victim),
        sourceId: makeGameplayEntityId(message.killer),
        tick: message.tick,
      }));
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
      this.pushGameplayEvent(new GameplayMatchPhaseChanged({
        tick: this.gameOver.tickCount,
        phase: 'finished',
        winnerId: makeGameplayEntityId(message.winner),
      }));
      this.emitState();
    }
  }

  private sendSnapshotAck(socket: WebSocket, tick: number): void {
    if (socket.readyState !== WebSocket.OPEN || tick <= this.lastSnapshotAckTick) {
      return;
    }
    const ackBytes = this.plugin.encodeSnapshotAckFrame(tick, Date.now());
    socket.send(toArrayBuffer(ackBytes));
    this.lastSnapshotAckTick = tick;
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
        if (frameView.kind === 'initial' || frameView.kind === 'delta') {
          this.sendSnapshotAck(socket, frameView.tick);
        }
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
   * direction + action flags + optional aim/weapon hints; we encode them through
   * the plugin bridge (`encodeClientInputFrame`) which is the single point
   * that knows the on-the-wire shape. ADR-0014 Phase 1 boundary invariant:
   * this is the only place outgoing inputs are constructed.
   */
  sendInput(
    dir: InputDirection | undefined,
    shoot = false,
    options?: {
      readonly reload?: boolean;
      readonly interact?: boolean;
      readonly drop?: boolean;
      readonly abilities?: readonly BattleRoyaleAbilityId[];
      readonly aimDeg?: number;
      readonly swapSlot?: number;
    },
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
      reload: options?.reload ?? false,
      interact: options?.interact ?? false,
      drop: options?.drop ?? false,
      abilities: options?.abilities ?? [],
      ...(options?.aimDeg !== undefined ? { aimDeg: options.aimDeg } : {}),
      ...(options?.swapSlot !== undefined ? { swapSlot: options.swapSlot } : {}),
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
    this.objects.clear();
    this.localPlayerId = null;
    this.seq = 0;
    this.tick = 0;
    this.lastSnapshotAckTick = -1;
    this.phase = 'idle';
    this.errorMessage = null;
    this.zone = defaultZone(this.mapWidth, this.mapHeight);
    this.zoneStatus = { phase: 'stable' };
    this.gameplayEvents.length = 0;
    this.seenPickupToastKeys.clear();
    this.gameOver = undefined;
    this.maxPlayersSeen = 0;
  }
}
