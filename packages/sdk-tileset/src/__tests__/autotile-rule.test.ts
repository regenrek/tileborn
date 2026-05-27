import { Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { makeTileId, type Uuid } from "@tileborne/core";

import {
  AutotileRule,
  Blob47AutotileRule,
  CustomAutotileRule,
  RpgmA2AutotileRule,
  RpgmA3AutotileRule,
  RpgmA4AutotileRule,
  Wang2CornerAutotileRule,
  Wang2EdgeAutotileRule,
  Wang4CornerAutotileRule,
} from "../schemas/autotile-rule.js";
import { AutotileRuleId } from "../schemas/ids.js";
import { TerrainClass } from "../schemas/terrain-class.js";

const uuid = (suffix: string): Uuid =>
  `62656465-0000-4000-8000-${suffix.padStart(12, "0")}` as Uuid;

const tileId = (suffix: string) => makeTileId(uuid(suffix));
const ruleId = (suffix: string) =>
  Schema.decodeUnknownSync(AutotileRuleId)(`autotile-rule:${uuid(suffix)}`);
const terrain = (value: string) => Schema.decodeUnknownSync(TerrainClass)(value);

const baseRule = {
  name: "rule",
  terrainClasses: [terrain("grass")],
  maskToTileIds: {
    "0001": [tileId("1")],
  },
  fallbackTileId: Option.none(),
} as const;

const variants = [
  new Wang2CornerAutotileRule({ ...baseRule, id: ruleId("1") }),
  new Wang2EdgeAutotileRule({ ...baseRule, id: ruleId("2") }),
  new Wang4CornerAutotileRule({ ...baseRule, id: ruleId("3") }),
  new Blob47AutotileRule({ ...baseRule, id: ruleId("4") }),
  new RpgmA2AutotileRule({ ...baseRule, id: ruleId("5") }),
  new RpgmA3AutotileRule({ ...baseRule, id: ruleId("8") }),
  new RpgmA4AutotileRule({ ...baseRule, id: ruleId("6") }),
  new CustomAutotileRule({ ...baseRule, id: ruleId("7"), source: { provider: "tiled" } }),
] as const;

describe("AutotileRule discriminated union", () => {
  for (const rule of variants) {
    it(`decodes ${rule._tag}`, () => {
      const encoded = Schema.encodeUnknownSync(AutotileRule)(rule);
      const decoded = Schema.decodeUnknownSync(AutotileRule)(encoded);
      expect(decoded).toEqual(rule);
      expect(decoded._tag).toBe(rule._tag);
    });
  }
});
