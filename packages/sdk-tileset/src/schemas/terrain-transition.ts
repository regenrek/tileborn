import { Schema } from "effect";

import { AutotileRuleId } from "./ids.js";
import { TerrainClass } from "./terrain-class.js";

/** Terrain class transition bound to an autotile rule. */
export class TerrainTransition extends Schema.Class<TerrainTransition>("TerrainTransition")({
  from: TerrainClass,
  to: TerrainClass,
  ruleId: AutotileRuleId,
}) {}
