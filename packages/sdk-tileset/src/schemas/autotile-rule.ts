import { Schema } from 'effect';

import { AutotileRuleId, TileId } from './ids.js';
import { TerrainClass } from './terrain-class.js';

const autotileRuleFields = {
  id: AutotileRuleId,
  name: Schema.String,
  terrainClasses: Schema.Array(TerrainClass),
  maskToTileIds: Schema.Record(Schema.String, Schema.NonEmptyArray(TileId)),
  fallbackTileId: Schema.OptionFromUndefinedOr(TileId),
} as const;

/** Wang 2-corner autotile rule. */
export class Wang2CornerAutotileRule extends Schema.TaggedClass<Wang2CornerAutotileRule>()(
  'wang2corner',
  autotileRuleFields,
) {}

/** Wang 2-edge autotile rule. */
export class Wang2EdgeAutotileRule extends Schema.TaggedClass<Wang2EdgeAutotileRule>()(
  'wang2edge',
  autotileRuleFields,
) {}

/** Wang 4-corner autotile rule. */
export class Wang4CornerAutotileRule extends Schema.TaggedClass<Wang4CornerAutotileRule>()(
  'wang4corner',
  autotileRuleFields,
) {}

/** Blob 47-tile autotile rule from around-8 bitmasks. */
export class Blob47AutotileRule extends Schema.TaggedClass<Blob47AutotileRule>()(
  'blob47',
  autotileRuleFields,
) {}

/** RPG Maker A2 47-tile autotile layout. */
export class RpgmA2AutotileRule extends Schema.TaggedClass<RpgmA2AutotileRule>()(
  'rpgmA2',
  autotileRuleFields,
) {}

/** RPG Maker A3 building wall/roof autotile layout. */
export class RpgmA3AutotileRule extends Schema.TaggedClass<RpgmA3AutotileRule>()(
  'rpgmA3',
  autotileRuleFields,
) {}

/** RPG Maker A4 wall/roof autotile layout. */
export class RpgmA4AutotileRule extends Schema.TaggedClass<RpgmA4AutotileRule>()(
  'rpgmA4',
  autotileRuleFields,
) {}

/** Custom declarative autotile rule with explicit mask mapping. */
export class CustomAutotileRule extends Schema.TaggedClass<CustomAutotileRule>()('custom', {
  ...autotileRuleFields,
  source: Schema.Unknown,
}) {}

export const AutotileRule = Schema.Union([
  Wang2CornerAutotileRule,
  Wang2EdgeAutotileRule,
  Wang4CornerAutotileRule,
  Blob47AutotileRule,
  RpgmA2AutotileRule,
  RpgmA3AutotileRule,
  RpgmA4AutotileRule,
  CustomAutotileRule,
]);
export type AutotileRule = typeof AutotileRule.Type;

export const AutotileRulePattern = Schema.Literals([
  'wang2corner',
  'wang2edge',
  'wang4corner',
  'blob47',
  'rpgmA2',
  'rpgmA3',
  'rpgmA4',
  'custom',
] as const);
export type AutotileRulePattern = typeof AutotileRulePattern.Type;
