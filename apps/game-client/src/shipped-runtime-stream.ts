import {
  decodeServerFrame,
  encodeSnapshotAckFrame,
  serverFrameToView,
  type FramePlayerUpdateView,
  type InitialFramePlayerView,
  type ServerFrameView,
  type ZoneView,
} from '@tileborne/plugin-battle-royale';
import {
  eventKey,
  type HudEvent,
  type HudMetrics,
  type MatchResults,
} from '@tileborne/game-client';
import type { SequencedGameplayEvent } from '@tileborne/ipc-contracts';
import type {
  RuntimeShellBehaviorEventPayload,
  RuntimeShellNavigationRequest,
} from '@tileborne/runtime';

type ShippedRuntimePhase = 'idle' | 'running' | 'finished';
const ROOM_SHELL_FRAME_VERSION = 1;
export const SHIPPED_GAMEPLAY_EVENT_WINDOW = 20;
export const SHIPPED_SEQUENCED_GAMEPLAY_EVENT_WINDOW = 80;

interface RuntimePlayerState {
  readonly playerId: string;
  readonly health: number;
  readonly weapon?: InitialFramePlayerView['weapon'];
  readonly inventory?: { readonly itemIds: readonly string[]; readonly capacity: number };
  readonly pickupToast?: {
    readonly itemKind: string;
    readonly quantity: number;
    readonly tick: number;
  };
  readonly damageIndicator?: {
    readonly sourceId: string;
    readonly amount: number;
    readonly tick: number;
  };
  readonly stats?: { readonly kills: number; readonly deaths: number };
}

const gameplayEntityId = (id: string): Extract<HudEvent, { _tag: 'DamageApplied' }>['targetId'] =>
  id as Extract<HudEvent, { _tag: 'DamageApplied' }>['targetId'];

const gameplayItemId = (id: string): Extract<HudEvent, { _tag: 'ItemGranted' }>['itemId'] =>
  id as Extract<HudEvent, { _tag: 'ItemGranted' }>['itemId'];

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const encodeShippedShellEventFrame = (payload: RuntimeShellBehaviorEventPayload): string =>
  JSON.stringify({ _tag: 'TileborneShellEvent', version: ROOM_SHELL_FRAME_VERSION, payload });

export const decodeShippedShellNavigationFrame = (
  data: unknown,
):
  | {
      readonly epoch: string;
      readonly sequence: number;
      readonly request: RuntimeShellNavigationRequest;
    }
  | undefined => {
  if (typeof data !== 'string') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data) as unknown;
  } catch {
    return undefined;
  }
  if (
    !isRecord(parsed) ||
    parsed._tag !== 'TileborneShellNavigation' ||
    parsed.version !== ROOM_SHELL_FRAME_VERSION ||
    typeof parsed.epoch !== 'string' ||
    parsed.epoch.length === 0 ||
    !Number.isSafeInteger(parsed.sequence) ||
    !isRecord(parsed.request) ||
    parsed.request.type !== 'navigate' ||
    typeof parsed.request.targetScreenId !== 'string'
  ) {
    return undefined;
  }
  const sequence = parsed.sequence as number;
  return {
    epoch: parsed.epoch,
    sequence,
    request: { type: 'navigate', targetScreenId: parsed.request.targetScreenId },
  };
};

export interface ShippedRuntimeState {
  readonly phase: ShippedRuntimePhase;
  readonly localPlayerId?: string;
  readonly tickCount: number;
  readonly totalPlayers: number;
  readonly players: ReadonlyMap<string, RuntimePlayerState>;
  readonly zone?: ZoneView;
  readonly events: readonly HudEvent[];
  readonly sequencedEvents: readonly SequencedGameplayEvent[];
  readonly nextSyntheticGameplayEventSequence: number;
  readonly gameOver?:
    | {
        readonly winnerId: string;
        readonly tick: number;
      }
    | undefined;
}

export const initialShippedRuntimeState = (
  localPlayerId?: string | undefined,
): ShippedRuntimeState => ({
  phase: 'idle',
  ...(localPlayerId === undefined ? {} : { localPlayerId }),
  tickCount: 0,
  totalPlayers: 0,
  players: new Map(),
  events: [],
  sequencedEvents: [],
  nextSyntheticGameplayEventSequence: -1,
});

const playerFromInitial = (player: InitialFramePlayerView): RuntimePlayerState => ({
  playerId: player.playerId,
  health: player.health,
  ...(player.weapon === undefined ? {} : { weapon: player.weapon }),
  ...(player.inventory === undefined ? {} : { inventory: player.inventory }),
  ...(player.pickupToast === undefined ? {} : { pickupToast: player.pickupToast }),
  ...(player.damageIndicator === undefined ? {} : { damageIndicator: player.damageIndicator }),
  ...(player.stats === undefined ? {} : { stats: player.stats }),
});

const updatePlayer = (
  previous: RuntimePlayerState | undefined,
  update: FramePlayerUpdateView,
): RuntimePlayerState => {
  const health = update.health ?? previous?.health ?? 0;
  const weapon = update.weapon ?? previous?.weapon;
  const inventory = update.inventory ?? previous?.inventory;
  const pickupToast = update.pickupToast ?? previous?.pickupToast;
  const damageIndicator = update.damageIndicator ?? previous?.damageIndicator;
  const stats = update.stats ?? previous?.stats;
  return {
    playerId: update.playerId,
    health,
    ...(weapon === undefined ? {} : { weapon }),
    ...(inventory === undefined ? {} : { inventory }),
    ...(pickupToast === undefined ? {} : { pickupToast }),
    ...(damageIndicator === undefined ? {} : { damageIndicator }),
    ...(stats === undefined ? {} : { stats }),
  };
};

const samePickupToast = (
  left: RuntimePlayerState['pickupToast'] | undefined,
  right: RuntimePlayerState['pickupToast'] | undefined,
): boolean =>
  left?.itemKind === right?.itemKind &&
  left?.quantity === right?.quantity &&
  left?.tick === right?.tick;

const trimGameplayEventWindow = (events: readonly HudEvent[]): readonly HudEvent[] =>
  events.length <= SHIPPED_GAMEPLAY_EVENT_WINDOW
    ? events
    : events.slice(events.length - SHIPPED_GAMEPLAY_EVENT_WINDOW);

const trimSequencedGameplayEventWindow = (
  events: readonly SequencedGameplayEvent[],
): readonly SequencedGameplayEvent[] =>
  events.length <= SHIPPED_SEQUENCED_GAMEPLAY_EVENT_WINDOW
    ? events
    : events.slice(events.length - SHIPPED_SEQUENCED_GAMEPLAY_EVENT_WINDOW);

const appendUniqueEvent = (events: readonly HudEvent[], event: HudEvent): readonly HudEvent[] =>
  events.some((previous) => eventKey(previous) === eventKey(event))
    ? events
    : trimGameplayEventWindow([...events, event]);

const appendSequencedEvent = (
  events: readonly SequencedGameplayEvent[],
  event: SequencedGameplayEvent,
): readonly SequencedGameplayEvent[] => {
  if (events.some((previous) => previous.sequence === event.sequence)) {
    return events;
  }
  return trimSequencedGameplayEventWindow([...events, event]);
};

const appendSyntheticSequencedEvents = ({
  previousEvents,
  nextEvents,
  sequencedEvents,
  nextSequence,
}: {
  readonly previousEvents: readonly HudEvent[];
  readonly nextEvents: readonly HudEvent[];
  readonly sequencedEvents: readonly SequencedGameplayEvent[];
  readonly nextSequence: number;
}): {
  readonly sequencedEvents: readonly SequencedGameplayEvent[];
  readonly nextSyntheticGameplayEventSequence: number;
} => {
  const previousKeys = new Set(previousEvents.map((event) => eventKey(event)));
  let updatedSequencedEvents = sequencedEvents;
  let sequence = nextSequence;
  for (const event of nextEvents) {
    if (previousKeys.has(eventKey(event))) {
      continue;
    }
    updatedSequencedEvents = appendSequencedEvent(updatedSequencedEvents, { sequence, event });
    sequence -= 1;
  }
  return {
    sequencedEvents: updatedSequencedEvents,
    nextSyntheticGameplayEventSequence: sequence,
  };
};

const appendPlayerDeltaEvents = ({
  events,
  previous,
  next,
  tick,
}: {
  readonly events: readonly HudEvent[];
  readonly previous: RuntimePlayerState | undefined;
  readonly next: RuntimePlayerState;
  readonly tick: number;
}): readonly HudEvent[] => {
  let updated = events;
  if (previous && next.health < previous.health) {
    const sourceId =
      next.damageIndicator?.tick === tick ? next.damageIndicator.sourceId : undefined;
    updated = appendUniqueEvent(updated, {
      _tag: 'DamageApplied',
      tick,
      targetId: gameplayEntityId(next.playerId),
      ...(sourceId === undefined ? {} : { sourceId: gameplayEntityId(sourceId) }),
      amount: previous.health - next.health,
      healthBefore: previous.health,
      healthAfter: next.health,
    });
  }

  if (next.pickupToast !== undefined && !samePickupToast(previous?.pickupToast, next.pickupToast)) {
    updated = appendUniqueEvent(updated, {
      _tag: 'ItemGranted',
      tick: next.pickupToast.tick,
      targetId: gameplayEntityId(next.playerId),
      itemId: gameplayItemId(next.pickupToast.itemKind),
      quantity: next.pickupToast.quantity,
    });
  }

  return updated;
};

const appendZoneEvents = (
  events: readonly HudEvent[],
  previousZone: ZoneView | undefined,
  nextZone: ZoneView | undefined,
  tick: number,
): readonly HudEvent[] => {
  if (
    previousZone === undefined ||
    nextZone === undefined ||
    nextZone.radius >= previousZone.radius
  ) {
    return events;
  }
  return appendUniqueEvent(events, {
    _tag: 'ZonePhaseChanged',
    tick,
    phase: 'shrinking',
    previousPhase: 'stable',
    secondsRemaining: 0,
  });
};

export const applyShippedRuntimeServerFrame = (
  state: ShippedRuntimeState,
  frame: ServerFrameView,
): ShippedRuntimeState => {
  if (frame.kind === 'initial') {
    const players = new Map(
      frame.players.map((player) => [player.playerId, playerFromInitial(player)]),
    );
    const events = appendUniqueEvent(state.events, {
      _tag: 'MatchPhaseChanged',
      tick: frame.tick,
      phase: 'running',
      previousPhase: 'lobby',
    });
    const synthetic = appendSyntheticSequencedEvents({
      previousEvents: state.events,
      nextEvents: events,
      sequencedEvents: state.sequencedEvents,
      nextSequence: state.nextSyntheticGameplayEventSequence,
    });
    return {
      ...state,
      phase: 'running',
      tickCount: frame.tick,
      totalPlayers: Math.max(state.totalPlayers, frame.players.length),
      players,
      ...(frame.zone === undefined ? {} : { zone: frame.zone }),
      events,
      sequencedEvents: synthetic.sequencedEvents,
      nextSyntheticGameplayEventSequence: synthetic.nextSyntheticGameplayEventSequence,
    };
  }

  if (frame.kind === 'delta') {
    if (frame.tick < state.tickCount) {
      return state;
    }
    const players = new Map(state.players);
    for (const playerId of frame.removed) {
      players.delete(playerId);
    }
    let events = state.events;
    for (const update of frame.updated) {
      const previous = players.get(update.playerId);
      const next = updatePlayer(previous, update);
      players.set(update.playerId, next);
      events = appendPlayerDeltaEvents({ events, previous, next, tick: frame.tick });
    }
    const nextZone = frame.zone ?? state.zone;
    events = appendZoneEvents(events, state.zone, nextZone, frame.tick);
    const synthetic = appendSyntheticSequencedEvents({
      previousEvents: state.events,
      nextEvents: events,
      sequencedEvents: state.sequencedEvents,
      nextSequence: state.nextSyntheticGameplayEventSequence,
    });
    return {
      ...state,
      phase: 'running',
      tickCount: Math.max(state.tickCount, frame.tick),
      totalPlayers: Math.max(state.totalPlayers, players.size),
      players,
      ...(nextZone === undefined ? {} : { zone: nextZone }),
      events,
      sequencedEvents: synthetic.sequencedEvents,
      nextSyntheticGameplayEventSequence: synthetic.nextSyntheticGameplayEventSequence,
    };
  }

  if (frame.kind === 'gameplay-event') {
    if (frame.event.tick < state.tickCount) {
      return state;
    }
    const sequencedEvent = { sequence: frame.sequence, event: frame.event };
    return {
      ...state,
      tickCount: Math.max(state.tickCount, frame.event.tick),
      events: appendUniqueEvent(state.events, frame.event),
      sequencedEvents: appendSequencedEvent(state.sequencedEvents, sequencedEvent),
    };
  }

  if (frame.kind === 'killed') {
    const target = state.players.get(frame.victim);
    const events = appendUniqueEvent(state.events, {
      _tag: 'EntityDefeated',
      tick: frame.tick,
      targetId: gameplayEntityId(frame.victim),
      sourceId: gameplayEntityId(frame.killer),
      amount: target?.health ?? 0,
      healthBefore: target?.health ?? 0,
    });
    const synthetic = appendSyntheticSequencedEvents({
      previousEvents: state.events,
      nextEvents: events,
      sequencedEvents: state.sequencedEvents,
      nextSequence: state.nextSyntheticGameplayEventSequence,
    });
    return {
      ...state,
      tickCount: Math.max(state.tickCount, frame.tick),
      events,
      sequencedEvents: synthetic.sequencedEvents,
      nextSyntheticGameplayEventSequence: synthetic.nextSyntheticGameplayEventSequence,
    };
  }

  if (frame.kind === 'game-over') {
    if (state.gameOver !== undefined) {
      return state;
    }
    const tick = Math.max(1, state.tickCount + 1);
    const events = appendUniqueEvent(state.events, {
      _tag: 'MatchPhaseChanged',
      tick,
      phase: 'game-over',
      previousPhase: 'running',
      winnerId: gameplayEntityId(frame.winner),
    });
    const synthetic = appendSyntheticSequencedEvents({
      previousEvents: state.events,
      nextEvents: events,
      sequencedEvents: state.sequencedEvents,
      nextSequence: state.nextSyntheticGameplayEventSequence,
    });
    return {
      ...state,
      phase: 'finished',
      tickCount: tick,
      gameOver: { winnerId: frame.winner, tick },
      events,
      sequencedEvents: synthetic.sequencedEvents,
      nextSyntheticGameplayEventSequence: synthetic.nextSyntheticGameplayEventSequence,
    };
  }

  return state;
};

export const decodeShippedRuntimeServerFrame = (data: unknown): ServerFrameView | undefined => {
  if (data instanceof ArrayBuffer) {
    return serverFrameToView(decodeServerFrame(new Uint8Array(data)));
  }
  if (ArrayBuffer.isView(data)) {
    return serverFrameToView(
      decodeServerFrame(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)),
    );
  }
  return undefined;
};

export const buildSnapshotAckFrame = (tick: number): Uint8Array =>
  encodeSnapshotAckFrame(tick, performance.now());

const displayNameForPlayer = (playerId: string, localPlayerId?: string): string =>
  playerId === localPlayerId ? 'You' : playerId;

export const shippedRuntimeHudMetrics = (state: ShippedRuntimeState): HudMetrics | undefined => {
  if (state.phase === 'idle') return undefined;
  const localPlayerId = state.localPlayerId ?? [...state.players.keys()][0];
  const players = [...state.players.values()];
  const localPlayer = localPlayerId === undefined ? undefined : state.players.get(localPlayerId);
  const alivePlayers = players.filter((player) => player.health > 0);
  return {
    playerCount: players.length,
    tickCount: state.tickCount,
    hud: {
      totalPlayers: Math.max(state.totalPlayers, players.length),
      ...(localPlayer === undefined
        ? {}
        : {
            localPlayer: {
              playerId: localPlayer.playerId,
              displayName: displayNameForPlayer(localPlayer.playerId, state.localPlayerId),
              health: localPlayer.health,
              maxHealth: 100,
              inventory: localPlayer.inventory ?? { itemIds: [], capacity: 0 },
              stats: localPlayer.stats ?? { kills: 0, deaths: 0 },
            },
          }),
      ...(state.zone === undefined
        ? {}
        : {
            zoneStatus: {
              phase: state.events.some(
                (event) => event._tag === 'ZonePhaseChanged' && event.phase === 'shrinking',
              )
                ? 'shrinking'
                : 'stable',
            } as const,
          }),
      scoreboard: players.map((player) => ({
        playerId: player.playerId,
        displayName: displayNameForPlayer(player.playerId, state.localPlayerId),
        health: player.health,
        alive: player.health > 0,
        kills: player.stats?.kills ?? 0,
        deaths: player.stats?.deaths ?? (player.health > 0 ? 0 : 1),
      })),
      gameplayEvents: state.events,
      ...(state.gameOver === undefined
        ? {}
        : {
            gameOver: {
              winnerId: state.gameOver.winnerId,
              winnerDisplayName: displayNameForPlayer(state.gameOver.winnerId, state.localPlayerId),
              alivePlayers: alivePlayers.length,
              totalPlayers: Math.max(state.totalPlayers, players.length),
              tickCount: state.gameOver.tick,
            },
          }),
    },
  };
};

export const shippedRuntimeResults = (state: ShippedRuntimeState): MatchResults | undefined => {
  if (state.gameOver === undefined) return undefined;
  const rows = [...state.players.values()]
    .map((player) => ({
      rank: player.playerId === state.gameOver?.winnerId ? 1 : 2,
      name: displayNameForPlayer(player.playerId, state.localPlayerId),
      score:
        player.playerId === state.gameOver?.winnerId
          ? 100 + (player.stats?.kills ?? 0)
          : (player.stats?.kills ?? 0),
    }))
    .sort((left, right) => left.rank - right.rank || right.score - left.score);
  return {
    title: state.gameOver.winnerId === state.localPlayerId ? 'Victory' : 'Match complete',
    rows,
  };
};
