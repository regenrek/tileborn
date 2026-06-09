/**
 * `@tileborne/game-client` — the browser game-client UI shell + generic menu
 * framework + baseline menu (ADR-0022). Brand- and plugin-neutral; products
 * overlay branding via `BrandConfig` and plugins contribute menu sections via
 * `RuntimeMenuSectionContribution`. `@tileborne/runtime` stays React-free; this
 * package is the React home for the shipped game client.
 */

// State machine (pure)
export {
  canPause,
  initialMenuState,
  menuReducer,
  SETTINGS_TABS,
  type MenuError,
  type MenuEvent,
  type MenuPhase,
  type MenuScreen,
  type MenuState,
  type SettingsTab,
} from "./state/menu-machine.js";
export { useMenuMachine, type MenuMachine } from "./state/use-menu-machine.js";

// Contribution registry
export {
  findDuplicateSectionIds,
  sectionsForSlot,
  type MenuSectionProps,
  type MenuSectionRegistration,
} from "./contributions/menu-registry.js";

// Theming
export { brandThemeVars, type BrandThemeVars } from "./theming/brand-theme.js";
export { defaultBrandConfig } from "./config/default-brand.js";

// Components
export { RuntimeRoot, type RuntimeRootProps } from "./components/runtime-root.js";
export { MenuShell, type MenuShellProps } from "./components/menu-shell.js";
export { MainMenu, type MainMenuProps } from "./components/main-menu.js";
export { SettingsDialog, type SettingsDialogProps } from "./components/settings-dialog.js";
export { ControlsTab, type ControlsTabConfig } from "./components/controls-tab.js";

// Input remap (Controls tab) model + persistence (ADR-0024)
export {
  USER_INPUT_OVERLAY_STORAGE_KEY,
  USER_OVERLAY_BINDING_SET_ID,
  createLocalStorageBindingsStore,
  effectiveBindingsForAction,
  rebindActionTrigger,
  resetActionInScheme,
  triggerLabel,
  type UserInputBindingsStore,
} from "./input/user-bindings.js";
export { PauseOverlay, type PauseOverlayProps } from "./components/pause-overlay.js";
export {
  ResultsScreen,
  type MatchResultRow,
  type MatchResults,
  type ResultsScreenProps,
} from "./components/results-screen.js";
export { BootSplash, type BootSplashProps } from "./components/boot-splash.js";
export { ErrorPanel, type ErrorPanelProps } from "./components/error-panel.js";
export { SlotHost, type SlotHostProps } from "./components/slot-host.js";

// HUD chassis (layout-driven; HudLayout DATA comes from plugins/projects/users)
export {
  deriveHudWidgetContext,
  HudOverlay,
  type HudInsets,
  type HudOverlayProps,
  type HudWidgetContext,
  type HudWidgetProps,
} from "./hud/hud-overlay.js";
export {
  eventKey,
  formatAlivePlayersLabel,
  formatZoneStatusLabel,
  healthPercent,
  type HudEvent,
  type HudMetrics,
  type HudState,
} from "./hud/hud-state.js";
export {
  findInvalidHudWidgetRegistrations,
  hudWidgetComponents,
  type HudWidgetRegistration,
} from "./hud/hud-widget-registry.js";
