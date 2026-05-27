import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  FIXTURE_CATEGORIES,
  getFixturePath,
  getSampleAssetPackPath,
  listFixtures,
  SAMPLE_ASSET_PACK_DIR,
} from "./index.js";

describe("@tileborne/test-fixtures", () => {
  it("lists fixtures in every category", () => {
    for (const category of FIXTURE_CATEGORIES) {
      const entries = listFixtures(category);
      expect(entries.length).toBeGreaterThan(0);
    }
  });

  it("resolves smoke plugin and asset pack paths", () => {
    expect(getFixturePath("plugins", "smoke-fixture", "tileborne-plugin.json")).toContain(
      "tileborne-plugin.json",
    );
    expect(getFixturePath("asset-packs", "smoke-pack", "tileborne-asset-pack.json")).toContain(
      "tileborne-asset-pack.json",
    );
  });

  it("lists and resolves the sample asset pack fixture", () => {
    expect(listFixtures("asset-packs")).toContain(SAMPLE_ASSET_PACK_DIR);
    expect(getSampleAssetPackPath()).toContain(
      path.join("asset-packs", SAMPLE_ASSET_PACK_DIR),
    );
  });
});
