import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { allGoldenScenarios } from "../src/__verification__/scenarios.js";
import { stableStringify } from "../src/__verification__/helpers.js";

const goldensRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/__verification__/__goldens__",
);

const writeGoldenJson = (scenario: string, filename: string, value: unknown): void => {
  const absolutePath = path.join(goldensRoot, scenario, filename);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, stableStringify(value), "utf8");
};

const scenarios = await allGoldenScenarios();

writeGoldenJson("cross-format-equivalence", "snapshot.json", scenarios["cross-format-equivalence"]);
writeGoldenJson("replay", "brush-sequence.json", scenarios.replay);
writeGoldenJson("layouts", "4x4-basic.json", scenarios.layouts["4x4-basic"]);
writeGoldenJson("layouts", "4x4-variants.json", scenarios.layouts["4x4-variants"]);
writeGoldenJson("layouts", "8x8-basic.json", scenarios.layouts["8x8-basic"]);
writeGoldenJson("layouts", "16x16-basic.json", scenarios.layouts["16x16-basic"]);
writeGoldenJson("uvs", "perfect-grid-16.json", scenarios.uvs["perfect-grid-16"]);
writeGoldenJson("uvs", "grid-32-margin-spacing.json", scenarios.uvs["grid-32-margin-spacing"]);
writeGoldenJson("uvs", "meadow-frame-index.json", scenarios.uvs["meadow-frame-index"]);
writeGoldenJson("animation-determinism", "60-ticks.json", scenarios["animation-determinism"]);
writeGoldenJson("collision-roundtrip", "geometry.json", scenarios["collision-roundtrip"]);
writeGoldenJson("runtime-packaging", "tiny-map-5-tiles.json", scenarios["runtime-packaging"].tiny);
writeGoldenJson("runtime-packaging", "large-map-bounded.json", scenarios["runtime-packaging"].large);
writeGoldenJson("tiled-wall-rules", "wall-test-mask-table.json", scenarios["tiled-wall-rules"]);
writeGoldenJson(
  "terrain-transition-grass-water",
  "3x3-center-grass.json",
  scenarios["terrain-transition-grass-water"],
);

console.log("Regenerated verification goldens under src/__verification__/__goldens__/");
