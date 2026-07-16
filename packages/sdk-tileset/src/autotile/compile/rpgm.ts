import {
  RpgmA2AutotileRule,
  RpgmA3AutotileRule,
  RpgmA4AutotileRule,
} from '../../schemas/autotile-rule.js';
import type { TileId } from '../../schemas/ids.js';

import type { CompileBlob47Input } from './blob47.js';
import {
  around8Neighborhood,
  blobProjectMask,
  compileFromMaskIndexTable,
  edge4Neighborhood,
  finalizeRule,
  ruleBase,
  type CompileResult,
  type RuleBaseInput,
} from './shared.js';
import {
  BLOB47_MASK_TO_TILE_INDEX,
  BLOB47_TILE_COUNT,
  EDGE16_MASK_TO_TILE_INDEX,
  RPGM_EDGE_TILE_COUNT,
} from './tables.js';

export type RpgmSetKind = 'A2' | 'A3' | 'A4';

export type CompileRpgmInput = RuleBaseInput & {
  readonly path?: string;
  readonly set: RpgmSetKind;
  readonly cells: readonly (TileId | undefined)[];
};

const rpgmRuleCtor = (set: RpgmSetKind) => {
  switch (set) {
    case 'A2':
      return RpgmA2AutotileRule;
    case 'A3':
      return RpgmA3AutotileRule;
    case 'A4':
      return RpgmA4AutotileRule;
  }
};

/** Compile an RPG Maker MV/MZ autotile block into a typed autotile rule. */
export const compileRpgm = (input: CompileRpgmInput): CompileResult => {
  const path = input.path ?? `/autotile/rpgm/${input.set}`;

  if (input.set === 'A2') {
    const { maskToTileIds, sourceTileIndexes, diagnostics } = compileFromMaskIndexTable({
      path,
      pattern: 'rpgmA2',
      cells: input.cells,
      expectedCells: BLOB47_TILE_COUNT,
      neighborhood: around8Neighborhood,
      maskToIndex: BLOB47_MASK_TO_TILE_INDEX,
      projectMask: blobProjectMask,
    });

    const hasErrors = diagnostics.some((diagnostic) => diagnostic.severity === 'error');
    if (hasErrors) {
      return {
        debug: { pattern: 'rpgmA2', mappedMaskCount: 0, sourceTileIndexes },
        diagnostics,
      };
    }

    const rule = new RpgmA2AutotileRule(ruleBase(input, maskToTileIds));
    return finalizeRule(rule, { pattern: 'rpgmA2', sourceTileIndexes }, diagnostics);
  }

  const { maskToTileIds, sourceTileIndexes, diagnostics } = compileFromMaskIndexTable({
    path,
    pattern: input.set === 'A3' ? 'rpgmA3' : 'rpgmA4',
    cells: input.cells,
    expectedCells: RPGM_EDGE_TILE_COUNT,
    neighborhood: edge4Neighborhood,
    maskToIndex: EDGE16_MASK_TO_TILE_INDEX,
  });

  const hasErrors = diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  if (hasErrors) {
    return {
      debug: {
        pattern: input.set === 'A3' ? 'rpgmA3' : 'rpgmA4',
        mappedMaskCount: 0,
        sourceTileIndexes,
      },
      diagnostics,
    };
  }

  const Rule = rpgmRuleCtor(input.set);
  const rule = new Rule(ruleBase(input, maskToTileIds));
  return finalizeRule(
    rule,
    {
      pattern: input.set === 'A3' ? 'rpgmA3' : 'rpgmA4',
      sourceTileIndexes,
    },
    diagnostics,
  );
};

/** Convenience helper for callers that already validated A2 cell counts. */
export const compileRpgmA2 = (
  input: Omit<CompileBlob47Input, 'path'> & { readonly path?: string },
): CompileResult => compileRpgm({ ...input, set: 'A2' });

export const expectedRpgmCellCount = (set: RpgmSetKind): number =>
  set === 'A2' ? BLOB47_TILE_COUNT : RPGM_EDGE_TILE_COUNT;
