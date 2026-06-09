import type { HudAnchor, HudLayout, HudWidgetInstanceId } from '@tileborne/core';
import { Option } from 'effect';
import { useMemo } from 'react';
import {
  deriveHudWidgetContext,
  HudOverlay,
  type HudInsets,
  type HudMetrics,
} from '@tileborne/game-client';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@tileborne/ui';

/**
 * Editor playtest HUD = the shared layout-driven HUD chassis
 * (`@tileborne/game-client` `HudOverlay`) plus the editor-owned match-end
 * dialog. The dialog stays here because "Back to Editor" / "Play Again" are
 * editor flows, not part of the neutral chassis (same split as ADR-0022's
 * menu framework).
 */

interface PlaytestHudOverlayProps {
  readonly metrics: HudMetrics | undefined;
  readonly mapId: string;
  readonly projectId: string;
  readonly onPlayAgain: (projectId: string, mapId: string) => void | Promise<void>;
  readonly onBackToEditor: () => void | Promise<void>;
  readonly isRestarting?: boolean;
  /** Plugin-owned HUD insets (ADR-0014 Phase 1); see `HudOverlayProps.hudInsets`. */
  readonly hudInsets?: HudInsets;
  /** Effective HUD layout (plugin default ⊕ project layout ⊕ user overlay). */
  readonly layout?: HudLayout;
  /** Visual HUD-editor mode; see `HudOverlayProps.editing`. */
  readonly editing?: boolean;
  readonly onMoveWidget?: (widgetId: HudWidgetInstanceId, anchor: HudAnchor) => void;
}

const normalizeHudLayoutForOverlay = (layout: HudLayout | undefined): HudLayout | undefined => {
  if (layout === undefined) {
    return undefined;
  }

  return {
    ...layout,
    widgets: layout.widgets.map((widget) => {
      const offset = widget.offset as unknown;
      if (Option.isOption(offset)) {
        return widget;
      }
      return {
        ...widget,
        offset:
          offset === undefined || offset === null
            ? Option.none()
            : Option.some(offset as NonNullable<typeof offset>),
      };
    }),
  } as HudLayout;
};

export function PlaytestHudOverlay({
  metrics,
  mapId,
  projectId,
  onPlayAgain,
  onBackToEditor,
  isRestarting = false,
  hudInsets,
  layout,
  editing = false,
  onMoveWidget,
}: PlaytestHudOverlayProps) {
  const ctx = deriveHudWidgetContext(metrics);
  const overlayLayout = useMemo(() => normalizeHudLayoutForOverlay(layout), [layout]);
  const gameOver = ctx.hud?.gameOver;
  const localScoreboardEntry = ctx.scoreboard.find(
    (entry) => entry.playerId === ctx.localPlayer?.playerId,
  );
  const localStats =
    ctx.localPlayer?.stats ??
    (localScoreboardEntry === undefined
      ? undefined
      : { kills: localScoreboardEntry.kills, deaths: localScoreboardEntry.deaths });
  const winnerScore = gameOver
    ? ctx.scoreboard.find((entry) => entry.playerId === gameOver.winnerId)
    : undefined;

  return (
    <>
      <HudOverlay
        metrics={metrics}
        hudInsets={hudInsets}
        layout={overlayLayout}
        editing={editing}
        onMoveWidget={onMoveWidget}
      />

      <Dialog open={gameOver !== undefined} onOpenChange={() => undefined}>
        <DialogContent
          className="sm:max-w-md"
          showCloseButton={false}
          data-testid="playtest-win-dialog"
        >
          <DialogHeader>
            <DialogTitle>Victory</DialogTitle>
            <DialogDescription>
              {gameOver ? `${gameOver.winnerDisplayName} wins the match.` : 'Match complete.'}
            </DialogDescription>
          </DialogHeader>

          {gameOver ? (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Winner</dt>
                <dd className="font-medium" data-testid="playtest-win-winner">
                  {gameOver.winnerDisplayName}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Survivors</dt>
                <dd className="font-medium" data-testid="playtest-win-survivors">
                  {gameOver.alivePlayers} / {gameOver.totalPlayers}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-muted-foreground">Match length</dt>
                <dd className="font-medium" data-testid="playtest-win-ticks">
                  {gameOver.tickCount} ticks
                </dd>
              </div>
              {winnerScore ? (
                <div>
                  <dt className="text-muted-foreground">Winner K/D</dt>
                  <dd className="font-medium tabular-nums" data-testid="playtest-win-winner-stats">
                    {winnerScore.kills} / {winnerScore.deaths}
                  </dd>
                </div>
              ) : null}
              {localStats ? (
                <div>
                  <dt className="text-muted-foreground">Your K/D</dt>
                  <dd className="font-medium tabular-nums" data-testid="playtest-win-local-stats">
                    {localStats.kills} / {localStats.deaths}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={isRestarting}
              onClick={() => void onBackToEditor()}
              data-testid="playtest-win-back-to-editor"
            >
              Back to Editor
            </Button>
            <Button
              type="button"
              disabled={isRestarting}
              onClick={() => void onPlayAgain(projectId, mapId)}
              data-testid="playtest-win-play-again"
            >
              Play Again
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
