import type { ParseDiagnostic } from '../../diagnostics.js';
import type { AutotileRule } from '../../schemas/autotile-rule.js';
import type { TileId } from '../../schemas/ids.js';

import { compileBlob47 } from './blob47.js';
import { compileRpgm, type RpgmSetKind } from './rpgm.js';
import type { CompileDebug, CompileResult, RuleBaseInput } from './shared.js';
import { compileWang, type WangPattern, type WangTileEntry } from './wang.js';

export type AutotileSourceFormat =
  | {
      readonly kind: 'blob47';
      readonly cells: readonly (TileId | undefined)[];
    }
  | {
      readonly kind: 'rpgm';
      readonly set: RpgmSetKind;
      readonly cells: readonly (TileId | undefined)[];
    }
  | {
      readonly kind: 'wang';
      readonly pattern: WangPattern;
      readonly entries?: readonly WangTileEntry[];
      readonly cells?: readonly (TileId | undefined)[];
    }
  | {
      readonly kind: 'tiledWang';
      readonly pattern: WangPattern;
      readonly entries: readonly WangTileEntry[];
      readonly wangSetName?: string;
    };

export type CompileAutotileRuleInput = RuleBaseInput & {
  readonly path?: string;
  readonly source: AutotileSourceFormat;
  readonly debug?: Record<string, unknown>;
};

export type CompileAutotileRuleResult = CompileResult & {
  readonly debug: CompileDebug & {
    readonly source?: Record<string, unknown>;
  };
};

const unknownRpgmSet = (path: string, set: string): ParseDiagnostic => ({
  _tag: 'UnknownRpgmSetKind',
  path,
  message: `Unknown RPG Maker autotile set kind "${set}"`,
  severity: 'error',
  set,
});

/** High-level autotile rule compiler dispatcher for source-format hints and atlas data. */
export const compileAutotileRule = (input: CompileAutotileRuleInput): CompileAutotileRuleResult => {
  const path = input.path ?? '/autotile/compile';
  const base: RuleBaseInput = {
    id: input.id,
    name: input.name,
    terrainClasses: input.terrainClasses,
    ...(input.fallbackTileId !== undefined ? { fallbackTileId: input.fallbackTileId } : {}),
  };

  const attachDebug = (result: CompileResult, pattern: string): CompileAutotileRuleResult => ({
    ...result,
    debug: {
      ...result.debug,
      pattern,
      ...(input.debug !== undefined ? { source: input.debug } : {}),
    },
  });

  switch (input.source.kind) {
    case 'blob47':
      return attachDebug(compileBlob47({ ...base, path, cells: input.source.cells }), 'blob47');
    case 'rpgm':
      if (input.source.set !== 'A2' && input.source.set !== 'A3' && input.source.set !== 'A4') {
        return {
          debug: {
            pattern: 'rpgm',
            mappedMaskCount: 0,
            ...(input.debug !== undefined ? { source: input.debug } : {}),
          },
          diagnostics: [unknownRpgmSet(path, input.source.set)],
        };
      }
      return attachDebug(
        compileRpgm({ ...base, path, set: input.source.set, cells: input.source.cells }),
        input.source.set === 'A2' ? 'rpgmA2' : input.source.set === 'A3' ? 'rpgmA3' : 'rpgmA4',
      );
    case 'wang':
      return attachDebug(
        compileWang({
          ...base,
          path,
          pattern: input.source.pattern,
          ...(input.source.entries !== undefined ? { entries: input.source.entries } : {}),
          ...(input.source.cells !== undefined ? { cells: input.source.cells } : {}),
        }),
        input.source.pattern,
      );
    case 'tiledWang':
      return attachDebug(
        compileWang({
          ...base,
          path: `${path}/wang/${input.source.wangSetName ?? input.source.pattern}`,
          pattern: input.source.pattern,
          entries: input.source.entries,
        }),
        input.source.pattern,
      );
  }
};

export type { AutotileRule, CompileDebug, CompileResult, WangPattern, WangTileEntry, RpgmSetKind };
