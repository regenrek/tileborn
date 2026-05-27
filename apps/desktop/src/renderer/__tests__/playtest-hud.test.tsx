// @vitest-environment jsdom

import { render, screen, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PlaytestHudOverlay } from '@/components/playtest-hud-overlay';
import {
  formatAlivePlayersLabel,
  formatZoneStatusLabel,
  healthPercent,
} from '@/lib/playtest-hud-utils';

const EVENT_TIMESTAMP_MS = 1_700_000_000_000;

const baseMetrics = {
  playerCount: 2,
  tickCount: 120,
  hud: {
    totalPlayers: 4,
    localPlayer: {
      playerId: 'player-1',
      displayName: 'Player 1',
      health: 65,
      maxHealth: 100,
    },
    zoneStatus: {
      phase: 'countdown' as const,
      secondsRemaining: 42,
    },
    recentEvents: [],
  },
};

describe('playtest hud utils', () => {
  it('formats alive player and zone labels', () => {
    expect(formatAlivePlayersLabel(2, 4)).toBe('2 / 4 players alive');
    expect(formatZoneStatusLabel({ phase: 'countdown', secondsRemaining: 42 })).toBe(
      'Zone shrinks in 42s',
    );
    expect(formatZoneStatusLabel({ phase: 'shrinking' })).toBe('Zone shrinking');
    expect(formatZoneStatusLabel({ phase: 'stable' })).toBe('Zone stable');
    expect(healthPercent(65, 100)).toBe(65);
  });
});

describe('PlaytestHudOverlay', () => {
  it('renders alive count, health bar, and zone status from runtime metrics', () => {
    render(
      <PlaytestHudOverlay
        metrics={baseMetrics}
        projectId="project-1"
        mapId="map-1"
        onPlayAgain={vi.fn()}
        onBackToEditor={vi.fn()}
      />,
    );

    expect(screen.getByTestId('playtest-hud-alive-count').textContent).toBe('2 / 4 players alive');
    expect(screen.getByTestId('playtest-hud-player-name').textContent).toBe('Player 1');
    expect(screen.getByTestId('playtest-hud-health-bar').getAttribute('aria-valuenow')).toBe('65');
    expect(screen.getByTestId('playtest-hud-zone-status').textContent).toBe('Zone shrinks in 42s');
  });

  it('shows an elimination toast for new PlayerKilled events', () => {
    vi.useFakeTimers();
    const metrics = {
      ...baseMetrics,
      hud: {
        ...baseMetrics.hud,
        recentEvents: [
          {
            _tag: 'PlayerKilled' as const,
            victimId: 'player-2',
            victimDisplayName: 'Player 2',
            killerId: 'zone',
            tick: 130,
            emittedAtMs: EVENT_TIMESTAMP_MS,
          },
        ],
      },
    };

    render(
      <PlaytestHudOverlay
        metrics={metrics}
        projectId="project-1"
        mapId="map-1"
        onPlayAgain={vi.fn()}
        onBackToEditor={vi.fn()}
      />,
    );

    expect(screen.getByTestId('playtest-hud-kill-toast').textContent).toBe('Player 2 eliminated');

    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    expect(screen.queryByTestId('playtest-hud-kill-toast')).toBeNull();
    vi.useRealTimers();
  });

  it('opens the win dialog when GameOver is present in hud metrics', () => {
    render(
      <PlaytestHudOverlay
        metrics={{
          ...baseMetrics,
          playerCount: 1,
          hud: {
            ...baseMetrics.hud,
            totalPlayers: 4,
            gameOver: {
              winnerId: 'player-1',
              winnerDisplayName: 'Player 1',
              alivePlayers: 1,
              totalPlayers: 4,
              tickCount: 500,
            },
            recentEvents: [
              {
                _tag: 'GameOver',
                winnerId: 'player-1',
                winnerDisplayName: 'Player 1',
                alivePlayers: 1,
                totalPlayers: 4,
                tickCount: 500,
                emittedAtMs: EVENT_TIMESTAMP_MS,
              },
            ],
          },
        }}
        projectId="project-1"
        mapId="map-1"
        onPlayAgain={vi.fn()}
        onBackToEditor={vi.fn()}
      />,
    );

    expect(screen.getByTestId('playtest-win-dialog')).toBeTruthy();
    expect(screen.getByTestId('playtest-win-winner').textContent).toBe('Player 1');
    expect(screen.getByTestId('playtest-win-survivors').textContent).toBe('1 / 4');
    expect(screen.getByTestId('playtest-win-ticks').textContent).toBe('500 ticks');
    expect(screen.getByTestId('playtest-win-play-again')).toBeTruthy();
    expect(screen.getByTestId('playtest-win-back-to-editor')).toBeTruthy();
  });
});
