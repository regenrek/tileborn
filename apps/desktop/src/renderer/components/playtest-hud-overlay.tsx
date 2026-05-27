import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  Badge,
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Progress,
  typography,
} from '@tileborne/ui';

import {
  eventKey,
  formatAlivePlayersLabel,
  formatZoneStatusLabel,
  healthPercent,
  type PlaytestHudMetrics,
} from '@/lib/playtest-hud-utils';

interface HudInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

interface PlaytestHudOverlayProps {
  readonly metrics: PlaytestHudMetrics | undefined;
  readonly mapId: string;
  readonly projectId: string;
  readonly onPlayAgain: (projectId: string, mapId: string) => void | Promise<void>;
  readonly onBackToEditor: () => void | Promise<void>;
  readonly isRestarting?: boolean;
  /**
   * Plugin-owned HUD insets sourced from `RuntimePluginRenderManifest.hudInsets`
   * (ADR-0014 Phase 1). Pushes the HUD anchor area inward by the given pixel
   * amounts. Omitted / all-zero values yield the legacy edge-anchored layout.
   */
  readonly hudInsets?: HudInsets;
}

interface KillToast {
  readonly id: string;
  readonly message: string;
}

const TOAST_DURATION_MS = 2_000;

export function PlaytestHudOverlay({
  metrics,
  mapId,
  projectId,
  onPlayAgain,
  onBackToEditor,
  isRestarting = false,
  hudInsets,
}: PlaytestHudOverlayProps) {
  const insetStyle: CSSProperties | undefined = hudInsets
    ? {
        top: hudInsets.top,
        right: hudInsets.right,
        bottom: hudInsets.bottom,
        left: hudInsets.left,
      }
    : undefined;
  const hud = metrics?.hud;
  const [toast, setToast] = useState<KillToast | null>(null);
  const seenEventsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!hud?.recentEvents.length) {
      return;
    }

    for (const event of hud.recentEvents) {
      const key = eventKey(event);
      if (seenEventsRef.current.has(key)) {
        continue;
      }
      seenEventsRef.current.add(key);
      if (event._tag === 'PlayerKilled') {
        setToast({
          id: key,
          message: `${event.victimDisplayName} eliminated`,
        });
      }
    }
  }, [hud?.recentEvents]);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }
    const timer = window.setTimeout(() => setToast(null), TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const aliveCount = metrics?.playerCount ?? 0;
  const totalPlayers = hud?.totalPlayers ?? aliveCount;
  const localPlayer = hud?.localPlayer;
  const gameOver = hud?.gameOver;

  return (
    <>
      <div
        className="pointer-events-none absolute inset-0 z-30"
        data-testid="playtest-hud-overlay"
        aria-hidden={!hud}
        style={insetStyle}
        data-hud-inset-top={hudInsets?.top}
        data-hud-inset-right={hudInsets?.right}
        data-hud-inset-bottom={hudInsets?.bottom}
        data-hud-inset-left={hudInsets?.left}
      >
        <div className="absolute left-3 top-3 flex max-w-[min(16rem,40vw)] flex-col gap-2 sm:left-4 sm:top-4">
          {localPlayer ? (
            <div
              className="pointer-events-auto rounded-lg border border-border/80 bg-background/85 px-3 py-2 shadow-sm backdrop-blur-sm"
              data-testid="playtest-hud-local-player"
            >
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <Badge variant="secondary" data-testid="playtest-hud-player-name">
                  {localPlayer.displayName}
                </Badge>
                <span className={cn(typography.bodyMicro, 'text-muted-foreground')}>
                  {Math.round(localPlayer.health)} HP
                </span>
              </div>
              <Progress
                value={healthPercent(localPlayer.health, localPlayer.maxHealth)}
                data-testid="playtest-hud-health-bar"
              />
            </div>
          ) : null}
        </div>

        <div className="absolute right-3 top-3 sm:right-4 sm:top-4">
          <Badge
            variant="outline"
            className="pointer-events-auto border-border/80 bg-background/85 px-3 py-1 text-foreground shadow-sm backdrop-blur-sm"
            data-testid="playtest-hud-alive-count"
          >
            {formatAlivePlayersLabel(aliveCount, totalPlayers)}
          </Badge>
        </div>

        {hud?.zoneStatus ? (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
            <Badge
              variant="info"
              className="pointer-events-auto border-info/30 bg-background/85 px-3 py-1 shadow-sm backdrop-blur-sm"
              data-testid="playtest-hud-zone-status"
            >
              {formatZoneStatusLabel(hud.zoneStatus)}
            </Badge>
          </div>
        ) : null}

        {toast ? (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <Badge
              variant="destructive"
              className="pointer-events-none px-4 py-2 text-sm shadow-lg"
              data-testid="playtest-hud-kill-toast"
            >
              {toast.message}
            </Badge>
          </div>
        ) : null}
      </div>

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
