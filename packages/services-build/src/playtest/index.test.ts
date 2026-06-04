import { PluginId } from "@tileborne/core";
import { PluginContributions } from "@tileborne/plugin-api";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  activePlaytestPluginIds,
  BATTLE_ROYALE_PLUGIN_ID,
  type PlaytestModeCandidate,
} from "./index.js";

const pluginId = (value: string): PluginId => Schema.decodeUnknownSync(PluginId)(value);

// `decodeUnknownSync(PluginContributions)` is strict: every `OptionFromUndefinedOr`
// key must be present (value may be `undefined`). These defaults fill the full
// shape so each candidate overrides only the fields under test, mirroring the
// decoded contributions the plugin registry hands the playtest selector.
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

const runtimeSystem = (id: string, label: string) => ({
  _tag: "ExecutableRuntimeSystemContribution" as const,
  id,
  kind: "executable" as const,
  display: { label, description: undefined, icon: undefined, order: undefined },
  entry: "./dist/runtime.js",
});

const withRuntimeSystem = (id: string, label: string): PluginContributions =>
  Schema.decodeUnknownSync(PluginContributions)({
    ...CONTRIBUTIONS_DEFAULTS,
    runtime: { ...RUNTIME_DEFAULTS, systems: [runtimeSystem(id, label)] },
  });

// An editor-only plugin (no runtime system) is NOT a game mode.
const editorOnly = (): PluginContributions =>
  Schema.decodeUnknownSync(PluginContributions)({ ...CONTRIBUTIONS_DEFAULTS });

const candidate = (
  id: string,
  enabled: boolean,
  contributions: PluginContributions,
): PlaytestModeCandidate => ({ pluginId: pluginId(id), enabled, contributions });

describe("playtest manifest-driven mode selection", () => {
  it("activates an enabled non-battle-royale plugin that declares a runtime system", () => {
    expect(
      activePlaytestPluginIds([
        candidate("@tileborne-plugins/top-down-shooter", true, withRuntimeSystem("shooter-runtime", "Top-Down Shooter")),
      ]),
    ).toEqual(["@tileborne-plugins/top-down-shooter"]);
  });

  it("still activates battle royale because it declares a runtime system", () => {
    expect(
      activePlaytestPluginIds([
        candidate(BATTLE_ROYALE_PLUGIN_ID, true, withRuntimeSystem("battle-royale-runtime", "Battle Royale Runtime Adapter")),
      ]),
    ).toEqual([BATTLE_ROYALE_PLUGIN_ID]);
  });

  it("ignores disabled plugins and plugins without a runtime system", () => {
    expect(
      activePlaytestPluginIds([
        candidate("@tileborne-plugins/editor-only", true, editorOnly()),
        candidate("@tileborne-plugins/disabled-mode", false, withRuntimeSystem("disabled-runtime", "Disabled")),
        candidate("@tileborne-plugins/top-down-shooter", true, withRuntimeSystem("shooter-runtime", "Top-Down Shooter")),
      ]),
    ).toEqual(["@tileborne-plugins/top-down-shooter"]);
  });

  it("selects no plugin when none declares a runtime system", () => {
    expect(
      activePlaytestPluginIds([candidate("@tileborne-plugins/editor-only", true, editorOnly())]),
    ).toEqual([]);
  });
});
