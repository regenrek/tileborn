import type { ParseDiagnostic } from "../diagnostics.js";
import type { AutotileRuleId, TileId } from "../schemas/ids.js";
import type { AutotileRule } from "../schemas/autotile-rule.js";
import type { TerrainClass } from "../schemas/terrain-class.js";
import type { TerrainTransition } from "../schemas/terrain-transition.js";

/** Resolved tile reference used by terrain base and overlay outputs. */
export type TileRef = TileId;

export type GridCell = {
  readonly x: number;
  readonly y: number;
};

export type TerrainIntentCell = GridCell & {
  readonly terrainClass: TerrainClass;
};

export type TerrainNeighbor = {
  readonly dx: number;
  readonly dy: number;
  readonly terrainClass: TerrainClass;
};

export type TransitionMode = "mask-layer" | "autotile-derived" | "explicit-overlay";

export type TerrainResolveDebug = {
  readonly fromClass: TerrainClass;
  readonly toClass: TerrainClass;
  readonly transitionRuleId?: AutotileRuleId;
  readonly mode: TransitionMode;
};

export type TerrainResolveResult = {
  readonly base: TileRef;
  readonly overlays: ReadonlyArray<TileRef>;
  readonly debug: TerrainResolveDebug;
  readonly diagnostics: ReadonlyArray<ParseDiagnostic>;
};

export type TerrainClassRegistry = {
  readonly baseTileForClass: (terrainClass: TerrainClass) => TileRef | undefined;
  readonly ruleForId: (ruleId: AutotileRuleId) => AutotileRule | undefined;
  readonly transitionMode?: (transition: TerrainTransition) => TransitionMode | undefined;
  readonly overlayTilesForMask?: (
    transition: TerrainTransition,
    mask: number,
  ) => ReadonlyArray<TileRef> | undefined;
  readonly maskLayerTilesForMask?: (
    transition: TerrainTransition,
    mask: number,
  ) => ReadonlyArray<TileRef> | undefined;
  readonly fallbackOverlayForClass?: (toClass: TerrainClass) => TileRef | undefined;
};

export type ResolveTerrainCellInput = {
  readonly cell: TerrainIntentCell;
  readonly neighbors: ReadonlyArray<TerrainNeighbor>;
  readonly transitions: ReadonlyArray<TerrainTransition>;
  readonly classRegistry: TerrainClassRegistry;
};
