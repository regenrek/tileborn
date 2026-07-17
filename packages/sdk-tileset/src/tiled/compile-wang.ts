import { Option } from 'effect';

import type { ParseDiagnostic } from '../diagnostics.js';
import type { AutotileRule } from '../schemas/autotile-rule.js';
import {
  Wang2CornerAutotileRule,
  Wang2EdgeAutotileRule,
  Wang4CornerAutotileRule,
} from '../schemas/autotile-rule.js';
import type { TileId } from '../schemas/ids.js';
import { TerrainClass } from '../schemas/terrain-class.js';
import { Schema } from 'effect';

import { deterministicAutotileRuleId } from './deterministic-ids.js';
import type { TiledJsonWangSet } from './types.js';

const terrainFromName = (seed: string, name: string): typeof TerrainClass.Type =>
  Schema.decodeUnknownSync(TerrainClass)(`${seed}:${name}`.replace(/[^A-Za-z0-9:_-]+/g, '-'));

const wangPattern = (wangSet: TiledJsonWangSet): 'wang2corner' | 'wang2edge' | 'wang4corner' => {
  switch (wangSet.type) {
    case 'edge':
      return 'wang2edge';
    case 'mixed':
      return 'wang4corner';
    case 'corner':
    default:
      return 'wang2corner';
  }
};

const wangIndicesForPattern = (pattern: ReturnType<typeof wangPattern>): readonly number[] => {
  switch (pattern) {
    case 'wang2edge':
      return [0, 2, 4, 6];
    case 'wang4corner':
      return [0, 1, 2, 3, 4, 5, 6, 7];
    case 'wang2corner':
    default:
      return [1, 3, 5, 7];
  }
};

/** Convert a Tiled wangid array into an autotile mask lookup key. */
export const wangIdToMaskKey = (
  wangid: readonly number[],
  pattern: ReturnType<typeof wangPattern>,
): string =>
  wangIndicesForPattern(pattern)
    .map((index) => ((wangid[index] ?? 0) > 0 ? '1' : '0'))
    .join('');

export const compileWangSets = (input: {
  readonly packSeed: string;
  readonly tilesetSeed: string;
  readonly tileIdForIndex: (localIndex: number) => TileId | undefined;
  readonly wangsets: readonly TiledJsonWangSet[] | undefined;
}): {
  readonly rules: readonly AutotileRule[];
  readonly diagnostics: readonly ParseDiagnostic[];
} => {
  const rules: AutotileRule[] = [];
  const diagnostics: ParseDiagnostic[] = [];

  for (const wangSet of input.wangsets ?? []) {
    const pattern = wangPattern(wangSet);
    const terrainClasses = wangSet.colors.map((color) =>
      terrainFromName(`${input.packSeed}/${input.tilesetSeed}`, color.name),
    );
    const maskToTileIds: Record<string, [TileId, ...TileId[]]> = {};

    for (const wangTile of wangSet.wangtiles) {
      const tileId = input.tileIdForIndex(wangTile.tileid);
      if (!tileId) {
        diagnostics.push({
          _tag: 'AnimationFrameOutOfBounds',
          path: `/wangsets/${wangSet.name}/wangtiles/${wangTile.tileid}`,
          message: 'Wang tile references an unknown local tile index',
          severity: 'warning',
          animationId: deterministicAutotileRuleId(`${input.tilesetSeed}/${wangSet.name}`),
          frameIndex: wangTile.tileid,
        });
        continue;
      }
      const key = wangIdToMaskKey(wangTile.wangid, pattern);
      const existing = maskToTileIds[key];
      maskToTileIds[key] = existing ? [...existing, tileId] : [tileId];
    }

    const ruleBase = {
      id: deterministicAutotileRuleId(`${input.tilesetSeed}/wang/${wangSet.name}`),
      name: wangSet.name,
      terrainClasses,
      maskToTileIds: maskToTileIds as Record<string, readonly [TileId, ...TileId[]]>,
      fallbackTileId: Option.none(),
    };

    rules.push(
      pattern === 'wang2edge'
        ? new Wang2EdgeAutotileRule(ruleBase)
        : pattern === 'wang4corner'
          ? new Wang4CornerAutotileRule(ruleBase)
          : new Wang2CornerAutotileRule(ruleBase),
    );
  }

  return { rules, diagnostics };
};
