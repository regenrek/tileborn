import { BattleRoyaleProtocol } from "@tileborne/ipc-contracts";

import type { PlaytestPluginWorld } from "./playtest-plugin-world.js";

const { decodeMessage } = BattleRoyaleProtocol;

const DEFAULT_ZONE_SCHEDULE = {
  waitSec: 60,
  shrinkSec: 30,
  holdSec: 30,
  shrinkPhases: 3,
  tickRate: 20,
} as const;

const DEFAULT_PLAYER_HEALTH = 100;
const PRIMARY_PLAYER_ID = "player-1";
const MAX_RECENT_EVENTS = 20;

interface ZoneComponent {
  readonly cx: number;
  readonly cy: number;
  readonly currentRadius: number;
  readonly targetRadius: number;
  readonly shrinkStartTick: number;
  readonly shrinkDurationTicks: number;
  readonly shrinkFromRadius: number;
  readonly damagePerSecOutside: number;
  readonly schedulePhaseIndex: number;
  readonly phaseStartTick: number;
}

interface PlayerComponent {
  readonly playerId: string;
  readonly health: number;
  readonly alive: 0 | 1;
}

export interface PlaytestRuntimeHudState {
  readonly totalPlayers: number;
  readonly localPlayer?: {
    readonly playerId: string;
    readonly displayName: string;
    readonly health: number;
    readonly maxHealth: number;
  };
  readonly zoneStatus?: {
    readonly phase: "stable" | "countdown" | "shrinking";
    readonly secondsRemaining?: number;
  };
  readonly recentEvents: readonly PlaytestRuntimeHudEventState[];
  readonly gameOver?: {
    readonly winnerId: string;
    readonly winnerDisplayName: string;
    readonly alivePlayers: number;
    readonly totalPlayers: number;
    readonly tickCount: number;
  };
}

type ZoneStatusState = NonNullable<PlaytestRuntimeHudState["zoneStatus"]>;

export type PlaytestRuntimeHudEventState =
  | {
      readonly _tag: "PlayerKilled";
      readonly victimId: string;
      readonly victimDisplayName: string;
      readonly killerId: string;
      readonly tick: number;
      readonly emittedAtMs: number;
    }
  | {
      readonly _tag: "GameOver";
      readonly winnerId: string;
      readonly winnerDisplayName: string;
      readonly alivePlayers: number;
      readonly totalPlayers: number;
      readonly tickCount: number;
      readonly emittedAtMs: number;
    };

export interface PlaytestRuntimeHudTracker {
  readonly ingestFrames: (frames: readonly Uint8Array[]) => void;
  readonly snapshot: (world: PlaytestPluginWorld, tickCount: number) => PlaytestRuntimeHudState;
}

const formatPlayerDisplayName = (playerId: string): string => {
  const match = /^player-(\d+)$/.exec(playerId);
  if (match) {
    return `Player ${match[1]}`;
  }
  return playerId;
};

const computeZoneStatus = (zone: ZoneComponent, tick: number): ZoneStatusState => {
  if (zone.schedulePhaseIndex === 0) {
    const phaseDuration = DEFAULT_ZONE_SCHEDULE.waitSec * DEFAULT_ZONE_SCHEDULE.tickRate;
    const elapsed = Math.max(0, tick - zone.phaseStartTick);
    const remainingTicks = Math.max(0, phaseDuration - elapsed);
    return {
      phase: "countdown",
      secondsRemaining: Math.ceil(remainingTicks / DEFAULT_ZONE_SCHEDULE.tickRate),
    };
  }

  if (zone.shrinkStartTick >= 0) {
    const elapsed = tick - zone.shrinkStartTick;
    if (elapsed >= 0 && elapsed < zone.shrinkDurationTicks) {
      return { phase: "shrinking" };
    }
  }

  return { phase: "stable" };
};

const readZone = (world: PlaytestPluginWorld): ZoneComponent | undefined => {
  try {
    const zones = world.getComponent<ZoneComponent>("Zone");
    for (const [, zone] of zones.entries()) {
      return zone;
    }
  } catch {
    return undefined;
  }
  return undefined;
};

const readPlayers = (
  world: PlaytestPluginWorld,
): { readonly totalPlayers: number; readonly localPlayer?: PlaytestRuntimeHudState["localPlayer"] } => {
  try {
    const players = world.getComponent<PlayerComponent>("Player");
    let totalPlayers = 0;
    let localPlayer: PlaytestRuntimeHudState["localPlayer"];

    for (const [, player] of players.entries()) {
      totalPlayers += 1;
      if (player.playerId === PRIMARY_PLAYER_ID) {
        localPlayer = {
          playerId: player.playerId,
          displayName: formatPlayerDisplayName(player.playerId),
          health: player.health,
          maxHealth: DEFAULT_PLAYER_HEALTH,
        };
      }
    }

    return localPlayer === undefined
      ? { totalPlayers }
      : { totalPlayers, localPlayer };
  } catch {
    return { totalPlayers: 0 };
  }
};

export const createPlaytestRuntimeHudTracker = (): PlaytestRuntimeHudTracker => {
  const recentEvents: PlaytestRuntimeHudEventState[] = [];
  let gameOver: PlaytestRuntimeHudState["gameOver"];

  const pushEvent = (event: PlaytestRuntimeHudEventState): void => {
    recentEvents.push(event);
    if (recentEvents.length > MAX_RECENT_EVENTS) {
      recentEvents.shift();
    }
  };

  return {
    ingestFrames(frames) {
      for (const frame of frames) {
        try {
          const message = decodeMessage(frame);
          if (message._tag === "PlayerKilled") {
            pushEvent({
              _tag: "PlayerKilled",
              victimId: message.victim,
              victimDisplayName: formatPlayerDisplayName(message.victim),
              killerId: message.killer,
              tick: message.tick,
              emittedAtMs: Date.now(),
            });
          } else if (message._tag === "GameOver") {
            const winnerDisplayName = formatPlayerDisplayName(message.winner);
            gameOver = {
              winnerId: message.winner,
              winnerDisplayName,
              alivePlayers: 1,
              totalPlayers: 0,
              tickCount: 0,
            };
            pushEvent({
              _tag: "GameOver",
              winnerId: message.winner,
              winnerDisplayName,
              alivePlayers: gameOver.alivePlayers,
              totalPlayers: gameOver.totalPlayers,
              tickCount: gameOver.tickCount,
              emittedAtMs: Date.now(),
            });
          }
        } catch {
          // Ignore malformed plugin frames.
        }
      }
    },
    snapshot(world, tickCount) {
      const { totalPlayers, localPlayer } = readPlayers(world);
      const zone = readZone(world);

      if (gameOver) {
        gameOver = {
          ...gameOver,
          totalPlayers,
          tickCount,
        };
      }

      const currentGameOver = gameOver;
      const events =
        currentGameOver === undefined
          ? [...recentEvents]
          : recentEvents.map((event) =>
              event._tag === "GameOver"
                ? {
                    ...event,
                    alivePlayers: currentGameOver.alivePlayers,
                    totalPlayers: currentGameOver.totalPlayers,
                    tickCount: currentGameOver.tickCount,
                  }
                : event,
            );

      const snapshot: PlaytestRuntimeHudState = {
        totalPlayers,
        recentEvents: events,
        ...(localPlayer !== undefined ? { localPlayer } : {}),
        ...(zone ? { zoneStatus: computeZoneStatus(zone, tickCount) } : {}),
        ...(gameOver !== undefined ? { gameOver } : {}),
      };
      return snapshot;
    },
  };
};
