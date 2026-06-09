import { Schema } from "effect";

/**
 * Neutral, designable in-match HUD layout (sibling of the ADR-0024 `InputMap`
 * model).
 *
 * The engine owns the layout SHAPE (this schema) and the anchor vocabulary;
 * a game-mode plugin contributes its default HUD arrangement as DATA (via the
 * `RuntimeHudLayout` contribution slot in `@tileborne/plugin-api`), and a user
 * overlay of the same shape is applied on top at resolve time
 * (`resolveEffectiveHudLayout`). The rendering shell maps widget KINDS to
 * components and renders placements generically — it never hardcodes which
 * widgets exist, where they sit, or how many there are.
 */

/** Durable identity of a saved HUD layout (a plugin default or a user overlay). */
export const HudLayoutId = Schema.String.pipe(Schema.brand("HudLayoutId"));
export type HudLayoutId = typeof HudLayoutId.Type;

export const makeHudLayoutId = (id: string): HudLayoutId =>
  Schema.decodeUnknownSync(HudLayoutId)(id);

/**
 * Identity of one placed widget INSTANCE inside a layout. Instance-scoped (not
 * kind-scoped) so a layout may place the same widget kind more than once and a
 * user overlay can address exactly one placement.
 */
export const HudWidgetInstanceId = Schema.String.pipe(Schema.brand("HudWidgetInstanceId"));
export type HudWidgetInstanceId = typeof HudWidgetInstanceId.Type;

export const makeHudWidgetInstanceId = (id: string): HudWidgetInstanceId =>
  Schema.decodeUnknownSync(HudWidgetInstanceId)(id);

/**
 * Neutral, OPEN widget kind identifier — mirrors `ActionId` (ADR-0024): the
 * engine ships a baseline vocabulary ({@link CORE_HUD_WIDGETS}); a plugin may
 * reference those and/or declare its own (`"myMode.ManaBar"`) with zero engine
 * edits. Renderers skip kinds they do not know.
 */
export const HudWidgetKind = Schema.String.pipe(Schema.brand("HudWidgetKind"));
export type HudWidgetKind = typeof HudWidgetKind.Type;

export const makeHudWidgetKind = (kind: string): HudWidgetKind =>
  Schema.decodeUnknownSync(HudWidgetKind)(kind);

/**
 * The nine named anchor regions of the HUD viewport. Widgets stack inside an
 * anchor in ascending {@link HudWidgetPlacement.order}; `center` layers its
 * widgets (each centered) instead of stacking, so crosshair-like indicators
 * stay exactly centered.
 */
export const HudAnchor = Schema.Literals([
  "top-left",
  "top-center",
  "top-right",
  "center-left",
  "center",
  "center-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
]);
export type HudAnchor = typeof HudAnchor.Type;

/** Optional pixel offset applied to one placement relative to its anchor slot. */
export class HudWidgetOffset extends Schema.Class<HudWidgetOffset>("HudWidgetOffset")({
  x: Schema.Number,
  y: Schema.Number,
}) {}

/**
 * One widget instance placed in the HUD. The full designable surface per
 * widget: which kind, which anchor, stacking order, visibility, and an
 * optional pixel offset.
 */
export class HudWidgetPlacement extends Schema.Class<HudWidgetPlacement>("HudWidgetPlacement")({
  id: HudWidgetInstanceId,
  kind: HudWidgetKind,
  anchor: HudAnchor,
  /** Sort order within the anchor stack (ascending). */
  order: Schema.Int,
  enabled: Schema.Boolean,
  offset: Schema.OptionFromOptional(HudWidgetOffset),
}) {}

/**
 * A durable HUD layout: an ordered set of widget placements. A plugin
 * contributes one as its default HUD; a user overlay is the same shape,
 * merged per widget-instance id on top at resolve time.
 */
export class HudLayout extends Schema.Class<HudLayout>("HudLayout")({
  id: HudLayoutId,
  widgets: Schema.Array(HudWidgetPlacement),
}) {}

/**
 * Engine-shipped baseline widget kinds (constants, NOT a closed `Schema` union
 * — mirrors `CORE_ACTIONS`). The `core.` prefix marks the engine baseline;
 * plugins may use these and/or their own namespaced kinds.
 */
export const CORE_HUD_WIDGETS = {
  /** Local player card: name, health bar, shield/armor, status effects, cooldowns. */
  LocalPlayerStatus: "core.LocalPlayerStatus",
  /** Teammate roster (or solo self-row). */
  TeamRoster: "core.TeamRoster",
  /** Alive / total players counter. */
  AliveCount: "core.AliveCount",
  /** Minimap with zone, players, and objects. */
  Minimap: "core.Minimap",
  /** Match scoreboard (top entries). */
  Scoreboard: "core.Scoreboard",
  /** Zone phase / countdown status. */
  ZoneStatus: "core.ZoneStatus",
  /** Contextual pickup prompt. */
  PickupPrompt: "core.PickupPrompt",
  /** Equipped weapon, ammo, reload progress, and inventory slots. */
  WeaponPanel: "core.WeaponPanel",
  /** Recent eliminations feed. */
  KillFeed: "core.KillFeed",
  /** Transient event toasts (eliminations, pickups). */
  EventToast: "core.EventToast",
  /** Directional incoming-damage indicator. */
  DamageIndicator: "core.DamageIndicator",
} as const;

/** All baseline widget kind strings (for iteration / validation). */
export const CORE_HUD_WIDGET_KINDS: readonly string[] = Object.values(CORE_HUD_WIDGETS);

/** Brand a {@link CORE_HUD_WIDGETS} value as a {@link HudWidgetKind}. */
export const coreHudWidgetKind = (
  kind: (typeof CORE_HUD_WIDGETS)[keyof typeof CORE_HUD_WIDGETS],
): HudWidgetKind => kind as string as HudWidgetKind;

const STANDARD_HUD_LAYOUT_DATA = {
  id: "core-standard-hud",
  widgets: [
    { id: "local-player", kind: CORE_HUD_WIDGETS.LocalPlayerStatus, anchor: "top-left", order: 0, enabled: true },
    { id: "team-roster", kind: CORE_HUD_WIDGETS.TeamRoster, anchor: "top-left", order: 1, enabled: true },
    { id: "alive-count", kind: CORE_HUD_WIDGETS.AliveCount, anchor: "top-right", order: 0, enabled: true },
    { id: "minimap", kind: CORE_HUD_WIDGETS.Minimap, anchor: "top-right", order: 1, enabled: true },
    { id: "scoreboard", kind: CORE_HUD_WIDGETS.Scoreboard, anchor: "top-right", order: 2, enabled: true },
    { id: "zone-status", kind: CORE_HUD_WIDGETS.ZoneStatus, anchor: "bottom-center", order: 0, enabled: true },
    { id: "pickup-prompt", kind: CORE_HUD_WIDGETS.PickupPrompt, anchor: "bottom-center", order: 1, enabled: true },
    { id: "weapon-panel", kind: CORE_HUD_WIDGETS.WeaponPanel, anchor: "bottom-center", order: 2, enabled: true },
    { id: "kill-feed", kind: CORE_HUD_WIDGETS.KillFeed, anchor: "bottom-left", order: 0, enabled: true },
    { id: "event-toast", kind: CORE_HUD_WIDGETS.EventToast, anchor: "center", order: 0, enabled: true },
    { id: "damage-indicator", kind: CORE_HUD_WIDGETS.DamageIndicator, anchor: "center", order: 1, enabled: true },
  ],
} as const;

/**
 * The engine's neutral baseline arrangement of the {@link CORE_HUD_WIDGETS}.
 * Used as the fallback for modes that do not contribute their own layout;
 * widgets only render when the underlying HUD state exists, so a sparse mode
 * simply shows fewer widgets.
 */
export const standardHudLayout = (): HudLayout =>
  Schema.decodeUnknownSync(HudLayout)(STANDARD_HUD_LAYOUT_DATA);
