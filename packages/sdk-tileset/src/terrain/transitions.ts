import type { ParseDiagnostic } from '../diagnostics.js';
import {
  computeMask,
  formatMaskKey,
  neighborhoodForRule,
  NEIGHBORHOODS,
  resolveAutotile,
} from '../autotile/index.js';
import type { AutotileRule } from '../schemas/autotile-rule.js';
import type { TerrainClass } from '../schemas/terrain-class.js';
import type { TerrainTransition } from '../schemas/terrain-transition.js';

import type {
  ResolveTerrainCellInput,
  TerrainClassRegistry,
  TerrainResolveDebug,
  TerrainResolveResult,
  TileRef,
  TransitionMode,
} from './types.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readTransitionModeFromRule = (rule: AutotileRule): TransitionMode | undefined => {
  if (rule._tag !== 'custom' || !isRecord(rule.source)) {
    return undefined;
  }

  const mode = rule.source.transitionMode;
  if (mode === 'mask-layer' || mode === 'autotile-derived' || mode === 'explicit-overlay') {
    return mode;
  }

  return undefined;
};

const resolveTransitionMode = (
  transition: TerrainTransition,
  rule: AutotileRule | undefined,
  classRegistry: TerrainClassRegistry,
): TransitionMode => {
  const fromRegistry = classRegistry.transitionMode?.(transition);
  if (fromRegistry !== undefined) {
    return fromRegistry;
  }

  if (rule !== undefined) {
    const fromRule = readTransitionModeFromRule(rule);
    if (fromRule !== undefined) {
      return fromRule;
    }
  }

  if (classRegistry.maskLayerTilesForMask !== undefined) {
    return 'mask-layer';
  }

  if (classRegistry.overlayTilesForMask !== undefined) {
    return 'explicit-overlay';
  }

  return 'autotile-derived';
};

const missingTransitionRuleDiagnostic = (
  fromClass: TerrainClass,
  toClass: TerrainClass,
): ParseDiagnostic => ({
  _tag: 'MissingTransitionRule',
  path: `/terrainTransitions/${fromClass}->${toClass}`,
  message: `No terrain transition rule from ${fromClass} to ${toClass}`,
  severity: 'warning',
  fromClass,
  toClass,
});

const neighborTerrainAt =
  (neighbors: ResolveTerrainCellInput['neighbors']) =>
  (dx: number, dy: number): TerrainClass | undefined => {
    for (const neighbor of neighbors) {
      if (neighbor.dx === dx && neighbor.dy === dy) {
        return neighbor.terrainClass;
      }
    }
    return undefined;
  };

const computeTransitionMask = (
  neighbors: ResolveTerrainCellInput['neighbors'],
  toClass: TerrainClass,
  rule: AutotileRule | undefined,
): number => {
  const neighborhood = rule === undefined ? NEIGHBORHOODS.around8 : neighborhoodForRule(rule);
  const terrainAt = neighborTerrainAt(neighbors);

  return computeMask(neighborhood, (dx, dy) => terrainAt(dx, dy) === toClass);
};

const resolveAutotileDerivedOverlay = (
  rule: AutotileRule,
  mask: number,
): ReadonlyArray<TileRef> => {
  const result = resolveAutotile(rule, mask, {});
  return [result.tileId];
};

const resolveExplicitOverlay = (
  transition: TerrainTransition,
  mask: number,
  classRegistry: TerrainClassRegistry,
  rule: AutotileRule | undefined,
): ReadonlyArray<TileRef> => {
  const neighborhood = rule === undefined ? NEIGHBORHOODS.around8 : neighborhoodForRule(rule);
  const fromRegistry = classRegistry.overlayTilesForMask?.(transition, mask);
  if (fromRegistry !== undefined && fromRegistry.length > 0) {
    return fromRegistry;
  }

  if (rule === undefined) {
    return [];
  }

  const key = formatMaskKey(mask, neighborhood);
  const fromRule = rule.maskToTileIds[key];
  return fromRule ?? [];
};

const resolveMaskLayerOverlay = (
  transition: TerrainTransition,
  mask: number,
  classRegistry: TerrainClassRegistry,
  rule: AutotileRule | undefined,
): ReadonlyArray<TileRef> => {
  const fromRegistry = classRegistry.maskLayerTilesForMask?.(transition, mask);
  if (fromRegistry !== undefined && fromRegistry.length > 0) {
    return fromRegistry;
  }

  return resolveExplicitOverlay(transition, mask, classRegistry, rule);
};

const resolveOverlayTiles = (
  transition: TerrainTransition,
  mode: TransitionMode,
  mask: number,
  classRegistry: TerrainClassRegistry,
  rule: AutotileRule | undefined,
): ReadonlyArray<TileRef> => {
  if (mask === 0) {
    return [];
  }

  switch (mode) {
    case 'autotile-derived':
      return rule === undefined ? [] : resolveAutotileDerivedOverlay(rule, mask);
    case 'explicit-overlay':
      return resolveExplicitOverlay(transition, mask, classRegistry, rule);
    case 'mask-layer':
      return resolveMaskLayerOverlay(transition, mask, classRegistry, rule);
  }
};

const compareTerrainClasses = (left: TerrainClass, right: TerrainClass): number =>
  String(left).localeCompare(String(right));

/** Resolve a terrain intent cell into a base tile and transition overlays. */
export const resolveTerrainCell = ({
  cell,
  neighbors,
  transitions,
  classRegistry,
}: ResolveTerrainCellInput): TerrainResolveResult => {
  const fromClass = cell.terrainClass;
  const base = classRegistry.baseTileForClass(fromClass);
  if (base === undefined) {
    throw new Error(`No base tile registered for terrain class ${fromClass}`);
  }

  const diagnostics: ParseDiagnostic[] = [];
  const overlays: TileRef[] = [];
  let debug: TerrainResolveDebug = {
    fromClass,
    toClass: fromClass,
    mode: 'autotile-derived',
  };

  const distinctNeighborClasses = new Set<TerrainClass>();
  for (const neighbor of neighbors) {
    if (neighbor.terrainClass !== fromClass) {
      distinctNeighborClasses.add(neighbor.terrainClass);
    }
  }

  if (distinctNeighborClasses.size === 0) {
    return {
      base,
      overlays,
      debug: {
        fromClass,
        toClass: fromClass,
        mode: 'autotile-derived',
      },
      diagnostics,
    };
  }

  const sortedNeighborClasses = [...distinctNeighborClasses].sort(compareTerrainClasses);

  for (const toClass of sortedNeighborClasses) {
    const transition = transitions.find(
      (candidate) => candidate.from === fromClass && candidate.to === toClass,
    );

    if (transition === undefined) {
      diagnostics.push(missingTransitionRuleDiagnostic(fromClass, toClass));
      const fallback = classRegistry.fallbackOverlayForClass?.(toClass);
      if (fallback !== undefined) {
        overlays.push(fallback);
      }
      continue;
    }

    const rule = classRegistry.ruleForId(transition.ruleId);
    const mode = resolveTransitionMode(transition, rule, classRegistry);
    const mask = computeTransitionMask(neighbors, toClass, rule);
    const transitionOverlays = resolveOverlayTiles(transition, mode, mask, classRegistry, rule);

    overlays.push(...transitionOverlays);

    if (debug.toClass === fromClass) {
      debug = {
        fromClass,
        toClass,
        transitionRuleId: transition.ruleId,
        mode,
      };
    }
  }

  return {
    base,
    overlays,
    debug,
    diagnostics,
  };
};
