import {
  Wang2CornerAutotileRule,
  Wang2EdgeAutotileRule,
  Wang4CornerAutotileRule,
} from '../../schemas/autotile-rule.js';
import type { TileId } from '../../schemas/ids.js';
import { wangIdToMaskKey } from '../../tiled/compile-wang.js';

import {
  appendTileForMask,
  compileFromMaskIndexTable,
  corner4Neighborhood,
  edge4Neighborhood,
  finalizeRule,
  ruleBase,
  type CompileResult,
  type MaskToTileIds,
  type RuleBaseInput,
} from './shared.js';
import {
  CORNER16_MASK_TO_TILE_INDEX,
  EDGE16_MASK_TO_TILE_INDEX,
  RPGM_EDGE_TILE_COUNT,
} from './tables.js';

export type WangPattern = 'wang2edge' | 'wang2corner' | 'wang4corner';

export type WangTileEntry = {
  readonly wangid: readonly number[];
  readonly tileId: TileId;
  readonly sourceTileIndex?: number;
};

export type CompileWangInput = RuleBaseInput & {
  readonly path?: string;
  readonly pattern: WangPattern;
  readonly entries?: readonly WangTileEntry[];
  readonly cells?: readonly (TileId | undefined)[];
};

const wangRuleCtor = (pattern: WangPattern) => {
  switch (pattern) {
    case 'wang2edge':
      return Wang2EdgeAutotileRule;
    case 'wang4corner':
      return Wang4CornerAutotileRule;
    case 'wang2corner':
    default:
      return Wang2CornerAutotileRule;
  }
};

const layoutTableForPattern = (pattern: WangPattern) => {
  switch (pattern) {
    case 'wang2edge':
      return {
        neighborhood: edge4Neighborhood,
        maskToIndex: EDGE16_MASK_TO_TILE_INDEX,
      };
    case 'wang4corner':
    case 'wang2corner':
    default:
      return {
        neighborhood: corner4Neighborhood,
        maskToIndex: CORNER16_MASK_TO_TILE_INDEX,
      };
  }
};

const compileFromEntries = (
  input: CompileWangInput,
  path: string,
): {
  readonly maskToTileIds: MaskToTileIds;
  readonly sourceTileIndexes: number[];
  readonly sourceWangIds: readonly number[][];
  readonly diagnostics: CompileResult['diagnostics'];
} => {
  const maskToTileIds: MaskToTileIds = {};
  const sourceTileIndexes: number[] = [];
  const sourceWangIds: number[][] = [];
  const diagnostics: import('../../diagnostics.js').ParseDiagnostic[] = [];

  for (const [index, entry] of (input.entries ?? []).entries()) {
    const key = wangIdToMaskKey(entry.wangid, input.pattern);
    appendTileForMask(maskToTileIds, key, entry.tileId);
    sourceTileIndexes.push(entry.sourceTileIndex ?? index);
    sourceWangIds.push([...entry.wangid]);
  }

  if (sourceTileIndexes.length === 0) {
    diagnostics.push({
      _tag: 'MalformedAutotileLayout',
      path,
      message: `Wang ${input.pattern} compile requires wang tile entries or a ${RPGM_EDGE_TILE_COUNT}-cell atlas layout`,
      severity: 'error',
      pattern: input.pattern,
      expectedCells: RPGM_EDGE_TILE_COUNT,
      actualCells: 0,
    });
  }

  return { maskToTileIds, sourceTileIndexes, sourceWangIds, diagnostics };
};

/** Compile Tiled-style wang tiles or fixed 16-tile wang atlases into an autotile rule. */
export const compileWang = (input: CompileWangInput): CompileResult => {
  const path = input.path ?? `/autotile/wang/${input.pattern}`;

  if (input.entries && input.entries.length > 0) {
    const compiled = compileFromEntries(input, path);
    const hasErrors = compiled.diagnostics.some((diagnostic) => diagnostic.severity === 'error');
    if (hasErrors) {
      return {
        debug: {
          pattern: input.pattern,
          mappedMaskCount: 0,
          sourceTileIndexes: compiled.sourceTileIndexes,
          sourceWangIds: compiled.sourceWangIds,
        },
        diagnostics: compiled.diagnostics,
      };
    }

    const Rule = wangRuleCtor(input.pattern);
    const rule = new Rule(ruleBase(input, compiled.maskToTileIds));
    return finalizeRule(
      rule,
      {
        pattern: input.pattern,
        sourceTileIndexes: compiled.sourceTileIndexes,
        sourceWangIds: compiled.sourceWangIds,
      },
      compiled.diagnostics,
    );
  }

  const layout = layoutTableForPattern(input.pattern);
  const { maskToTileIds, sourceTileIndexes, diagnostics } = compileFromMaskIndexTable({
    path,
    pattern: input.pattern,
    cells: input.cells ?? [],
    expectedCells: RPGM_EDGE_TILE_COUNT,
    neighborhood: layout.neighborhood,
    maskToIndex: layout.maskToIndex,
  });

  const hasErrors = diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  if (hasErrors) {
    return {
      debug: { pattern: input.pattern, mappedMaskCount: 0, sourceTileIndexes },
      diagnostics,
    };
  }

  const Rule = wangRuleCtor(input.pattern);
  const rule = new Rule(ruleBase(input, maskToTileIds));
  return finalizeRule(rule, { pattern: input.pattern, sourceTileIndexes }, diagnostics);
};

export { wangIdToMaskKey };
