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

describe("resolveBattleRoyalePluginPath", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mocked(accessSync).mockReset();
  });

  it("returns the workspace plugin root when tileborne-plugin.json exists", async () => {
    const { packagedPluginRoot, resolveBattleRoyalePluginPath, workspacePluginRoot } = await import(
      "./battle-royale-path.js"
    );
    vi.mocked(accessSync).mockImplementation((candidatePath) => {
      if (String(candidatePath).startsWith(packagedPluginRoot)) {
        throw new Error("ENOENT");
      }
      return undefined;
    });

    expect(resolveBattleRoyalePluginPath()).toBe(workspacePluginRoot);
    expect(accessSync).toHaveBeenCalledWith(
      expect.stringMatching(/bundled-plugins\/battle-royale\/tileborne-plugin\.json$/),
    );
    expect(accessSync).toHaveBeenCalledWith(
      expect.stringMatching(/packages\/plugin-battle-royale\/tileborne-plugin\.json$/),
    );
  });

  it("returns the packaged plugin root when bundled plugin manifest exists", async () => {
    vi.mocked(accessSync).mockImplementation(() => undefined);

    const { packagedPluginRoot, resolveBattleRoyalePluginPath } = await import(
      "./battle-royale-path.js"
    );

    expect(resolveBattleRoyalePluginPath()).toBe(packagedPluginRoot);
    expect(accessSync).toHaveBeenCalledTimes(1);
  });

  it("throws when packaged and workspace plugin manifests are missing", async () => {
    vi.mocked(accessSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const { packagedPluginRoot, resolveBattleRoyalePluginPath, workspacePluginRoot } = await import(
      "./battle-royale-path.js"
    );

    expect(() => resolveBattleRoyalePluginPath()).toThrow(
      `Battle Royale plugin not found. Checked packaged plugin ${packagedPluginRoot} and workspace plugin ${workspacePluginRoot}. Build the plugin package before desktop packaging.`,
    );
  });
});
