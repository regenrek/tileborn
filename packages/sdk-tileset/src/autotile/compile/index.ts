export {
  BLOB47_MASK_TO_TILE_INDEX,
  BLOB47_TILE_COUNT,
  CORNER16_MASK_TO_TILE_INDEX,
  EDGE16_MASK_TO_TILE_INDEX,
  RPGM_EDGE_TILE_COUNT,
  edgeMaskFromEdge4Bits,
} from "./tables.js";

export {
  appendTileForMask,
  compileFromMaskIndexTable,
  finalizeRule,
  malformedLayout,
  ruleBase,
  type CompileDebug,
  type CompileResult,
  type MaskToTileIds,
  type RuleBaseInput,
} from "./shared.js";

export { assignBlob47Mask, blob47TileIndexForMask, compileBlob47, type CompileBlob47Input } from "./blob47.js";

export { compileWang, wangIdToMaskKey, type CompileWangInput, type WangPattern, type WangTileEntry } from "./wang.js";

export {
  compileRpgm,
  compileRpgmA2,
  expectedRpgmCellCount,
  type CompileRpgmInput,
  type RpgmSetKind,
} from "./rpgm.js";

export {
  compileAutotileRule,
  type AutotileSourceFormat,
  type CompileAutotileRuleInput,
  type CompileAutotileRuleResult,
} from "./rule-compiler.js";
