import { describe, expect, it } from "vitest";

import largeMapGolden from "./__goldens__/runtime-packaging/large-map-bounded.json" with { type: "json" };
import tinyMapGolden from "./__goldens__/runtime-packaging/tiny-map-5-tiles.json" with { type: "json" };
import {
  largeMapTileRefs,
  runtimePackagingManifest,
  tinyMapTileRefs,
} from "./fixtures/cross-format.js";
import { assertGoldenMatch } from "./helpers.js";
import { buildReferencedTilesetManifest, manifestSummary } from "./runtime-packaging.js";
import { buildRuntimePackagingGoldens } from "./scenarios.js";

describe("runtime packaging", () => {
  it("matches golden tiny and large map manifest filtering summaries", () => {
    const golden = buildRuntimePackagingGoldens();
    assertGoldenMatch("runtime-packaging/tiny-map-5-tiles.json", golden.tiny, tinyMapGolden);
    assertGoldenMatch("runtime-packaging/large-map-bounded.json", golden.large, largeMapGolden);
  });

  it("includes exactly five tile references for tiny maps", () => {
    const manifest = runtimePackagingManifest as Record<string, unknown>;
    const filtered = buildReferencedTilesetManifest(manifest, tinyMapTileRefs);
    const summary = manifestSummary(filtered);

    expect(summary.tileCount).toBe(5);
    expect(((filtered.tiles as unknown[]) ?? []).map((tile) => String((tile as { id: string }).id)).sort()).toEqual(
      [...tinyMapTileRefs].sort(),
    );
  });

  it("keeps large-map payloads bounded to referenced tiles plus animation frames", () => {
    const manifest = runtimePackagingManifest as Record<string, unknown>;
    const filtered = buildReferencedTilesetManifest(manifest, largeMapTileRefs);
    const summary = manifestSummary(filtered);

    expect(summary.tileCount).toBeLessThanOrEqual(largeMapTileRefs.length + 2);
    expect(summary.tilesetCount).toBe(1);
    expect(summary.assetCount).toBe(1);
  });
});
