import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeMapId, makeProjectId } from '@tileborne/core';

import {
  PlaytestBehaviorDebugControlRequest,
  PlaytestBehaviorDebugInspectResponse,
  PlaytestListResponse,
  PlaytestRuntimeMetrics,
  PlaytestSessionView,
  PlaytestStartResponse,
} from './playtest.js';

const UUID = '550e8400-e29b-41d4-a716-446655440000';
const projectId = makeProjectId(UUID);
const mapId = makeMapId(UUID);
const sessionId = 'playtest:550e8400-e29b-41d4-a716-446655440000' as const;

const roundTrip = <A, I>(schema: Schema.Top, value: I) => {
  const codec = schema as Schema.Codec<A, I, never, never>;
  const decoded = Schema.decodeUnknownSync(codec)(value);
  expect(Schema.encodeSync(codec)(decoded)).toEqual(value);
};

describe('playtest IPC contracts', () => {
  it('round-trips PlaytestRuntimeMetrics', () => {
    roundTrip(PlaytestRuntimeMetrics, {
      tickCount: 12,
      playerCount: 3,
      lastPluginEvent: 'onTick:12',
      lastTickAtMs: 1_714_000_000_000,
      hud: {
        totalPlayers: 4,
        localPlayer: {
          playerId: 'player-1',
          displayName: 'Player 1',
          team: 'solo',
          health: 75,
          maxHealth: 100,
          position: { x: 10, y: 20 },
          shield: 25,
          armor: { mitigation: 0.25, durability: 80 },
          weapon: {
            weaponId: 'weapon:primary',
            slot: 1,
            ammoInMagazine: 2,
            magazineSize: 3,
            reserveAmmo: 6,
            cooldownRemainingTicks: 0,
            reloadRemainingTicks: 0,
            reloadTotalTicks: 12,
          },
          inventory: { itemIds: ['health-pack'], capacity: 5 },
          pickupPrompt: {
            itemKind: 'ammo-box',
            tier: 'common',
            distance: 1.2,
            action: 'pickup-loot',
            available: true,
          },
          pickupToast: {
            itemKind: 'ammo-box',
            tier: 'common',
            quantity: 1,
            tick: 118,
          },
          damageIndicator: {
            sourceId: 'player-2',
            angleDeg: 90,
            amount: 12,
            tick: 119,
          },
          stats: { kills: 1, deaths: 0 },
          statusEffects: [{ effectId: 'reveal', remainingTicks: 20, stacks: 1 }],
          abilityCooldowns: [{ abilityId: 'dash', remainingTicks: 8 }],
        },
        zoneStatus: {
          phase: 'countdown',
          secondsRemaining: 42,
        },
        scoreboard: [
          {
            playerId: 'player-1',
            displayName: 'Player 1',
            team: 'solo',
            health: 75,
            alive: true,
            kills: 1,
            deaths: 0,
          },
          {
            playerId: 'player-1',
            displayName: 'Player 1',
            team: 'solo',
            health: 75,
            alive: true,
            kills: 0,
            deaths: 0,
          },
        ],
        minimap: {
          zone: { cx: 32, cy: 32, radius: 64 },
          players: [{ playerId: 'player-1', x: 10, y: 20, local: true, alive: true, health: 75 }],
          objects: [
            { objectId: 'crate-1', x: 15, y: 18, kind: 'pickup', tier: 'rare', available: true },
          ],
        },
        gameplayEvents: [
          {
            _tag: 'EntityDefeated',
            targetId: 'player-2',
            sourceId: 'zone',
            tick: 120,
          },
          {
            _tag: 'ItemGranted',
            targetId: 'player-1',
            itemId: 'ammo-box:common',
            slot: 0,
            quantity: 1,
            tick: 121,
          },
        ],
        gameOver: {
          winnerId: 'player-1',
          winnerDisplayName: 'Player 1',
          alivePlayers: 1,
          totalPlayers: 4,
          tickCount: 500,
        },
      },
      diagnostics: {
        telemetry: {
          tickRate: 20,
          tickBudgetMs: 50,
          lastTickDurationMs: 2.5,
          averageTickDurationMs: 1.4,
          maxTickDurationMs: 4.2,
          overBudgetTickCount: 0,
          uptimeMs: 1_200,
          inputLatencyTicks: 1,
          maxInputLatencyTicks: 2,
          backpressureFrameCount: 0,
          errorCount: 0,
        },
        bandwidth: {
          snapshotFrames: 12,
          eventFrames: 2,
          unknownFrames: 0,
          totalFrameBytes: 4_096,
          lastFrameBytes: 320,
          maxFrameBytes: 512,
          averageFrameBytes: 341.33,
          inputEvents: 3,
          inputBytes: 192,
          lastInputBytes: 64,
          pendingSnapshotFrames: 0,
        },
        replay: {
          inputFrames: 3,
          snapshotFrames: 12,
          eventFrames: 2,
          byteSize: 4_288,
          rollingHash: 'fnv1a:1234abcd',
          recorderStatus: 'recording',
          deterministicVerifier: 'battle-royale-replay-harness',
        },
        entities: {
          aliveEntities: 24,
          players: 4,
          alivePlayers: 3,
          projectiles: 1,
          pickups: 2,
          lootSources: 2,
          collisionBodies: 5,
          visionBlockers: 4,
          hitboxes: 4,
          deployables: 1,
          hazards: 1,
          zones: 1,
        },
        debugOverlay: {
          collision: 8,
          lineOfSight: 4,
          hitboxes: 4,
          projectiles: 1,
          spawnSlots: 4,
          lootRolls: 2,
          zone: 1,
        },
        budgets: {
          tickOverBudget: false,
          snapshotOverBudget: false,
          backpressureOverBudget: false,
          snapshotFrameBudgetBytes: 8_192,
          inputBacklogBudgetFrames: 8,
        },
      },
    });
  });

  it('round-trips PlaytestSessionView with optional runtimeMetrics', () => {
    roundTrip(PlaytestSessionView, {
      id: sessionId,
      projectId,
      mapId,
      status: 'Running',
      activePlugins: ['@tileborne-plugins/battle-royale'],
      runtimeMetrics: {
        tickCount: 1,
        playerCount: 0,
        lastPluginEvent: 'onInit',
        lastTickAtMs: 1_714_000_000_001,
      },
    });
  });

  it('round-trips playtest list and start responses', () => {
    const session = {
      id: sessionId,
      projectId,
      mapId,
      status: 'Running' as const,
    };
    roundTrip(PlaytestStartResponse, { session });
    roundTrip(PlaytestListResponse, { sessions: [session] });
  });

  it('round-trips bounded behavior inspector snapshots and debug controls', () => {
    roundTrip(PlaytestBehaviorDebugControlRequest, {
      sessionId,
      command: 'step',
    });
    roundTrip(PlaytestBehaviorDebugInspectResponse, {
      snapshot: {
        sessionId,
        status: 'paused',
        tick: 12,
        traces: [
          {
            sequence: 4,
            tick: 12,
            behaviorId: `behavior:${UUID}`,
            instanceId: `behavior:${UUID}`,
            sourceKind: 'visual',
            eventId: 'player.spawned',
            event: { playerId: 'player-1' },
            stateBefore: { spawned: false },
            commands: [{ kind: 'entity.spawn', payload: { entityId: 'player-1' } }],
            state: { spawned: true },
            steps: [
              { kind: 'branch', nodeId: 'branch-1', branch: 'then' },
              { kind: 'action', nodeId: 'spawn-1', actionId: 'entity.spawn' },
            ],
            source: {
              sourceKind: 'visual',
              filePath: 'behaviors/player-spawn.behavior.json',
              nodeId: 'spawn-1',
            },
          },
        ],
        diagnostics: [],
        states: [{ behaviorId: `behavior:${UUID}`, state: { spawned: true } }],
        lastReload: {
          behaviorId: `behavior:${UUID}`,
          status: 'applied',
          hash: 'sha256:fixture',
        },
      },
    });
  });
});
