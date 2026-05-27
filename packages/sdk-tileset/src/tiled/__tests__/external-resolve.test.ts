import { describe, expect, it } from "vitest";

import { isPathInsideFolder, resolveExternalPath } from "../external-resolve.js";

describe("isPathInsideFolder", () => {
  it("rejects prefix-substring roots that do not end on a path separator", () => {
    expect(isPathInsideFolder("/work/proj", "/work/projectile.ldtkl")).toBe(false);
  });

  it("rejects relative candidates", () => {
    expect(isPathInsideFolder("/work/proj", "../outside.ldtkl")).toBe(false);
  });

  it("rejects traversal-bearing absolute candidates after normalization", () => {
    expect(isPathInsideFolder("/work/proj", "/work/proj/../outside.ldtkl")).toBe(false);
  });

  it("accepts normalized absolute paths inside the folder", () => {
    expect(isPathInsideFolder("/work/proj", "/work/proj/./inside.ldtkl")).toBe(true);
  });

  it("rejects non-absolute root", () => {
    expect(isPathInsideFolder("relative", "/work/proj/inside.ldtkl")).toBe(false);
  });

  it("rejects non-absolute candidate", () => {
    expect(isPathInsideFolder("/work/proj", "relative")).toBe(false);
  });

  it("allows equality when candidate equals root", () => {
    expect(isPathInsideFolder("/work/proj", "/work/proj")).toBe(true);
  });
});

describe("resolveExternalPath", () => {
  it("anchors an empty project root to cwd and still blocks escapes", async () => {
    const result = await resolveExternalPath({
      projectRoot: "",
      basePath: "maps/test.tmj",
      source: "tilesets/terrain.tsx",
      realpath: async () => "/outside/terrain.tsx",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic._tag).toBe("TiledExternalRefBlocked");
      expect(result.diagnostic.resolvedPath).toBe("/outside/terrain.tsx");
    }
  });

  it("anchors a relative project root before containment checks", async () => {
    const result = await resolveExternalPath({
      projectRoot: ".",
      basePath: "maps/test.tmj",
      source: "../outside.tsx",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic._tag).toBe("TiledExternalRefBlocked");
    }
  });

  it("rejects prefix-substring roots after realpath resolution", async () => {
    const result = await resolveExternalPath({
      projectRoot: "/work/proj",
      basePath: "/work/proj/maps/test.tmj",
      source: "tilesets/terrain.tsx",
      realpath: async () => "/work/projectile.tsx",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic._tag).toBe("TiledExternalRefBlocked");
      expect(result.diagnostic.resolvedPath).toBe("/work/projectile.tsx");
    }
  });

  it("rejects realpath escapes outside the project root", async () => {
    const projectRoot = "/tmp/tiled-project";
    const result = await resolveExternalPath({
      projectRoot,
      basePath: `${projectRoot}/maps/test.tmj`,
      source: "tilesets/linked.tsx",
      realpath: async (absolutePath) =>
        absolutePath.endsWith("linked.tsx") ? "/outside/linked.tsx" : absolutePath,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic._tag).toBe("TiledExternalRefBlocked");
      expect(result.diagnostic.resolvedPath).toBe("/outside/linked.tsx");
    }
  });
});
