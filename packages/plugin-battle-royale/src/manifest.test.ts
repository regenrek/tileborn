import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PluginManifest } from "@tileborne/plugin-api";
import { materializePluginManifestInput } from "../../services-plugin/src/filesystem.js";
import { Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { PLUGIN_ID } from "./constants.js";

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(packageRoot, "tileborne-plugin.json");

describe("tileborne-plugin.json", () => {
  it("decodes against the canonical PluginManifest schema", async () => {
    const raw = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
    const manifest = Schema.decodeUnknownSync(PluginManifest)(materializePluginManifestInput(raw));
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.id).toBe(PLUGIN_ID);
    expect(manifest.version).toBe("0.1.0");
  });

  it("declares runtime, map, and asset capabilities", async () => {
    const raw = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
    const manifest = Schema.decodeUnknownSync(PluginManifest)(materializePluginManifestInput(raw));
    const runtimeEntry = Option.flatMap(manifest.entry, (entry) => entry.runtime);
    const serverEntry = Option.flatMap(manifest.entry, (entry) => entry.server);
    expect(Option.getOrUndefined(runtimeEntry)).toBe("./dist/runtime.js");
    expect(Option.getOrUndefined(serverEntry)).toBe("./dist/server.js");

    const editor = Option.getOrUndefined(manifest.contributes.editor);
    const panels = Option.getOrElse(manifest.contributes.panels, () => []);
    const tools = Option.getOrElse(manifest.contributes.tools, () => []);
    expect(panels.map((panel) => panel.zone)).toEqual(["plugins", "project"]);
    expect(tools.map((tool) => tool.zone)).toEqual(["working-palette"]);

    const battleRoyaleSettings = panels.find((panel) => panel.id === "battle-royale-settings");
    expect(battleRoyaleSettings?.title).toBe("Battle Royale Settings");

    expect(editor).toBeDefined();
    if (editor) {
      expect(Option.getOrElse(editor.gameSettingsForms, () => [])).toHaveLength(1);
      expect(Option.getOrElse(editor.generators, () => [])).toHaveLength(1);
      expect(Option.getOrElse(editor.validators, () => []).length).toBeGreaterThan(0);
      expect(Option.getOrElse(editor.assetMetadata, () => [])).toHaveLength(1);
    }

    const runtime = Option.getOrUndefined(manifest.contributes.runtime);
    expect(runtime).toBeDefined();
    if (runtime) {
      expect(Option.getOrElse(runtime.systems, () => [])).toHaveLength(1);
    }
  });
});
