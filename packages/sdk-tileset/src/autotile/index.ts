export {
  Around8,
  Around8Bits,
  Corner4,
  Corner4Bits,
  CustomNeighborhood,
  Edge4,
  Edge4Bits,
  NEIGHBORHOODS,
  customNeighborhood,
  type CellOffset,
  type Neighborhood,
  type NeighborhoodBit,
  type NeighborhoodKind,
} from './neighborhoods.js';

export { computeMask, formatMaskKey, projectBlobMask } from './mask.js';

export {
  neighborhoodForRule,
  resolveAutotile,
  type AutotileResolveLookups,
  type ContributingNeighbor,
  type ResolveDebug,
  type ResolveResult,
  type VariantHook,
} from './resolver.js';

export { cellsNeedingRefresh, type GridCell } from './refresh-radius.js';

export {
  assignBlob47Mask,
  blob47TileIndexForMask,
  BLOB47_MASK_TO_TILE_INDEX,
  BLOB47_TILE_COUNT,
  compileAutotileRule,
  compileBlob47,
  compileRpgm,
  compileRpgmA2,
  compileWang,
  CORNER16_MASK_TO_TILE_INDEX,
  EDGE16_MASK_TO_TILE_INDEX,
  expectedRpgmCellCount,
  RPGM_EDGE_TILE_COUNT,
  wangIdToMaskKey,
  type AutotileSourceFormat,
  type CompileAutotileRuleInput,
  type CompileAutotileRuleResult,
  type CompileBlob47Input,
  type CompileDebug,
  type CompileResult,
  type CompileRpgmInput,
  type CompileWangInput,
  type RpgmSetKind,
  type WangPattern,
  type WangTileEntry,
} from './compile/index.js';
