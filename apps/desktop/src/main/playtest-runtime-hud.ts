import { BattleRoyaleProtocol } from "@tileborne/ipc-contracts";

import type { PlaytestPluginWorld } from "./playtest-plugin-world.js";

/**
 * Host-side playtest HUD tracker (engine chassis, plugin-agnostic).
 *
 * Ownership split (HUD-state SSOT): the WORLD→HUD derivation — which ECS
 * components exist and how they project into player status, scoreboard,
 * minimap, and zone phase — is plugin code. The active mode's runtime bundle
 * exports `derivePlaytestHudWorldState`, and the host calls it through the
 * {@link PlaytestHudWorldStateDeriver} seam. This module owns only host
 * concerns: accumulating wire events (kill feed, pickup toasts, game-over)
 * across ticks and composing them with the plugin-derived world slice. No
 * Battle Royale component name or zone-schedule constant lives here.
 */

const { decodeMessage } = BattleRoyaleProtocol;

const MAX_RECENT_EVENTS = 20;

/** The per-tick HUD slice derived from the plugin world — plugin-owned. */
export interface PlaytestRuntimeHudWorldState {
  readonly totalPlayers: number;
  readonly localPlayer?: {
    readonly playerId: string;
    readonly displayName: string;
    readonly team?: string;
    readonly health: number;
    readonly maxHealth: number;
    readonly position?: { readonly x: number; readonly y: number };
    readonly shield?: number;
    readonly armor?: { readonly mitigation: number; readonly durability: number };
    readonly weapon?: {
      readonly weaponId: string;
      readonly slot: number;
      readonly ammoInMagazine?: number;
      readonly magazineSize?: number;
      readonly reserveAmmo?: number;
      readonly cooldownRemainingTicks?: number;
      readonly reloadRemainingTicks?: number;
      readonly reloadTotalTicks?: number;
    };
    readonly inventory?: { readonly itemIds: readonly string[]; readonly capacity: number };
    readonly pickupPrompt?: {
      readonly itemKind?: string;
      readonly tier?: string;
      readonly distance?: number;
      readonly action: "pickup-loot";
      readonly available: boolean;
    };
    readonly pickupToast?: {
      readonly itemKind: string;
      readonly tier: string;
      readonly quantity: number;
      readonly tick: number;
    };
    readonly damageIndicator?: {
      readonly sourceId: string;
      readonly angleDeg: number;
      readonly amount: number;
      readonly tick: number;
    };
    readonly stats?: { readonly kills: number; readonly deaths: number };
    readonly statusEffects?: readonly {
      readonly effectId: string;
      readonly remainingTicks: number;
      readonly stacks: number;
    }[];
    readonly abilityCooldowns?: readonly {
      readonly abilityId: string;
      readonly remainingTicks: number;
    }[];
  };
  readonly zoneStatus?: {
    readonly phase: "stable" | "countdown" | "shrinking";
    readonly secondsRemaining?: number;
  };
  readonly scoreboard?: readonly {
    readonly playerId: string;
    readonly displayName: string;
    readonly team?: string;
    readonly health: number;
    readonly alive: boolean;
    readonly kills: number;
    readonly deaths: number;
  }[];
  readonly minimap?: {
    readonly zone?: { readonly cx: number; readonly cy: number; readonly radius: number };
    readonly players: readonly {
      readonly playerId: string;
      readonly x: number;
      readonly y: number;
      readonly local: boolean;
      readonly alive: boolean;
      readonly health: number;
    }[];
    readonly objects: readonly {
      readonly objectId: string;
      readonly x: number;
      readonly y: number;
      readonly kind: "pickup" | "loot" | "hazard" | "objective";
      readonly tier?: string;
      readonly available?: boolean;
    }[];
  };
}

/** The complete HUD state the runtime metrics expose to the renderer. */
export interface PlaytestRuntimeHudState extends PlaytestRuntimeHudWorldState {
  readonly recentEvents: readonly PlaytestRuntimeHudEventState[];
  readonly gameOver?: {
    readonly winnerId: string;
    readonly winnerDisplayName: string;
    readonly alivePlayers: number;
    readonly totalPlayers: number;
    readonly tickCount: number;
  };
}

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
      readonly _tag: "PickupCollected";
      readonly playerId: string;
      readonly playerDisplayName: string;
      readonly itemKind: string;
      readonly tier: string;
      readonly quantity: number;
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

/**
 * The plugin runtime bundle's world→HUD derivation export. Structurally
 * matches `derivePlaytestHudWorldState` in the Battle Royale runtime bundle;
 * other game-mode plugins export their own.
 */
export type PlaytestHudWorldStateDeriver = (
  world: PlaytestPluginWorld,
  tickCount: number,
) => PlaytestRuntimeHudWorldState | undefined;

export interface PlaytestRuntimeHudTracker {
  readonly ingestFrames: (frames: readonly Uint8Array[]) => void;
  readonly snapshot: (world: PlaytestPluginWorld, tickCount: number) => PlaytestRuntimeHudState;
}

const EMPTY_WORLD_STATE: PlaytestRuntimeHudWorldState = {
  totalPlayers: 0,
  scoreboard: [],
  minimap: { players: [], objects: [] },
};

const formatPlayerDisplayName = (playerId: string): string => {
  const match = /^player-(\d+)$/.exec(playerId);
  if (match) {
    return `Player ${match[1]}`;
  }
  return playerId;
};

export const createPlaytestRuntimeHudTracker = (
  deriveWorldState?: PlaytestHudWorldStateDeriver,
): PlaytestRuntimeHudTracker => {
  const recentEvents: PlaytestRuntimeHudEventState[] = [];
  const seenPickupToastKeys = new Set<string>();
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
      const worldState = deriveWorldState?.(world, tickCount) ?? EMPTY_WORLD_STATE;
      const localPlayer = worldState.localPlayer;

      const pickupToast = localPlayer?.pickupToast;
      if (localPlayer !== undefined && pickupToast !== undefined) {
        const key = `${localPlayer.playerId}:${pickupToast.itemKind}:${pickupToast.tier}:${pickupToast.quantity}:${pickupToast.tick}`;
        if (!seenPickupToastKeys.has(key)) {
          seenPickupToastKeys.add(key);
          pushEvent({
            _tag: "PickupCollected",
            playerId: localPlayer.playerId,
            playerDisplayName: localPlayer.displayName,
            itemKind: pickupToast.itemKind,
            tier: pickupToast.tier,
            quantity: pickupToast.quantity,
            tick: pickupToast.tick,
            emittedAtMs: Date.now(),
          });
        }
      }

      if (gameOver) {
        gameOver = {
          ...gameOver,
          totalPlayers: worldState.totalPlayers,
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

      return {
        ...worldState,
        recentEvents: events,
        ...(gameOver !== undefined ? { gameOver } : {}),
      };
    },
  };
};
