import { Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { makeTileId, type Uuid } from "@tileborne/core";

import {
  AutotileRuleId,
  Blob47AutotileRule,
  CustomAutotileRule,
  RpgmA2AutotileRule,
  RpgmA3AutotileRule,
  RpgmA4AutotileRule,
  TerrainClass,
  VariantFilterId,
  Wang2CornerAutotileRule,
  Wang2EdgeAutotileRule,
  Wang4CornerAutotileRule,
} from "../../schemas/index.js";
import {
  Around8Bits,
  Corner4Bits,
  Edge4Bits,
  NEIGHBORHOODS,
  computeMask,
  formatMaskKey,
  neighborhoodForRule,
  projectBlobMask,
  resolveAutotile,
  type Neighborhood,
} from "../index.js";

const uuid = (suffix: string): Uuid =>
  `62656465-0000-4000-8000-${suffix.padStart(12, "0")}` as Uuid;

const tileId = (suffix: string) => makeTileId(uuid(suffix));
const ruleId = (suffix: string) =>
  Schema.decodeUnknownSync(AutotileRuleId)(`autotile-rule:${uuid(suffix)}`);
const variantFilterId = (suffix: string) =>
  Schema.decodeUnknownSync(VariantFilterId)(`variant-filter:${uuid(suffix)}`);
const terrain = (value: string) => Schema.decodeUnknownSync(TerrainClass)(value);

const maskFromKey = (key: string, neighborhood: Neighborhood): number => {
  const sortedBits = [...neighborhood.bits].sort((left, right) => left.bit - right.bit);
  let mask = 0;
  for (let index = 0; index < sortedBits.length; index += 1) {
    if (key[index] === "1") {
      mask |= 1 << sortedBits[index]!.bit;
    }
  }
  return mask;
};

const baseRule = {
  name: "rule",
  terrainClasses: [terrain("grass")],
  maskToTileIds: {},
  fallbackTileId: Option.none(),
} as const;

describe("computeMask", () => {
  it("computes edge4 masks from cardinal neighbors", () => {
    const sameTerrainAt = (dx: number, dy: number) => dx === 0 && dy === -1;

    expect(computeMask(NEIGHBORHOODS.edge4, sameTerrainAt)).toBe(1 << Edge4Bits.N);
    expect(formatMaskKey(1 << Edge4Bits.N, NEIGHBORHOODS.edge4)).toBe("1000");
  });

  it("computes corner4 masks using the center cell at bit 7", () => {
    const sameTerrainAt = (dx: number, dy: number) => dx === 0 && dy === 0;

    expect(computeMask(NEIGHBORHOODS.corner4, sameTerrainAt)).toBe(1 << Corner4Bits.NW);
    expect(formatMaskKey(1 << Corner4Bits.NW, NEIGHBORHOODS.corner4)).toBe("0001");
  });

  it("computes around8 masks clockwise from north", () => {
    const sameTerrainAt = (dx: number, dy: number) =>
      (dx === 0 && dy === -1) || (dx === 1 && dy === 0) || (dx === -1 && dy === -1);

    const mask = computeMask(NEIGHBORHOODS.around8, sameTerrainAt);
    expect(mask).toBe((1 << Around8Bits.N) | (1 << Around8Bits.E) | (1 << Around8Bits.NW));
    expect(formatMaskKey(mask, NEIGHBORHOODS.around8)).toBe("10100001");
  });

  it("projects blob masks by culling unsupported corners", () => {
    const northOnly = 1 << Around8Bits.N;
    const northEast = (1 << Around8Bits.N) | (1 << Around8Bits.E) | (1 << Around8Bits.NE);

    expect(projectBlobMask(northOnly)).toBe(northOnly);
    expect(projectBlobMask(northEast)).toBe(northEast);
    expect(projectBlobMask(northEast | (1 << Around8Bits.NE))).toBe(northEast);
  });
});

describe("neighborhoodForRule", () => {
  it("maps each autotile rule variant to a neighborhood", () => {
    expect(
      neighborhoodForRule(new Wang2EdgeAutotileRule({ ...baseRule, id: ruleId("1") })).kind,
    ).toBe("edge4");
    expect(
      neighborhoodForRule(new Wang2CornerAutotileRule({ ...baseRule, id: ruleId("2") })).kind,
    ).toBe("corner4");
    expect(
      neighborhoodForRule(new Wang4CornerAutotileRule({ ...baseRule, id: ruleId("3") })).kind,
    ).toBe("corner4");
    expect(neighborhoodForRule(new Blob47AutotileRule({ ...baseRule, id: ruleId("4") })).kind).toBe(
      "around8",
    );
    expect(neighborhoodForRule(new RpgmA2AutotileRule({ ...baseRule, id: ruleId("5") })).kind).toBe(
      "around8",
    );
    expect(neighborhoodForRule(new RpgmA4AutotileRule({ ...baseRule, id: ruleId("6") })).kind).toBe(
      "edge4",
    );
    expect(neighborhoodForRule(new RpgmA3AutotileRule({ ...baseRule, id: ruleId("8") })).kind).toBe(
      "edge4",
    );
    expect(
      neighborhoodForRule(
        new CustomAutotileRule({
          ...baseRule,
          id: ruleId("7"),
          source: { provider: "tiled", neighborhood: "corner4" },
          maskToTileIds: { "1010": [tileId("7")] },
        }),
      ).kind,
    ).toBe("corner4");
  });
});

describe("resolveAutotile", () => {
  const fallback = tileId("fb");

  it("resolves wang2edge matches from maskToTileIds", () => {
    const rule = new Wang2EdgeAutotileRule({
      ...baseRule,
      id: ruleId("10"),
      maskToTileIds: {
        "1010": [tileId("10")],
      },
      fallbackTileId: Option.some(fallback),
    });
    const mask = (1 << Edge4Bits.N) | (1 << Edge4Bits.S);

    const result = resolveAutotile(rule, mask, {});

    expect(result.tileId).toBe(tileId("10"));
    expect(result.debug).toEqual({
      mask,
      matchedPatternIndex: 0,
      fallback: false,
      contributingNeighbors: [],
    });
  });

  it("resolves wang2corner, wang4corner, blob47, rpgmA2, and rpgmA4 via lookup tables", () => {
    const cases = [
      [new Wang2CornerAutotileRule({ ...baseRule, id: ruleId("11") }), "0001", tileId("11")],
      [new Wang4CornerAutotileRule({ ...baseRule, id: ruleId("12") }), "0101", tileId("12")],
      [new Blob47AutotileRule({ ...baseRule, id: ruleId("13") }), "10100001", tileId("13")],
      [new RpgmA2AutotileRule({ ...baseRule, id: ruleId("14") }), "10100001", tileId("14")],
      [new RpgmA4AutotileRule({ ...baseRule, id: ruleId("15") }), "1000", tileId("15")],
    ] as const;

    for (const [rule, key, expectedTileId] of cases) {
      const neighborhood = neighborhoodForRule(rule);
      const mask = maskFromKey(key, neighborhood);
      const withLookup = resolveAutotile(rule, mask, {
        patternForMask: () => [expectedTileId],
      });

      expect(withLookup.tileId).toBe(expectedTileId);
      expect(withLookup.debug.matchedPatternIndex).toBe(0);
    }
  });

  it("resolves custom rules from explicit mask mappings", () => {
    const rule = new CustomAutotileRule({
      ...baseRule,
      id: ruleId("16"),
      source: { provider: "tiled", neighborhood: "edge4" },
      maskToTileIds: {
        "0101": [tileId("16")],
      },
      fallbackTileId: Option.none(),
    });
    const mask = (1 << Edge4Bits.E) | (1 << Edge4Bits.W);

    const result = resolveAutotile(rule, mask, {});

    expect(result.tileId).toBe(tileId("16"));
    expect(result.debug.mask).toBe(mask);
  });

  it("uses fallback tiles and records debug metadata", () => {
    const rule = new Blob47AutotileRule({
      ...baseRule,
      id: ruleId("17"),
      maskToTileIds: {},
      fallbackTileId: Option.some(fallback),
    });
    const hooks = [{ filterId: variantFilterId("1"), weight: 2 }];
    const neighbors = [{ dx: 0, dy: -1, terrain: terrain("grass") }];

    const result = resolveAutotile(rule, 0, {
      contributingNeighbors: neighbors,
      variantHooks: hooks,
    });

    expect(result.tileId).toBe(fallback);
    expect(result.debug).toEqual({
      mask: 0,
      matchedPatternIndex: null,
      fallback: true,
      contributingNeighbors: neighbors,
      variantHooks: hooks,
    });
  });

  it("prefers injected pattern lookup tables over rule mask mappings", () => {
    const rule = new Wang2EdgeAutotileRule({
      ...baseRule,
      id: ruleId("18"),
      maskToTileIds: {
        "1000": [tileId("18")],
      },
      fallbackTileId: Option.none(),
    });

    const result = resolveAutotile(rule, 1 << Edge4Bits.N, {
      patternForMask: () => [tileId("lookup")],
    });

    expect(result.tileId).toBe(tileId("lookup"));
  });
});
