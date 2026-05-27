import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const docsAppRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const readManifest = () => {
  const manifestPath = path.join(docsAppRoot, "src/generated/page-manifest.json");
  const raw = fs.readFileSync(manifestPath, "utf8");
  return JSON.parse(raw) as { pages: string[] };
};

describe("docs page manifest", () => {
  it("lists canonical pages", () => {
    const manifest = readManifest();
    expect(manifest.pages).toEqual(
      expect.arrayContaining(["index", "getting-started", "architecture", "adrs"]),
    );
  });
});

describe("docs build output", () => {
  it("includes canonical routes in dist/", () => {
    const distRoot = path.join(docsAppRoot, "dist");
    const expectedPaths = [
      "index.html",
      "getting-started/index.html",
      "architecture/index.html",
      "adrs/index.html",
    ];

    for (const relativePath of expectedPaths) {
      const absolutePath = path.join(distRoot, relativePath);
      expect(fs.existsSync(absolutePath), `missing ${relativePath}`).toBe(true);
    }
  });
});
