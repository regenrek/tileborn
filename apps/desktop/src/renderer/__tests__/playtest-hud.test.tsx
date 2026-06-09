// @vitest-environment jsdom

import { CORE_HUD_WIDGETS, HudLayout } from '@tileborne/core';
import { render, screen, act, within } from '@testing-library/react';
import { Schema } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import {
  formatAlivePlayersLabel,
  formatZoneStatusLabel,
  healthPercent,
} from '@tileborne/game-client';

import { PlaytestHudOverlay } from '@/components/playtest-hud-overlay';

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

  it('renders weapon, armor, inventory, pickup, minimap, and scoreboard widgets', () => {
    render(
      <PlaytestHudOverlay
        metrics={{
          ...baseMetrics,
          hud: {
            ...baseMetrics.hud,
            localPlayer: {
              ...baseMetrics.hud.localPlayer,
              team: 'blue',
              position: { x: 10, y: 20 },
              shield: 30,
              armor: { mitigation: 0.25, durability: 80 },
              weapon: {
                weaponId: 'weapon:primary',
                slot: 2,
                ammoInMagazine: 1,
                magazineSize: 3,
                reserveAmmo: 6,
                reloadRemainingTicks: 6,
                reloadTotalTicks: 12,
              },
              inventory: { itemIds: ['health-pack'], capacity: 5 },
              pickupPrompt: {
                itemKind: 'ammo-box',
                tier: 'common',
                distance: 1.1,
                action: 'pickup-loot',
                available: true,
              },
              damageIndicator: {
                sourceId: 'player-2',
                angleDeg: 90,
                amount: 12,
                tick: 118,
              },
              stats: { kills: 2, deaths: 0 },
            },
            scoreboard: [
              {
                playerId: 'player-1',
                displayName: 'Player 1',
                team: 'blue',
                health: 65,
                alive: true,
                kills: 2,
                deaths: 0,
              },
              {
                playerId: 'player-3',
                displayName: 'Player 3',
                team: 'blue',
                health: 40,
                alive: true,
                kills: 0,
                deaths: 1,
              },
            ],
            minimap: {
              zone: { cx: 32, cy: 32, radius: 64 },
              players: [
                { playerId: 'player-1', x: 10, y: 20, local: true, alive: true, health: 65 },
              ],
              objects: [
                { objectId: 'crate-1', x: 12, y: 18, kind: 'pickup', tier: 'rare', available: true },
              ],
            },
          },
        }}
        projectId="project-1"
        mapId="map-1"
        onPlayAgain={vi.fn()}
        onBackToEditor={vi.fn()}
      />,
    );

    expect(screen.getByTestId('playtest-hud-shield').textContent).toBe('SH 30');
    expect(screen.getByTestId('playtest-hud-armor').textContent).toBe('AR 80');
    expect(screen.getByTestId('playtest-hud-weapon-panel')).toBeTruthy();
    expect(screen.getByTestId('playtest-hud-weapon-name').textContent).toBe('primary');
    expect(screen.getByTestId('playtest-hud-ammo').textContent).toBe('1 / 3');
    expect(screen.getByTestId('playtest-hud-reload-progress')).toBeTruthy();
    expect(screen.getByTestId('playtest-hud-inventory').textContent).toContain('health-pack');
    expect(screen.getByTestId('playtest-hud-pickup-prompt').textContent).toContain('ammo-box');
    expect(screen.getByTestId('playtest-hud-minimap')).toBeTruthy();
    expect(screen.getByTestId('playtest-hud-scoreboard').textContent).toContain('2/0');
    expect(screen.getByTestId('playtest-hud-team-roster').textContent).toContain('Player 3');
    expect(screen.getByTestId('playtest-hud-damage-indicator')).toBeTruthy();
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

    expect(screen.getByTestId('playtest-hud-event-toast').textContent).toBe('Player 2 eliminated');

    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    expect(screen.queryByTestId('playtest-hud-event-toast')).toBeNull();
    vi.useRealTimers();
  });

  it('shows a pickup toast for new PickupCollected events', () => {
    vi.useFakeTimers();
    const metrics = {
      ...baseMetrics,
      hud: {
        ...baseMetrics.hud,
        recentEvents: [
          {
            _tag: 'PickupCollected' as const,
            playerId: 'player-1',
            playerDisplayName: 'Player 1',
            itemKind: 'ammo-box',
            tier: 'common',
            quantity: 1,
            tick: 132,
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

    expect(screen.getByTestId('playtest-hud-event-toast').textContent).toBe('ammo-box common x1');
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(screen.queryByTestId('playtest-hud-event-toast')).toBeNull();
    vi.useRealTimers();
  });

  it('renders widgets from the HUD layout data: moved, hidden, and duplicated placements apply', () => {
    // The user's designable surface: the same metrics render a completely
    // different HUD purely by changing layout DATA — no shell code involved.
    const layout = Schema.decodeUnknownSync(HudLayout)({
      id: 'custom-hud',
      widgets: [
        // Alive count moved to the bottom-right with an offset.
        {
          id: 'alive-count',
          kind: CORE_HUD_WIDGETS.AliveCount,
          anchor: 'bottom-right',
          order: 0,
          enabled: true,
          offset: { x: -10, y: -10 },
        },
        // A SECOND alive-count instance ("anzahl anzeigen").
        {
          id: 'alive-count-2',
          kind: CORE_HUD_WIDGETS.AliveCount,
          anchor: 'top-center',
          order: 0,
          enabled: true,
        },
        // Local player status hidden.
        {
          id: 'local-player',
          kind: CORE_HUD_WIDGETS.LocalPlayerStatus,
          anchor: 'top-left',
          order: 0,
          enabled: false,
        },
        // Zone status kept, default spot.
        {
          id: 'zone-status',
          kind: CORE_HUD_WIDGETS.ZoneStatus,
          anchor: 'bottom-center',
          order: 0,
          enabled: true,
        },
        // A plugin-declared custom kind the editor chassis does not know: skipped.
        {
          id: 'mana',
          kind: 'myMode.ManaBar',
          anchor: 'bottom-left',
          order: 0,
          enabled: true,
        },
      ],
    });

    const { container } = render(
      <PlaytestHudOverlay
        metrics={baseMetrics}
        layout={layout}
        projectId="project-1"
        mapId="map-1"
        onPlayAgain={vi.fn()}
        onBackToEditor={vi.fn()}
      />,
    );
    const scoped = within(container as HTMLElement);

    // Two alive-count instances render; each sits in its layout-declared anchor.
    const aliveCounts = scoped.getAllByTestId('playtest-hud-alive-count');
    expect(aliveCounts).toHaveLength(2);
    const anchors = aliveCounts.map(
      (node) => node.closest('[data-hud-anchor]')?.getAttribute('data-hud-anchor'),
    );
    expect(anchors).toContain('bottom-right');
    expect(anchors).toContain('top-center');

    // The offset placement carries its pixel offset.
    const offsetWrapper = container.querySelector('[data-hud-widget-id="alive-count"]');
    expect((offsetWrapper as HTMLElement).style.transform).toBe('translate(-10px, -10px)');

    // Disabled widget does not render even though its state exists.
    expect(scoped.queryByTestId('playtest-hud-local-player')).toBeNull();
    // Zone status still renders from the same metrics.
    expect(scoped.getByTestId('playtest-hud-zone-status').textContent).toBe('Zone shrinks in 42s');
    // Unknown kind is skipped without breaking the chassis.
    expect(container.querySelector('[data-hud-widget-id="mana"]')).toBeNull();
    // The layout identity is exposed for tooling.
    expect(
      scoped.getByTestId('playtest-hud-overlay').getAttribute('data-hud-layout-id'),
    ).toBe('custom-hud');
  });

  it('normalizes legacy HUD placement offsets before rendering the shared overlay', () => {
    const layout = {
      id: 'legacy-project-layout',
      widgets: [
        {
          id: 'alive-count',
          kind: CORE_HUD_WIDGETS.AliveCount,
          anchor: 'top-right',
          order: 0,
          enabled: true,
        },
        {
          id: 'alive-count-offset',
          kind: CORE_HUD_WIDGETS.AliveCount,
          anchor: 'bottom-right',
          order: 1,
          enabled: true,
          offset: { x: 7, y: -3 },
        },
      ],
    } as unknown as HudLayout;

    const { container } = render(
      <PlaytestHudOverlay
        metrics={baseMetrics}
        layout={layout}
        projectId="project-1"
        mapId="map-1"
        onPlayAgain={vi.fn()}
        onBackToEditor={vi.fn()}
      />,
    );

    expect(container.querySelector('[data-hud-widget-id="alive-count"]')?.getAttribute('style')).toBe(
      null,
    );
    expect(
      (container.querySelector('[data-hud-widget-id="alive-count-offset"]') as HTMLElement).style
        .transform,
    ).toBe('translate(7px, -3px)');
  });

  it('supports drag-and-drop widget placement in HUD edit mode', () => {
    const layout = Schema.decodeUnknownSync(HudLayout)({
      id: 'edit-hud',
      widgets: [
        {
          id: 'alive-count',
          kind: CORE_HUD_WIDGETS.AliveCount,
          anchor: 'top-center',
          order: 0,
          enabled: true,
        },
      ],
    });
    const onMoveWidget = vi.fn();
    const { container } = render(
      <PlaytestHudOverlay
        metrics={baseMetrics}
        layout={layout}
        editing
        onMoveWidget={onMoveWidget}
        mapId="map-1"
        projectId="project-1"
        onPlayAgain={vi.fn()}
        onBackToEditor={vi.fn()}
      />,
    );

    // Edit mode renders ALL nine anchors as drop zones, even empty ones.
    const dropZones = container.querySelectorAll('[data-hud-drop-zone]');
    expect(dropZones).toHaveLength(9);

    // Widgets are draggable in edit mode.
    const widget = container.querySelector('[data-hud-widget-id="alive-count"]');
    expect((widget as HTMLElement).draggable).toBe(true);

    // Dropping a dragged widget onto an anchor reports the move.
    const dataTransfer = {
      data: new Map<string, string>(),
      setData(type: string, value: string) {
        this.data.set(type, value);
      },
      getData(type: string) {
        return this.data.get(type) ?? '';
      },
      effectAllowed: 'none',
    };
    act(() => {
      widget!.dispatchEvent(
        Object.assign(new Event('dragstart', { bubbles: true }), { dataTransfer }),
      );
    });
    const target = container.querySelector('[data-hud-drop-zone="bottom-left"]');
    act(() => {
      target!.dispatchEvent(
        Object.assign(new Event('drop', { bubbles: true }), { dataTransfer }),
      );
    });
    expect(onMoveWidget).toHaveBeenCalledWith('alive-count', 'bottom-left');
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
            localPlayer: {
              ...baseMetrics.hud.localPlayer,
              stats: { kills: 3, deaths: 1 },
            },
            scoreboard: [
              {
                playerId: 'player-1',
                displayName: 'Player 1',
                health: 65,
                alive: true,
                kills: 3,
                deaths: 1,
              },
            ],
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
    expect(screen.getByTestId('playtest-win-winner-stats').textContent).toBe('3 / 1');
    expect(screen.getByTestId('playtest-win-local-stats').textContent).toBe('3 / 1');
    expect(screen.getByTestId('playtest-win-play-again')).toBeTruthy();
    expect(screen.getByTestId('playtest-win-back-to-editor')).toBeTruthy();
  });
});
