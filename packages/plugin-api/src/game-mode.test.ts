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

const contributions = (parts: {
  readonly panels?: readonly unknown[];
  readonly systems?: readonly unknown[];
}): PluginContributions =>
  decodeContributions({
    ...CONTRIBUTIONS_DEFAULTS,
    panels: parts.panels,
    runtime: parts.systems === undefined ? undefined : { ...RUNTIME_DEFAULTS, systems: parts.systems },
  });

const BR_PLUGIN_ID = pluginId("@tileborne-plugins/battle-royale");

// A battle-royale-shaped manifest: declares a runtime system + a settings panel
// in the `plugins` zone (mirrors packages/plugin-battle-royale/tileborne-plugin.json).
const brContributions = contributions({
  panels: [panel({ id: "battle-royale-settings", zone: "plugins", title: "Battle Royale Settings", capabilities: ["settings"] })],
  systems: [runtimeSystem("battle-royale-runtime", "Battle Royale Runtime Adapter")],
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

  it("resolves the active mode by selection, defaulting to the first discovered", () => {
    const modes = discoverGameModes([{ pluginId: BR_PLUGIN_ID, contributions: brContributions }]);
    expect(resolveActiveGameMode(modes)?.pluginId).toBe(BR_PLUGIN_ID);
    expect(resolveActiveGameMode(modes, modes[0]?.modeId)?.pluginId).toBe(BR_PLUGIN_ID);
    // Unknown selection falls back to the first discovered mode.
    const unknown = Schema.decodeUnknownSync(GameModeId)("@tileborne-plugins/missing");
    expect(resolveActiveGameMode(modes, unknown)?.pluginId).toBe(BR_PLUGIN_ID);
    expect(resolveActiveGameMode([])).toBeUndefined();
  });
});
