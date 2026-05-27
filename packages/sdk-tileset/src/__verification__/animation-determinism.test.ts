import { Option } from "effect";
import { describe, expect, it } from "vitest";

import { compileAnimation } from "../animation/compile.js";
import { resolveAnimatedTile } from "../animation/resolve.js";
import { meadowPack } from "../manifest/__fixtures__/fixtures.js";
import { parseTilesetManifest } from "../manifest/parse.js";
import animationGolden from "./__goldens__/animation-determinism/60-ticks.json" with { type: "json" };
import { assertGoldenMatch } from "./helpers.js";
import { buildAnimationDeterminismGolden } from "./scenarios.js";

describe("animation determinism", () => {
  it("matches golden 60-tick frame sequence", () => {
    const golden = buildAnimationDeterminismGolden();
    assertGoldenMatch("animation-determinism/60-ticks.json", golden, animationGolden);
    expect(golden.replayMatches).toBe(true);
  });

  it("produces identical frame IDs across repeated 60-tick runs", () => {
    const pack = parseTilesetManifest(meadowPack).value!;
    const animation = Option.getOrThrow(pack.tilesets[0]!.tiles[0]!.animation);
    const compiled = compileAnimation(animation).value!;

    const first = Array.from({ length: 60 }, (_, tick) =>
      String(resolveAnimatedTile(compiled, tick * 16)),
    );
    const second = Array.from({ length: 60 }, (_, tick) =>
      String(resolveAnimatedTile(compiled, tick * 16)),
    );

    expect(second).toEqual(first);
  });
});
