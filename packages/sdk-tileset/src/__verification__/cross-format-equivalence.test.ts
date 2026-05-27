import { describe, expect, it } from "vitest";

import { importTiledSource } from "../importers/tiled-source/import.js";
import { parseLdtkProject } from "../ldtk/ldtk-parse.js";
import { parseTilesetManifest } from "../manifest/parse.js";
import { parseTmjSync } from "../tiled/tmj-parse.js";
import { parseTmx } from "../tiled/tmx-parse.js";
import {
  crossFormatLdtkProject,
  crossFormatManifest,
  crossFormatTmj,
  crossFormatTmx,
  tiledSourceVerificationMap,
  tiledSourceVerificationTsx,
  VERIFICATION_PACK_SEED,
  VERIFICATION_PROJECT_ROOT,
} from "./fixtures/cross-format.js";
import { assertGoldenMatch, REGEN_COMMAND } from "./helpers.js";
import crossFormatSnapshot from "./__goldens__/cross-format-equivalence/snapshot.json" with { type: "json" };
import { normalizeLayoutSnapshot, normalizePackForComparison } from "./normalize.js";
import { buildCrossFormatEquivalenceGolden } from "./scenarios.js";

const PNG_BYTES = new Uint8Array([137, 80, 78, 71]);

describe("cross-format equivalence", () => {
  it("matches committed golden normalized pack + layout across TMX, TMJ, LDtk, manifest, and Tiled source", async () => {
    const golden = await buildCrossFormatEquivalenceGolden();
    assertGoldenMatch("cross-format-equivalence/snapshot.json", golden, crossFormatSnapshot);

    const { reference, formats } = golden;
    expect(formats.tmx.pack).toEqual(reference.pack);
    expect(formats.tmx.mapCells).toEqual(reference.mapCells);
    expect(formats.ldtk.pack.tileCount).toBe(reference.pack.tileCount);
    expect(formats.manifest.pack.tileCount).toBe(2);
  });

  it("imports each format live without errors", async () => {
    const tmj = parseTmjSync(crossFormatTmj, {
      packIdSeed: VERIFICATION_PACK_SEED,
      projectRoot: VERIFICATION_PROJECT_ROOT,
      sourcePath: `${VERIFICATION_PROJECT_ROOT}/maps/test.tmj`,
    });
    const tmx = await parseTmx(crossFormatTmx, {
      packIdSeed: VERIFICATION_PACK_SEED,
      projectRoot: VERIFICATION_PROJECT_ROOT,
      sourcePath: `${VERIFICATION_PROJECT_ROOT}/maps/test.tmx`,
    });
    const ldtk = parseLdtkProject({
      projectPath: `${VERIFICATION_PROJECT_ROOT}/world.ldtk`,
      projectJson: crossFormatLdtkProject,
    });
    const manifest = parseTilesetManifest(crossFormatManifest);
    const tiledSource = await importTiledSource({
      sourceRoot: "/tiled-source-verification",
      readFile: (path) => {
        const files: Record<string, string | Uint8Array> = {
          "/tiled-source-verification/TiledMap Editor/Tilesets/verification.tsx": tiledSourceVerificationTsx,
          "/tiled-source-verification/TiledMap Editor/sample.tmx": tiledSourceVerificationMap,
          "/tiled-source-verification/Tilesets/terrain.png": PNG_BYTES,
        };
        const value = files[path];
        if (value === undefined) {
          throw new Error(`missing ${path}`);
        }
        return value;
      },
      tsxFiles: ["TiledMap Editor/Tilesets/verification.tsx"],
      mapFiles: ["TiledMap Editor/sample.tmx"],
      ruleFiles: [],
      importedAt: "2026-05-23T00:00:00.000Z",
    });

    expect(tmj.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
    expect(tmx.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
    expect(manifest.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
    expect(tiledSource.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);

    const tmjNormalized = normalizePackForComparison(tmj.value!.pack);
    const tmxNormalized = normalizePackForComparison(tmx.value!.pack);
    const ldtkNormalized = normalizePackForComparison(ldtk.pack);
    const manifestNormalized = normalizePackForComparison(manifest.value!);
    const tiledSourceNormalized = normalizePackForComparison(tiledSource.value!);

    expect(tmxNormalized).toEqual(tmjNormalized);
    expect(ldtkNormalized.tileCount).toBe(tmjNormalized.tileCount);
    expect(manifestNormalized.tileCount).toBe(2);
    expect(tiledSourceNormalized.tileCount).toBeGreaterThanOrEqual(2);

    const tmjLayer = tmj.value!.map.layers.find((layer) => layer._tag === "tile");
    expect(tmjLayer?._tag).toBe("tile");
    if (tmjLayer?._tag === "tile") {
      const layout = normalizeLayoutSnapshot(
        tmj.value!.pack,
        {
          width: 2,
          height: 2,
          cells: [],
        },
      );
      expect(layout).toBeDefined();
    }
  });

  it("includes regeneration command in assertion failures", () => {
    expect(REGEN_COMMAND).toContain("regen-goldens.mts");
  });
});
