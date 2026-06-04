// @vitest-environment node

import { accessSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    accessSync: vi.fn(actual.accessSync),
  };
});

describe("bundled-plugins", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mocked(accessSync).mockReset();
  });

  it("lists BOTH bundled example plugins (battle royale + example arena)", async () => {
    const { BUNDLED_PLUGINS } = await import("./bundled-plugins.js");
    const ids = BUNDLED_PLUGINS.map((spec) => spec.id);
    expect(ids).toContain("@tileborne-plugins/battle-royale");
    expect(ids).toContain("@tileborne-plugins/example-arena");
    expect(ids).toHaveLength(2);
  });

  it("resolves the workspace plugin root when tileborne-plugin.json exists there", async () => {
    const { BUNDLED_PLUGINS, packagedBundledPluginRoot, resolveBundledPluginPath, workspaceBundledPluginRoot } =
      await import("./bundled-plugins.js");
    const spec = BUNDLED_PLUGINS[0]!;
    vi.mocked(accessSync).mockImplementation((candidatePath) => {
      if (String(candidatePath).startsWith(packagedBundledPluginRoot(spec))) {
        throw new Error("ENOENT");
      }
      return undefined;
    });

    expect(resolveBundledPluginPath(spec)).toBe(workspaceBundledPluginRoot(spec));
  });

  it("prefers the packaged plugin root when its manifest exists", async () => {
    vi.mocked(accessSync).mockImplementation(() => undefined);
    const { BUNDLED_PLUGINS, packagedBundledPluginRoot, resolveBundledPluginPath } = await import(
      "./bundled-plugins.js"
    );
    const spec = BUNDLED_PLUGINS[1]!;
    expect(resolveBundledPluginPath(spec)).toBe(packagedBundledPluginRoot(spec));
    expect(accessSync).toHaveBeenCalledTimes(1);
  });

  it("throws when neither packaged nor workspace manifest is present", async () => {
    vi.mocked(accessSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const { BUNDLED_PLUGINS, resolveBundledPluginPath } = await import("./bundled-plugins.js");
    const spec = BUNDLED_PLUGINS[1]!;
    expect(() => resolveBundledPluginPath(spec)).toThrow(/not found/);
  });

  it("looks up a bundled spec by id", async () => {
    const { bundledPluginSpec } = await import("./bundled-plugins.js");
    expect(bundledPluginSpec("@tileborne-plugins/example-arena")?.workspacePackageDir).toBe(
      "plugin-example-arena",
    );
    expect(bundledPluginSpec("@tileborne-plugins/missing")).toBeUndefined();
  });
});
