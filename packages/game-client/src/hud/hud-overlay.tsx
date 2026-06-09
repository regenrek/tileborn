import { Option } from "effect";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type DragEvent,
} from "react";

import {
  CORE_HUD_WIDGETS,
  standardHudLayout,
  type HudAnchor,
  type HudLayout,
  type HudWidgetInstanceId,
  type HudWidgetPlacement,
} from "@tileborne/core";
import { Badge, cn, Progress, typography } from "@tileborne/ui";

import {
  eventKey,
  formatAlivePlayersLabel,
  formatZoneStatusLabel,
  healthPercent,
  type HudMetrics,
  type HudState,
} from "./hud-state.js";
import { hudWidgetComponents, type HudWidgetRegistration } from "./hud-widget-registry.js";

/**
 * Layout-driven HUD chassis shared by the editor playtest and the shipped
 * game client (same split as ADR-0022's menu framework: the engine owns the
 * neutral React chassis, plugins own the DATA).
 *
 * The chassis owns the anchor slots and the widget COMPONENTS for the
 * engine's baseline widget kinds; WHICH widgets render, WHERE they sit, and
 * HOW MANY there are is entirely `@tileborne/core` `HudLayout` DATA —
 * contributed by the active game-mode plugin (`RuntimeHudLayout` slot) and
 * merged with project/user customisation overlays
 * (`resolveEffectiveHudLayout`). Unknown widget kinds are skipped, so a
 * plugin can declare its own kinds for surfaces that ship their own widget
 * components without breaking this chassis. Modal flows (match-end dialogs
 * etc.) stay host-owned — they are not anchored HUD widgets.
 */

export interface HudInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface HudOverlayProps {
  readonly metrics: HudMetrics | undefined;
  /**
   * Plugin-owned HUD insets sourced from `RuntimePluginRenderManifest.hudInsets`
   * (ADR-0014 Phase 1). Pushes the HUD anchor area inward by the given pixel
   * amounts. Omitted / all-zero values yield the legacy edge-anchored layout.
   */
  readonly hudInsets?: HudInsets | undefined;
  /**
   * The EFFECTIVE HUD layout (plugin default ⊕ project layout ⊕ user overlay).
   * Defaults to the engine's neutral baseline arrangement.
   */
  readonly layout?: HudLayout | undefined;
  /**
   * Visual HUD-editor mode: anchor slots become drop zones and widgets become
   * draggable, so a widget can be dragged onto any of the nine anchors. The
   * layout mutation itself happens in the owning editor state via
   * {@link HudOverlayProps.onMoveWidget} — the overlay stays a pure renderer.
   */
  readonly editing?: boolean;
  readonly onMoveWidget?: ((widgetId: HudWidgetInstanceId, anchor: HudAnchor) => void) | undefined;
  /**
   * Custom widget components for plugin-/brand-declared kinds (executable
   * React per ADR-0004, composed by the app — see `HudWidgetRegistration`).
   * Engine `core.*` kinds cannot be overridden. Without a registration a
   * custom kind renders nothing (or a movable placeholder in edit mode).
   */
  readonly customWidgets?: readonly HudWidgetRegistration[] | undefined;
}

interface HudToast {
  readonly id: string;
  readonly message: string;
  readonly variant: "destructive" | "warning";
}

const TOAST_DURATION_MS = 2_000;
const DAMAGE_INDICATOR_TICKS = 40;
const MINIMAP_SIZE = 128;

type LocalPlayerState = NonNullable<HudState["localPlayer"]>;
type MinimapState = NonNullable<HudState["minimap"]>;
type ScoreboardEntry = NonNullable<HudState["scoreboard"]>[number];
type HudEventState = HudState["recentEvents"][number];

const UUID_SEGMENT_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const compactWeaponName = (weaponId: string): string => {
  const compactId = weaponId.split(":").at(-1) ?? weaponId;
  return UUID_SEGMENT_PATTERN.test(compactId) ? "Primary" : compactId;
};

const clampPercent = (value: number): number => Math.max(0, Math.min(100, value));

const reloadPercent = (weapon: NonNullable<LocalPlayerState["weapon"]>): number => {
  const total = weapon.reloadTotalTicks ?? 0;
  const remaining = weapon.reloadRemainingTicks ?? 0;
  if (total <= 0 || remaining <= 0) {
    return 0;
  }
  return clampPercent(Math.round(((total - remaining) / total) * 100));
};

const minimapCoord = (value: number, center: number, radius: number): number => {
  if (radius <= 0) {
    return 50;
  }
  return clampPercent(50 + ((value - center) / (radius * 2)) * 100);
};

const minimapObjectTone = (kind: MinimapState["objects"][number]["kind"]): string => {
  if (kind === "hazard") {
    return "bg-destructive";
  }
  if (kind === "pickup") {
    return "bg-warning";
  }
  return "bg-info";
};

const isFreshDamageIndicator = (
  damageIndicator: LocalPlayerState["damageIndicator"] | undefined,
  tickCount: number | undefined,
): damageIndicator is NonNullable<LocalPlayerState["damageIndicator"]> =>
  damageIndicator !== undefined &&
  tickCount !== undefined &&
  tickCount - damageIndicator.tick >= 0 &&
  tickCount - damageIndicator.tick <= DAMAGE_INDICATOR_TICKS;

/** Everything a HUD widget may read — derived once per render from the metrics. */
export interface HudWidgetContext {
  readonly hud: HudState | undefined;
  readonly tickCount: number | undefined;
  readonly aliveCount: number;
  readonly totalPlayers: number;
  readonly localPlayer: LocalPlayerState | undefined;
  readonly scoreboard: readonly ScoreboardEntry[];
  readonly teamRoster: readonly ScoreboardEntry[];
  readonly killFeed: readonly Extract<HudEventState, { _tag: "PlayerKilled" }>[];
}

export interface HudWidgetProps {
  readonly ctx: HudWidgetContext;
}

function LocalPlayerStatusWidget({ ctx }: HudWidgetProps) {
  const localPlayer = ctx.localPlayer;
  if (!localPlayer) {
    return null;
  }
  return (
    <div
      className="pointer-events-auto rounded-lg border border-border/80 bg-background/85 px-3 py-2 shadow-sm backdrop-blur-sm"
      data-testid="playtest-hud-local-player"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <Badge variant="secondary" data-testid="playtest-hud-player-name">
          {localPlayer.displayName}
        </Badge>
        <span className={cn(typography.bodyMicro, "text-muted-foreground")}>
          {Math.round(localPlayer.health)} HP
        </span>
      </div>
      <Progress
        value={healthPercent(localPlayer.health, localPlayer.maxHealth)}
        data-testid="playtest-hud-health-bar"
      />
      {localPlayer.armor || localPlayer.shield !== undefined ? (
        <div className="mt-2 grid grid-cols-2 gap-1 text-[10px]">
          <Badge variant="info" className="justify-center" data-testid="playtest-hud-shield">
            SH {Math.round(localPlayer.shield ?? 0)}
          </Badge>
          <Badge variant="outline" className="justify-center" data-testid="playtest-hud-armor">
            AR {Math.round(localPlayer.armor?.durability ?? 0)}
          </Badge>
        </div>
      ) : null}
      {localPlayer.shield || localPlayer.statusEffects?.length || localPlayer.abilityCooldowns?.length ? (
        <div className="mt-2 flex max-w-full flex-wrap gap-1" data-testid="playtest-hud-status-row">
          {localPlayer.statusEffects?.map((effect) => (
            <Badge key={effect.effectId} variant="outline" className="max-w-full break-all text-[10px]">
              {effect.effectId} {effect.remainingTicks}
            </Badge>
          ))}
          {localPlayer.abilityCooldowns?.map((cooldown) => (
            <Badge key={cooldown.abilityId} variant="secondary" className="max-w-full break-all text-[10px]">
              {cooldown.abilityId} {cooldown.remainingTicks}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TeamRosterWidget({ ctx }: HudWidgetProps) {
  if (ctx.teamRoster.length === 0) {
    return null;
  }
  return (
    <div
      className="pointer-events-auto rounded-lg border border-border/80 bg-background/85 px-3 py-2 shadow-sm backdrop-blur-sm"
      data-testid="playtest-hud-team-roster"
    >
      <div className={cn(typography.bodyMicro, "mb-1 text-muted-foreground")}>
        {ctx.localPlayer?.team ? `Team ${ctx.localPlayer.team}` : "Team"}
      </div>
      <div className="flex flex-col gap-1">
        {ctx.teamRoster.slice(0, 4).map((entry) => (
          <div key={entry.playerId} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 text-xs">
            <span className={cn("truncate", entry.alive ? "text-foreground" : "text-muted-foreground")}>
              {entry.displayName}
            </span>
            <span className="tabular-nums text-muted-foreground">{Math.round(entry.health)} HP</span>
            <span className="tabular-nums">{entry.kills}/{entry.deaths}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AliveCountWidget({ ctx }: HudWidgetProps) {
  return (
    <Badge
      variant="outline"
      className="pointer-events-auto border-border/80 bg-background/85 px-3 py-1 text-foreground shadow-sm backdrop-blur-sm"
      data-testid="playtest-hud-alive-count"
    >
      {formatAlivePlayersLabel(ctx.aliveCount, ctx.totalPlayers)}
    </Badge>
  );
}

function MinimapWidget({ ctx }: HudWidgetProps) {
  const minimap = ctx.hud?.minimap;
  if (!minimap) {
    return null;
  }
  return (
    <div
      className="pointer-events-auto relative overflow-hidden rounded-lg border border-border/80 bg-background/85 shadow-sm backdrop-blur-sm"
      style={{ width: MINIMAP_SIZE, height: MINIMAP_SIZE }}
      data-testid="playtest-hud-minimap"
    >
      <div className="absolute inset-2 rounded-full border border-info/40" />
      {minimap.zone ? (
        <div
          className="absolute rounded-full border border-info/70 bg-info/10"
          style={{
            left: `${minimapCoord(minimap.zone.cx - minimap.zone.radius, minimap.zone.cx, minimap.zone.radius)}%`,
            top: `${minimapCoord(minimap.zone.cy - minimap.zone.radius, minimap.zone.cy, minimap.zone.radius)}%`,
            width: "100%",
            height: "100%",
          }}
        />
      ) : null}
      {minimap.objects.slice(0, 24).map((object) => (
        <span
          key={object.objectId}
          className={cn(
            "absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-sm",
            minimapObjectTone(object.kind),
            object.available === false ? "opacity-35" : "opacity-90",
          )}
          style={{
            left: `${minimapCoord(object.x, minimap.zone?.cx ?? 0, minimap.zone?.radius ?? 1)}%`,
            top: `${minimapCoord(object.y, minimap.zone?.cy ?? 0, minimap.zone?.radius ?? 1)}%`,
          }}
        />
      ))}
      {minimap.players.map((player) => (
        <span
          key={player.playerId}
          className={cn(
            "absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-background",
            player.local ? "bg-success" : player.alive ? "bg-foreground" : "bg-muted-foreground",
          )}
          style={{
            left: `${minimapCoord(player.x, minimap.zone?.cx ?? 0, minimap.zone?.radius ?? 1)}%`,
            top: `${minimapCoord(player.y, minimap.zone?.cy ?? 0, minimap.zone?.radius ?? 1)}%`,
          }}
        />
      ))}
    </div>
  );
}

function ScoreboardWidget({ ctx }: HudWidgetProps) {
  if (ctx.scoreboard.length === 0) {
    return null;
  }
  return (
    <div
      className="pointer-events-auto hidden w-[min(16rem,42vw)] rounded-lg border border-border/80 bg-background/85 p-2 shadow-sm backdrop-blur-sm md:block"
      data-testid="playtest-hud-scoreboard"
    >
      {ctx.scoreboard.slice(0, 5).map((entry) => (
        <div key={entry.playerId} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 py-0.5 text-xs">
          <span className={cn("min-w-0 truncate", entry.alive ? "text-foreground" : "text-muted-foreground")}>
            {entry.displayName}
            {entry.team ? (
              <span className="ml-1 text-[10px] text-muted-foreground">{entry.team}</span>
            ) : null}
          </span>
          <span className="tabular-nums text-muted-foreground">{Math.round(entry.health)} HP</span>
          <span className="tabular-nums">
            {entry.kills}/{entry.deaths}
          </span>
        </div>
      ))}
    </div>
  );
}

function ZoneStatusWidget({ ctx }: HudWidgetProps) {
  const zoneStatus = ctx.hud?.zoneStatus;
  if (!zoneStatus) {
    return null;
  }
  return (
    <div className="flex justify-center">
      <Badge
        variant="info"
        className="pointer-events-auto border-info/30 bg-background/85 px-3 py-1 shadow-sm backdrop-blur-sm"
        data-testid="playtest-hud-zone-status"
      >
        {formatZoneStatusLabel(zoneStatus)}
      </Badge>
    </div>
  );
}

function PickupPromptWidget({ ctx }: HudWidgetProps) {
  const pickupPrompt = ctx.localPlayer?.pickupPrompt;
  if (!pickupPrompt?.available) {
    return null;
  }
  return (
    <div className="flex justify-center">
      <div
        className="pointer-events-auto rounded-lg border border-warning/50 bg-background/90 px-3 py-1.5 text-center shadow-sm backdrop-blur-sm"
        data-testid="playtest-hud-pickup-prompt"
      >
        <span className={cn(typography.bodyMicro, "text-warning")}>
          {pickupPrompt.itemKind ?? "loot"} {pickupPrompt.tier ?? ""}
        </span>
      </div>
    </div>
  );
}

function WeaponPanelWidget({ ctx }: HudWidgetProps) {
  const weapon = ctx.localPlayer?.weapon;
  const inventory = ctx.localPlayer?.inventory;
  if (!weapon && !inventory) {
    return null;
  }
  return (
    <div
      className="pointer-events-auto rounded-lg border border-border/80 bg-background/90 px-3 py-2 shadow-sm backdrop-blur-sm"
      data-testid="playtest-hud-weapon-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className={cn(typography.bodyMicro, "text-muted-foreground")}>Slot {weapon?.slot ?? "-"}</div>
          <div className="truncate text-sm font-semibold" data-testid="playtest-hud-weapon-name">
            {weapon ? compactWeaponName(weapon.weaponId) : "Unarmed"}
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold tabular-nums" data-testid="playtest-hud-ammo">
            {weapon?.ammoInMagazine ?? "-"} / {weapon?.magazineSize ?? "-"}
          </div>
          <div className={cn(typography.bodyMicro, "text-muted-foreground")}>
            Reserve {weapon?.reserveAmmo ?? 0}
          </div>
        </div>
      </div>
      {weapon && (weapon.reloadRemainingTicks ?? 0) > 0 ? (
        <Progress
          className="mt-2"
          value={reloadPercent(weapon)}
          data-testid="playtest-hud-reload-progress"
        />
      ) : null}
      {inventory ? (
        <div className="mt-2 grid grid-cols-5 gap-1" data-testid="playtest-hud-inventory">
          {Array.from({ length: inventory.capacity }, (_, index) => (
            <div
              key={index}
              className="flex h-7 min-w-0 items-center justify-center rounded border border-border/70 bg-muted/40 px-1 text-[10px]"
            >
              <span className="truncate">{inventory.itemIds[index] ?? ""}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function KillFeedWidget({ ctx }: HudWidgetProps) {
  if (ctx.killFeed.length === 0) {
    return null;
  }
  return (
    <div
      className="pointer-events-auto hidden max-w-[min(18rem,38vw)] flex-col gap-1 md:flex"
      data-testid="playtest-hud-kill-feed"
    >
      {ctx.killFeed.map((event) => (
        <Badge key={eventKey(event)} variant="destructive" className="justify-start truncate">
          {event.victimDisplayName}
        </Badge>
      ))}
    </div>
  );
}

function EventToastWidget({ ctx }: HudWidgetProps) {
  const recentEvents = ctx.hud?.recentEvents;
  const [toast, setToast] = useState<HudToast | null>(null);
  const seenEventsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!recentEvents?.length) {
      return;
    }
    for (const event of recentEvents) {
      const key = eventKey(event);
      if (seenEventsRef.current.has(key)) {
        continue;
      }
      seenEventsRef.current.add(key);
      if (event._tag === "PlayerKilled") {
        setToast({
          id: key,
          message: `${event.victimDisplayName} eliminated`,
          variant: "destructive",
        });
      } else if (event._tag === "PickupCollected") {
        setToast({
          id: key,
          message: `${event.itemKind} ${event.tier} x${event.quantity}`,
          variant: "warning",
        });
      }
    }
  }, [recentEvents]);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }
    const timer = window.setTimeout(() => setToast(null), TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (!toast) {
    return null;
  }
  return (
    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
      <Badge
        variant={toast.variant}
        className="pointer-events-none px-4 py-2 text-sm shadow-lg"
        data-testid="playtest-hud-event-toast"
      >
        {toast.message}
      </Badge>
    </div>
  );
}

function DamageIndicatorWidget({ ctx }: HudWidgetProps) {
  const damageIndicator = ctx.localPlayer?.damageIndicator;
  if (!isFreshDamageIndicator(damageIndicator, ctx.tickCount)) {
    return null;
  }
  return (
    <div
      className="absolute left-1/2 top-1/2 h-28 w-28"
      data-testid="playtest-hud-damage-indicator"
      style={{ transform: `translate(-50%, -50%) rotate(${damageIndicator.angleDeg + 90}deg)` }}
    >
      <span
        className="absolute left-1/2 top-0 h-2 w-9 -translate-x-1/2 rounded-full bg-destructive shadow-[0_0_14px_hsl(var(--destructive)/0.8)]"
        data-testid="playtest-hud-damage-indicator-mark"
      />
    </div>
  );
}

/**
 * Widget components for the engine's baseline widget kinds. The layout names
 * kinds; this registry maps known kinds to components and SKIPS unknown ones,
 * so plugin-declared custom kinds never break the chassis.
 */
const HUD_WIDGET_REGISTRY: Readonly<Record<string, ComponentType<HudWidgetProps>>> = {
  [CORE_HUD_WIDGETS.LocalPlayerStatus]: LocalPlayerStatusWidget,
  [CORE_HUD_WIDGETS.TeamRoster]: TeamRosterWidget,
  [CORE_HUD_WIDGETS.AliveCount]: AliveCountWidget,
  [CORE_HUD_WIDGETS.Minimap]: MinimapWidget,
  [CORE_HUD_WIDGETS.Scoreboard]: ScoreboardWidget,
  [CORE_HUD_WIDGETS.ZoneStatus]: ZoneStatusWidget,
  [CORE_HUD_WIDGETS.PickupPrompt]: PickupPromptWidget,
  [CORE_HUD_WIDGETS.WeaponPanel]: WeaponPanelWidget,
  [CORE_HUD_WIDGETS.KillFeed]: KillFeedWidget,
  [CORE_HUD_WIDGETS.EventToast]: EventToastWidget,
  [CORE_HUD_WIDGETS.DamageIndicator]: DamageIndicatorWidget,
};

/**
 * Positioning classes per anchor. All anchors stack their widgets in a flex
 * column except `center`, which layers each widget across the full viewport so
 * crosshair-like indicators stay exactly centered.
 */
const HUD_ANCHOR_CLASSES: Readonly<Record<HudAnchor, string>> = {
  "top-left": "absolute left-3 top-3 flex max-w-[min(16rem,40vw)] flex-col gap-2 sm:left-4 sm:top-4",
  "top-center": "absolute left-1/2 top-3 flex -translate-x-1/2 flex-col items-center gap-2 sm:top-4",
  "top-right":
    "absolute right-3 top-3 flex max-w-[min(18rem,42vw)] flex-col items-end gap-2 sm:right-4 sm:top-4",
  "center-left": "absolute left-3 top-1/2 flex -translate-y-1/2 flex-col gap-2 sm:left-4",
  center: "absolute inset-0",
  "center-right": "absolute right-3 top-1/2 flex -translate-y-1/2 flex-col items-end gap-2 sm:right-4",
  "bottom-left": "absolute bottom-4 left-3 flex max-w-[min(18rem,38vw)] flex-col gap-1 sm:left-4",
  "bottom-center":
    "absolute bottom-4 left-1/2 flex w-[min(36rem,88vw)] -translate-x-1/2 flex-col gap-2",
  "bottom-right": "absolute bottom-4 right-3 flex max-w-[min(18rem,38vw)] flex-col items-end gap-1 sm:right-4",
};

const HUD_ANCHORS = Object.keys(HUD_ANCHOR_CLASSES) as readonly HudAnchor[];

/**
 * Drop-zone positioning while the HUD editor is active. Mirrors
 * {@link HUD_ANCHOR_CLASSES} except `center`, which is shown as a compact
 * centered target instead of covering the whole viewport (a full-screen zone
 * would swallow every drop).
 */
const HUD_EDIT_ANCHOR_CLASSES: Readonly<Record<HudAnchor, string>> = {
  ...HUD_ANCHOR_CLASSES,
  center:
    "absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2",
};

const HUD_WIDGET_DRAG_MIME = "application/x-tileborne-hud-widget";

/** Compact label for placeholder chips, e.g. "arena.manaBar" -> "Mana Bar". */
const placeholderLabel = (kind: string): string => {
  const segment = kind.split(".").at(-1) ?? kind;
  return segment.replace(/([a-z0-9])([A-Z])/gu, "$1 $2").replace(/^./u, (c) => c.toUpperCase());
};

/**
 * Edit-mode stand-in for widget kinds without a registered component (e.g.
 * plugin-custom kinds in the editor playtest, which is declarative-only per
 * ADR-0001). Keeps the placement visible, draggable, and re-anchorable even
 * though the real component only renders in the shipped client.
 */
function HudWidgetPlaceholder({ kind }: { readonly kind: string }) {
  return (
    <Badge
      variant="outline"
      className="pointer-events-auto border-dashed border-border/80 bg-background/70 px-3 py-1 text-muted-foreground"
      data-testid="hud-widget-placeholder"
    >
      {placeholderLabel(kind)}
    </Badge>
  );
}

const resolveWidgetOffset = (
  rawOffset: HudWidgetPlacement["offset"] | { readonly x: number; readonly y: number } | null | undefined,
): { readonly x: number; readonly y: number } | undefined => {
  if (rawOffset === undefined || rawOffset === null) {
    return undefined;
  }
  const offset = Option.isOption(rawOffset) ? Option.getOrUndefined(rawOffset) : rawOffset;
  if (offset === undefined || !Number.isFinite(offset.x) || !Number.isFinite(offset.y)) {
    return undefined;
  }
  return offset;
};

const widgetOffsetStyle = (placement: HudWidgetPlacement): CSSProperties | undefined => {
  // `offset` is optional durable data. Older persisted/project layouts and
  // manifest-derived JSON may omit it or still carry plain `{ x, y }` JSON
  // before being rehydrated as an Effect Option.
  const offset = resolveWidgetOffset(placement.offset);
  return offset === undefined
    ? undefined
    : { transform: `translate(${offset.x}px, ${offset.y}px)` };
};

function HudAnchorSlot({
  anchor,
  placements,
  ctx,
  registry,
  editing = false,
  onMoveWidget,
}: {
  readonly anchor: HudAnchor;
  readonly placements: readonly HudWidgetPlacement[];
  readonly ctx: HudWidgetContext;
  readonly registry: Readonly<Record<string, ComponentType<HudWidgetProps>>>;
  readonly editing?: boolean;
  readonly onMoveWidget?: ((widgetId: HudWidgetInstanceId, anchor: HudAnchor) => void) | undefined;
}) {
  if (placements.length === 0 && !editing) {
    return null;
  }
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    const widgetId = event.dataTransfer.getData(HUD_WIDGET_DRAG_MIME);
    if (widgetId === "") {
      return;
    }
    event.preventDefault();
    onMoveWidget?.(widgetId as HudWidgetInstanceId, anchor);
  };
  return (
    <div
      className={cn(
        editing ? HUD_EDIT_ANCHOR_CLASSES[anchor] : HUD_ANCHOR_CLASSES[anchor],
        editing &&
          "pointer-events-auto min-h-12 min-w-24 rounded-lg border border-dashed border-info/50 bg-info/5 p-1",
      )}
      data-hud-anchor={anchor}
      {...(editing
        ? {
            onDragOver: (event: DragEvent<HTMLDivElement>) => event.preventDefault(),
            onDrop: handleDrop,
            "data-hud-drop-zone": anchor,
          }
        : {})}
    >
      {placements.map((placement) => {
        const Widget = registry[placement.kind as string];
        if (Widget === undefined && !editing) {
          return null;
        }
        return (
          <div
            key={placement.id as string}
            className={cn(
              !editing && anchor === "center" ? "absolute inset-0" : undefined,
              editing && "cursor-grab rounded-md ring-1 ring-info/60 active:cursor-grabbing",
            )}
            style={editing ? undefined : widgetOffsetStyle(placement)}
            data-hud-widget-id={placement.id as string}
            data-hud-widget-kind={placement.kind as string}
            {...(editing
              ? {
                  draggable: true,
                  onDragStart: (event: DragEvent<HTMLDivElement>) => {
                    event.dataTransfer.setData(HUD_WIDGET_DRAG_MIME, placement.id as string);
                    event.dataTransfer.effectAllowed = "move";
                  },
                }
              : {})}
          >
            {Widget === undefined ? (
              <HudWidgetPlaceholder kind={placement.kind as string} />
            ) : (
              <Widget ctx={ctx} />
            )}
          </div>
        );
      })}
    </div>
  );
}

const DEFAULT_HUD_LAYOUT = standardHudLayout();

const placementsByAnchor = (
  layout: HudLayout,
): ReadonlyMap<HudAnchor, readonly HudWidgetPlacement[]> => {
  const grouped = new Map<HudAnchor, HudWidgetPlacement[]>();
  for (const placement of layout.widgets) {
    if (!placement.enabled) {
      continue;
    }
    const bucket = grouped.get(placement.anchor);
    if (bucket === undefined) {
      grouped.set(placement.anchor, [placement]);
    } else {
      bucket.push(placement);
    }
  }
  for (const bucket of grouped.values()) {
    bucket.sort((a, b) => a.order - b.order);
  }
  return grouped;
};

/** Derives the per-render widget context shared by every HUD widget. */
export const deriveHudWidgetContext = (metrics: HudMetrics | undefined): HudWidgetContext => {
  const hud = metrics?.hud;
  const aliveCount = metrics?.playerCount ?? 0;
  const totalPlayers = hud?.totalPlayers ?? aliveCount;
  const localPlayer = hud?.localPlayer;
  const scoreboard = hud?.scoreboard ?? [];
  const teamRoster = localPlayer?.team
    ? scoreboard.filter((entry) => entry.team === localPlayer.team)
    : scoreboard.filter((entry) => entry.playerId === localPlayer?.playerId);
  const killFeed = (hud?.recentEvents ?? [])
    .filter((event) => event._tag === "PlayerKilled")
    .slice(-4)
    .reverse();
  return {
    hud,
    tickCount: metrics?.tickCount,
    aliveCount,
    totalPlayers,
    localPlayer,
    scoreboard,
    teamRoster,
    killFeed,
  };
};

export function HudOverlay({
  metrics,
  hudInsets,
  layout = DEFAULT_HUD_LAYOUT,
  editing = false,
  onMoveWidget,
  customWidgets,
}: HudOverlayProps) {
  const insetStyle: CSSProperties | undefined = hudInsets
    ? {
        top: hudInsets.top,
        right: hudInsets.right,
        bottom: hudInsets.bottom,
        left: hudInsets.left,
      }
    : undefined;
  const ctx = deriveHudWidgetContext(metrics);
  const anchored = placementsByAnchor(layout);
  // Baseline spread LAST: engine core.* kinds always win over custom entries.
  const registry = useMemo<Readonly<Record<string, ComponentType<HudWidgetProps>>>>(
    () =>
      customWidgets === undefined || customWidgets.length === 0
        ? HUD_WIDGET_REGISTRY
        : { ...hudWidgetComponents(customWidgets), ...HUD_WIDGET_REGISTRY },
    [customWidgets],
  );

  return (
    <div
      className="pointer-events-none absolute inset-0 z-30"
      data-testid="playtest-hud-overlay"
      aria-hidden={!ctx.hud}
      style={insetStyle}
      data-hud-inset-top={hudInsets?.top}
      data-hud-inset-right={hudInsets?.right}
      data-hud-inset-bottom={hudInsets?.bottom}
      data-hud-inset-left={hudInsets?.left}
      data-hud-layout-id={layout.id as string}
      data-hud-editing={editing || undefined}
    >
      {HUD_ANCHORS.map((anchor) => (
        <HudAnchorSlot
          key={anchor}
          anchor={anchor}
          placements={anchored.get(anchor) ?? []}
          ctx={ctx}
          registry={registry}
          editing={editing}
          onMoveWidget={onMoveWidget}
        />
      ))}
    </div>
  );
}
