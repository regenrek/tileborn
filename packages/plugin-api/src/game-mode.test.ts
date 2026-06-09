import { GameModeId, PluginId } from "@tileborne/core";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { PluginContributions } from "./contributions.js";
import { describeGameMode, discoverGameModes, resolveActiveGameMode } from "./game-mode.js";

const pluginId = (value: string): PluginId => Schema.decodeUnknownSync(PluginId)(value);

const decodeContributions = (input: unknown): PluginContributions =>
  Schema.decodeUnknownSync(PluginContributions)(input);

// `decodeUnknownSync(PluginContributions)` is strict: every `OptionFromUndefinedOr`
// key must be present (value may be `undefined`). The defaults below fill the
// full shape so tests can override only the fields under test, mirroring the
// decoded `PluginContributions` the loader/handler pass to discovery at runtime.
const PANEL_DEFAULTS = {
  description: undefined,
  group: undefined,
  order: undefined,
  capabilities: undefined,
  data: undefined,
} as const;

const RUNTIME_DEFAULTS = {
  systems: undefined,
  components: undefined,
  events: undefined,
  assetLoaders: undefined,
  clientSystems: undefined,
  hudWidgets: undefined,
  hudLayouts: undefined,
  lobbyPanels: undefined,
  menuSections: undefined,
  inputMaps: undefined,
  audioBuses: undefined,
  cameras: undefined,
  interpolators: undefined,
  assetPacks: undefined,
  errorMappers: undefined,
  gameObjectCatalogs: undefined,
  weaponCatalogs: undefined,
} as const;

const EDITOR_DEFAULTS = {
  tabs: undefined,
  tools: undefined,
  inspectors: undefined,
  commands: undefined,
  menus: undefined,
  settings: undefined,
  paletteCategories: undefined,
  paletteSubFilters: undefined,
  paletteItemActions: undefined,
  viewportActions: undefined,
  toolDock: undefined,
  overlays: undefined,
  inspectorPanels: undefined,
  settingsPanels: undefined,
  mapKinds: undefined,
  presets: undefined,
  panels: undefined,
  validators: undefined,
  exporters: undefined,
  generators: undefined,
  assetMetadata: undefined,
  playerModelPolicies: undefined,
  gameSettingsForms: undefined,
} as const;

const CONTRIBUTIONS_DEFAULTS = {
  panels: undefined,
  tools: undefined,
  assetPacks: undefined,
  tilesetPacks: undefined,
  editor: undefined,
  runtime: undefined,
  server: undefined,
} as const;

const display = (label: string) => ({ label, description: undefined, icon: undefined, order: undefined });

const panel = (input: {
  readonly id: string;
  readonly zone: string;
  readonly title: string;
  readonly capabilities?: readonly string[];
}) => ({ ...PANEL_DEFAULTS, id: input.id, zone: input.zone, title: input.title, capabilities: input.capabilities });

const runtimeSystem = (id: string, label: string) => ({
  _tag: "ExecutableRuntimeSystemContribution" as const,
  id,
  kind: "executable" as const,
  display: display(label),
  entry: "./dist/runtime.js",
});

const gameSettingsForm = (id: string) => ({
  _tag: "DeclarativeEditorGameSettingsFormContribution" as const,
  id,
  kind: "declarative" as const,
  display: display("Mode Settings"),
  data: {
    scope: "map",
    invalidMessage: "Settings must be valid.",
    fields: [{ key: "maxPlayers", label: "Max players", min: 1, step: 1, default: 32 }],
  },
});

const hudLayoutContribution = (id: string) => ({
  _tag: "DeclarativeRuntimeHudLayoutContribution" as const,
  id,
  kind: "declarative" as const,
  display: display("Mode HUD"),
  data: {
    id: "mode-default-hud",
    widgets: [
      { id: "minimap", kind: "core.Minimap", anchor: "top-right", order: 0, enabled: true },
      { id: "weapon-panel", kind: "core.WeaponPanel", anchor: "bottom-center", order: 0, enabled: true },
    ],
  },
});

const contributions = (parts: {
  readonly panels?: readonly unknown[];
  readonly systems?: readonly unknown[];
  readonly gameSettingsForms?: readonly unknown[];
  readonly hudLayouts?: readonly unknown[];
}): PluginContributions =>
  decodeContributions({
    ...CONTRIBUTIONS_DEFAULTS,
    panels: parts.panels,
    editor:
      parts.gameSettingsForms === undefined
        ? undefined
        : { ...EDITOR_DEFAULTS, gameSettingsForms: parts.gameSettingsForms },
    runtime:
      parts.systems === undefined && parts.hudLayouts === undefined
        ? undefined
        : { ...RUNTIME_DEFAULTS, systems: parts.systems, hudLayouts: parts.hudLayouts },
  });

const BR_PLUGIN_ID = pluginId("@tileborne-plugins/battle-royale");

// A battle-royale-shaped manifest: declares a runtime system + a settings panel
// in the `plugins` zone (mirrors packages/plugin-battle-royale/tileborne-plugin.json).
const brContributions = contributions({
  panels: [panel({ id: "battle-royale-settings", zone: "plugins", title: "Battle Royale Settings", capabilities: ["settings"] })],
  systems: [runtimeSystem("battle-royale-runtime", "Battle Royale Runtime Adapter")],
  gameSettingsForms: [gameSettingsForm("battle-royale-settings-form")],
});

describe("game-mode discovery", () => {
  it("discovers battle royale as a game mode with its authoring panel", () => {
    const descriptor = describeGameMode({ pluginId: BR_PLUGIN_ID, contributions: brContributions });
    expect(descriptor).toBeDefined();
    expect(descriptor?.modeId).toBe("@tileborne-plugins/battle-royale");
    expect(descriptor?.pluginId).toBe(BR_PLUGIN_ID);
    expect(descriptor?.runtimeSystemId).toBe("battle-royale-runtime");
    expect(descriptor?.hasAuthoringPanel).toBe(true);
    expect(descriptor?.authoringSettingsPanelId).toBe("battle-royale-settings");
    expect(descriptor?.gameSettingsFormId).toBe("battle-royale-settings-form");
    expect(descriptor?.gameSettingsForm?.fields.map((field) => field.key)).toEqual(["maxPlayers"]);
    expect(descriptor?.label).toBe("Battle Royale Settings");
  });

  it("does not treat a plugin without a runtime system as a game mode", () => {
    const editorOnly = contributions({
      panels: [panel({ id: "some-panel", zone: "plugins", title: "Some Panel", capabilities: ["settings"] })],
    });
    expect(
      describeGameMode({ pluginId: pluginId("@tileborne-plugins/editor-only"), contributions: editorOnly }),
    ).toBeUndefined();
  });

  it("discovers a mode with a runtime system but no settings panel", () => {
    const noPanel = contributions({ systems: [runtimeSystem("shooter-runtime", "Top-Down Shooter")] });
    const descriptor = describeGameMode({
      pluginId: pluginId("@tileborne-plugins/top-down-shooter"),
      contributions: noPanel,
    });
    expect(descriptor?.hasAuthoringPanel).toBe(false);
    expect(descriptor?.authoringSettingsPanelId).toBeUndefined();
    expect(descriptor?.label).toBe("Top-Down Shooter");
  });

  it("discovers a first-class settings form without reading panel data", () => {
    const formOnly = contributions({
      systems: [runtimeSystem("arena-runtime", "Arena Runtime")],
      gameSettingsForms: [gameSettingsForm("arena-settings-form")],
    });
    const descriptor = describeGameMode({
      pluginId: pluginId("@tileborne-plugins/example-arena"),
      contributions: formOnly,
    });
    expect(descriptor?.hasAuthoringPanel).toBe(true);
    expect(descriptor?.authoringSettingsPanelId).toBeUndefined();
    expect(descriptor?.gameSettingsFormId).toBe("arena-settings-form");
    expect(descriptor?.gameSettingsForm?.fields[0]?.label).toBe("Max players");
  });

  it("discovers the mode's default HUD layout from the runtime.hudLayouts slot", () => {
    const withHud = contributions({
      systems: [runtimeSystem("br-runtime", "BR")],
      hudLayouts: [hudLayoutContribution("br-hud-layout")],
    });
    const descriptor = describeGameMode({ pluginId: BR_PLUGIN_ID, contributions: withHud });
    expect(descriptor?.hudLayoutContributionId).toBe("br-hud-layout");
    expect(descriptor?.hudLayout?.id).toBe("mode-default-hud");
    expect(descriptor?.hudLayout?.widgets.map((widget) => widget.kind as string)).toEqual([
      "core.Minimap",
      "core.WeaponPanel",
    ]);
  });

  it("leaves hudLayout undefined when no hudLayouts contribution is declared", () => {
    const descriptor = describeGameMode({ pluginId: BR_PLUGIN_ID, contributions: brContributions });
    expect(descriptor?.hudLayoutContributionId).toBeUndefined();
    expect(descriptor?.hudLayout).toBeUndefined();
  });

  it("ignores a settings panel outside the plugins zone", () => {
    const projectScoped = contributions({
      panels: [panel({ id: "match-rules", zone: "project", title: "Match Rules", capabilities: ["settings"] })],
      systems: [runtimeSystem("br-runtime", "BR")],
    });
    const descriptor = describeGameMode({ pluginId: BR_PLUGIN_ID, contributions: projectScoped });
    expect(descriptor?.hasAuthoringPanel).toBe(false);
  });

  it("discovers only the plugins that provide modes", () => {
    const editorOnly = contributions({ panels: [panel({ id: "p", zone: "project", title: "Project Panel" })] });
    const modes = discoverGameModes([
      { pluginId: pluginId("@tileborne-plugins/editor-only"), contributions: editorOnly },
      { pluginId: BR_PLUGIN_ID, contributions: brContributions },
    ]);
    expect(modes).toHaveLength(1);
    expect(modes[0]?.pluginId).toBe(BR_PLUGIN_ID);
  });

  it("resolves the active mode only when selection is unambiguous", () => {
    const arenaPluginId = pluginId("@tileborne-plugins/example-arena");
    const modes = discoverGameModes([
      { pluginId: BR_PLUGIN_ID, contributions: brContributions },
      {
        pluginId: arenaPluginId,
        contributions: contributions({
          systems: [runtimeSystem("arena-runtime", "Example Arena")],
        }),
      },
    ]);
    const singleMode = discoverGameModes([{ pluginId: BR_PLUGIN_ID, contributions: brContributions }]);

    expect(resolveActiveGameMode(singleMode)?.pluginId).toBe(BR_PLUGIN_ID);
    expect(resolveActiveGameMode(modes)).toBeUndefined();
    expect(resolveActiveGameMode(modes, modes[0]?.modeId)?.pluginId).toBe(BR_PLUGIN_ID);
    expect(resolveActiveGameMode(modes, modes[1]?.modeId)?.pluginId).toBe(arenaPluginId);
    const unknown = Schema.decodeUnknownSync(GameModeId)("@tileborne-plugins/missing");
    expect(resolveActiveGameMode(modes, unknown)).toBeUndefined();
    expect(resolveActiveGameMode([])).toBeUndefined();
  });
});
