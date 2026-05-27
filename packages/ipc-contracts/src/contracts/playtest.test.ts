import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { makeMapId, makeProjectId } from "@tileborne/core";

import {
  PlaytestListResponse,
  PlaytestRuntimeMetrics,
  PlaytestSessionView,
  PlaytestStartResponse,
} from "./playtest.js";

const UUID = "550e8400-e29b-41d4-a716-446655440000";
const projectId = makeProjectId(UUID);
const mapId = makeMapId(UUID);
const sessionId = "playtest:550e8400-e29b-41d4-a716-446655440000" as const;

const roundTrip = <A, I>(schema: Schema.Top, value: I) => {
  const codec = schema as Schema.Codec<A, I, never, never>;
  const decoded = Schema.decodeUnknownSync(codec)(value);
  expect(Schema.encodeSync(codec)(decoded)).toEqual(value);
};

describe("playtest IPC contracts", () => {
  it("round-trips PlaytestRuntimeMetrics", () => {
    roundTrip(PlaytestRuntimeMetrics, {
      tickCount: 12,
      playerCount: 3,
      lastPluginEvent: "onTick:12",
      lastTickAtMs: 1_714_000_000_000,
      hud: {
        totalPlayers: 4,
        localPlayer: {
          playerId: "player-1",
          displayName: "Player 1",
          health: 75,
          maxHealth: 100,
        },
        zoneStatus: {
          phase: "countdown",
          secondsRemaining: 42,
        },
        recentEvents: [
          {
            _tag: "PlayerKilled",
            victimId: "player-2",
            victimDisplayName: "Player 2",
            killerId: "zone",
            tick: 120,
            emittedAtMs: 1_714_000_000_100,
          },
        ],
        gameOver: {
          winnerId: "player-1",
          winnerDisplayName: "Player 1",
          alivePlayers: 1,
          totalPlayers: 4,
          tickCount: 500,
        },
      },
    });
  });

  it("round-trips PlaytestSessionView with optional runtimeMetrics", () => {
    roundTrip(PlaytestSessionView, {
      id: sessionId,
      projectId,
      mapId,
      status: "Running",
      activePlugins: ["@tileborne-plugins/battle-royale"],
      runtimeMetrics: {
        tickCount: 1,
        playerCount: 0,
        lastPluginEvent: "onInit",
        lastTickAtMs: 1_714_000_000_001,
      },
    });
  });

  it("round-trips playtest list and start responses", () => {
    const session = {
      id: sessionId,
      projectId,
      mapId,
      status: "Running" as const,
    };
    roundTrip(PlaytestStartResponse, { session });
    roundTrip(PlaytestListResponse, { sessions: [session] });
  });
});
