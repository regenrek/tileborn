import { describe, expect, it } from "vitest";

import { makeProjectManifest } from "../project/index.js";
import { makeMapId, makeProjectId } from "../ids.js";
import { makeTileborneMap } from "../map/index.js";
import {
  readPluginMapSettings,
  readPluginProjectSettings,
  readPluginSettingsNamespace,
  writePluginMapSettings,
  writePluginProjectSettings,
} from "./plugin-settings.js";

const uuid = (suffix: string) => `550e8400-e29b-41d4-a716-${suffix}`;
const PLUGIN_ID = "@example/mode";
const OTHER_PLUGIN_ID = "@example/other-mode";

describe("plugin settings namespace (map.properties.<pluginId>)", () => {
  it("returns an empty object when the namespace is absent", () => {
    expect(readPluginSettingsNamespace({}, PLUGIN_ID)).toEqual({});
    expect(readPluginSettingsNamespace(undefined, PLUGIN_ID)).toEqual({});
    expect(readPluginSettingsNamespace({ [PLUGIN_ID]: 7 }, PLUGIN_ID)).toEqual({});
  });

  it("persists + reads map settings under the pluginId namespace", () => {
    const map = makeTileborneMap({
      id: makeMapId(uuid("446655440010")),
      width: 16,
      height: 16,
      tileWidth: 32,
      tileHeight: 32,
      properties: {},
    });

    const next = writePluginMapSettings(map, PLUGIN_ID, { scoreLimit: 12, timeLimit: 15 });

    expect(next.properties[PLUGIN_ID]).toEqual({ scoreLimit: 12, timeLimit: 15 });
    expect(readPluginMapSettings(next, PLUGIN_ID)).toEqual({ scoreLimit: 12, timeLimit: 15 });
  });

  it("keys settings by pluginId and preserves other plugins' namespaces", () => {
    const map = makeTileborneMap({
      id: makeMapId(uuid("446655440011")),
      width: 16,
      height: 16,
      tileWidth: 32,
      tileHeight: 32,
      properties: { [OTHER_PLUGIN_ID]: { foo: 1 }, unrelated: true },
    });

    const next = writePluginMapSettings(map, PLUGIN_ID, { scoreLimit: 4 });

    expect(next.properties[PLUGIN_ID]).toEqual({ scoreLimit: 4 });
    expect(next.properties[OTHER_PLUGIN_ID]).toEqual({ foo: 1 });
    expect(next.properties.unrelated).toBe(true);
  });

  it("persists + reads project settings under the pluginId namespace", () => {
    const project = makeProjectManifest({
      id: makeProjectId(uuid("446655440012")),
      name: "Demo",
    });

    const next = writePluginProjectSettings(project, PLUGIN_ID, { roster: ["a", "b"] });

    expect(readPluginProjectSettings(next, PLUGIN_ID)).toEqual({ roster: ["a", "b"] });
  });
});
