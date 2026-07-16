import { PixiRendererAdapter, type RuntimeAssetManifest } from '@tileborne/runtime';
import { TRIGGER_REGION_OBJECT_TYPE_ID } from '@tileborne/core';
import type {
  AssetId,
  CollisionFootprintComponent,
  LayerId,
  MapLayer,
  MapObject,
  PackId,
  PlaceableId,
  TileborneMap,
} from '@tileborne/core';
import {
  cellsNeedingRefresh,
  neighborhoodForRule,
  type GridCell,
} from '@tileborne/sdk-tileset/autotile';
import { transitionCellsToRefresh } from '@tileborne/sdk-tileset/terrain';
import {
  compileClipTimeline,
  resolveClipFrameIndex,
  type CompiledClip,
} from '@tileborne/sdk-tileset/animation';
import type { EditorTileFrame } from '@tileborne/sdk-tileset/editor-index';
import type {
  AutotileRule,
  CollisionMaskType,
  Placeable,
  PlaceableFrameRef,
  TerrainTransition,
} from '@tileborne/sdk-tileset/schemas';
import { Effect } from 'effect';
import { Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import { CompositeTilemap } from '@pixi/tilemap';

import type { EntityId } from '@/stores/editor-ui-store';
import { positionedFootprintRects } from '@/lib/catalog-collision-footprint';

import { CHUNK_SIZE, findLayerById } from '../map-utils.js';
import { EditorLayerZIndex } from './layers.js';

const TILE_COLORS = [
  0x000000, 0x4a6741, 0x6b8e4e, 0x8b7355, 0x5c7a8a, 0x9a6b4f, 0x7a5c8a, 0xc4a35a,
];

const tileColor = (index: number): number => TILE_COLORS[index % TILE_COLORS.length] ?? 0x444444;
export const EDITOR_GRID_OUTLINE_COLOR = 0x020617;
export const EDITOR_GRID_STROKE_COLOR = 0xf8fafc;
/** Shared collision-overlay red, used for both tile masks and object footprints. */
export const COLLISION_OVERLAY_FILL_COLOR = 0xef5161;
/** Object-footprint outline so a placed object's footprint reads distinctly from tile masks. */
export const COLLISION_FOOTPRINT_STROKE_COLOR = 0xffd166;
/** Label of the Pixi child that holds the placed-object collision footprints. */
export const OBJECT_FOOTPRINT_LAYER_LABEL = 'object-footprints';
export const MISSING_TILE_TEXTURE_DIAGNOSTIC_COLOR = 0xff3b8b;
export const missingTileTextureDiagnosticColor = (index: number): number => {
  void index;
  return MISSING_TILE_TEXTURE_DIAGNOSTIC_COLOR;
};

const scheduleFrame = (callback: FrameRequestCallback): number => {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    return globalThis.requestAnimationFrame(callback);
  }
  return globalThis.setTimeout(() => callback(performance.now()), 16) as unknown as number;
};

const cancelFrame = (handle: number): void => {
  if (typeof globalThis.cancelAnimationFrame === 'function') {
    globalThis.cancelAnimationFrame(handle);
    return;
  }
  globalThis.clearTimeout(handle);
};

const collisionMaskBlocksMovement = (mask: CollisionMaskType): boolean => {
  if (mask._tag === 'bitmask') {
    return mask.blocked !== 0;
  }
  return mask.blocksMovement;
};

const optionValue = <A>(
  value: A | { readonly _tag?: string; readonly value?: A } | undefined,
): A | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'object' && value !== null && '_tag' in value) {
    return value._tag === 'Some' ? value.value : undefined;
  }
  if (typeof value === 'object' && value !== null && 'value' in value) {
    return value.value;
  }
  if (typeof value === 'object' && value !== null && Object.keys(value).length === 0) {
    return undefined;
  }
  return value as A;
};

/** Resolved playback timeline for one animated object placement. */
interface ActiveClip {
  readonly frames: readonly PlaceableFrameRef[];
  readonly loop: boolean;
  readonly defaultDurationMs: number;
}

/** A live, ticker-driven object sprite whose texture swaps each animation frame. */
interface AnimatedObjectSprite {
  readonly sprite: Sprite;
  readonly textures: readonly Texture[];
  readonly clip: CompiledClip;
  readonly speed: number;
  readonly offsetMs: number;
}

const NAMED_ANCHOR_PIVOT: Record<string, { readonly x: number; readonly y: number }> = {
  'top-left': { x: 0, y: 0 },
  center: { x: 0.5, y: 0.5 },
  'bottom-left': { x: 0, y: 1 },
};

/**
 * Normalized pivot for a placeable, from its persisted anchor properties
 * (numeric `tileborne.anchorX/Y`, else the named `tileborne.anchor`, else
 * top-left). Mirrors the runtime/playtest pivot so the editor honors the same
 * anchor a sprite renders with in playtest.
 */
const placeableAnchorPivot = (placeable: Placeable): { readonly x: number; readonly y: number } => {
  const props = placeable.source.properties;
  const x = props['tileborne.anchorX'];
  const y = props['tileborne.anchorY'];
  if (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)) {
    return { x, y };
  }
  const named = props['tileborne.anchor'];
  if (typeof named === 'string' && named in NAMED_ANCHOR_PIVOT) {
    return NAMED_ANCHOR_PIVOT[named]!;
  }
  return { x: 0, y: 0 };
};

/**
 * Apply a placeable's anchor pivot to a placed-object sprite. Footprint-
 * preserving: the sprite's rendered top-left stays at (object.x, object.y) so
 * existing placements never shift, while the sprite transform now pivots at the
 * authored anchor (consistent with the playtest renderer).
 */
const applyObjectAnchor = (
  sprite: Sprite,
  placeable: Placeable,
  object: MapObject,
  dimensions: { readonly width: number; readonly height: number },
): void => {
  const pivot = placeableAnchorPivot(placeable);
  if (pivot.x === 0 && pivot.y === 0) {
    return;
  }
  sprite.anchor.set(pivot.x, pivot.y);
  sprite.x = object.x + pivot.x * dimensions.width;
  sprite.y = object.y + pivot.y * dimensions.height;
};

/**
 * Resolve the active clip for a placement: an explicit `clipId`, else the
 * placeable's first named clip, else the implicit default `frames[]`. Per-frame
 * `loop`/`defaultDurationMs` come from the clip; the placement can override loop.
 */
const activeClipForPlacement = (
  placeable: Placeable,
  placement: MapObject['placement'],
): ActiveClip => {
  const clips = placeable.clips ?? [];
  const requestedClipId = optionValue(placement?.clipId);
  const clip =
    (requestedClipId === undefined
      ? undefined
      : clips.find((candidate) => String(candidate.id) === String(requestedClipId))) ?? clips[0];
  if (clip !== undefined) {
    return {
      frames: clip.frames,
      loop: placement?.loop ?? clip.loop,
      defaultDurationMs: clip.defaultDurationMs,
    };
  }
  return {
    frames: placeable.frames,
    loop: placement?.loop ?? true,
    defaultDurationMs: 100,
  };
};

/** Stable per-instance phase offset so identical sprites do not march in lockstep. */
const offsetForObjectId = (objectId: string): number => {
  let hash = 0;
  for (let index = 0; index < objectId.length; index += 1) {
    hash = (hash * 31 + objectId.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % 997;
};

const HIDDEN_LAYER_ALPHA = 0.18;

const layerAlpha = (layer: MapLayer | undefined): number => {
  if (layer === undefined) {
    return 1;
  }
  return layer.visible ? layer.opacity : HIDDEN_LAYER_ALPHA;
};

export interface ViewportPatch {
  readonly layerId?: LayerId;
  readonly cells?: readonly { readonly x: number; readonly y: number }[];
  readonly chunks?: readonly { readonly chunkX: number; readonly chunkY: number }[];
}

export interface EditorViewportPlaceableEntry {
  readonly packId: PackId;
  readonly placeable: Placeable;
}

export interface EditorViewportTileAtlas {
  /** tileIndex → atlas frame, precomputed from the editor index. */
  readonly tileFramesByIndex?: ReadonlyMap<number, EditorTileFrame> | undefined;
  readonly collisionMaskByTileIndex?: ReadonlyMap<number, CollisionMaskType> | undefined;
  readonly renderableAssetIdByPath: ReadonlyMap<string, AssetId | number>;
  /** Placeables aggregated across the loaded packs (for object rendering). */
  readonly placeables?: readonly EditorViewportPlaceableEntry[] | undefined;
  readonly assetPathByPackAndId?: ReadonlyMap<string, string> | undefined;
  readonly assetPathById?: ReadonlyMap<string, string> | undefined;
  /** Primary-pack autotile rules + terrain transitions (for brush-edit refresh). */
  readonly autotileRules?: readonly AutotileRule[] | undefined;
  readonly terrainTransitions?: readonly TerrainTransition[] | undefined;
}

/** Subset of a viewport asset bundle merged into a live controller post-mount. */
export interface MergeableAssetBundle {
  readonly manifest: RuntimeAssetManifest;
  readonly renderableAssetIdByPath: ReadonlyMap<string, AssetId | number>;
  readonly placeables?: readonly EditorViewportPlaceableEntry[] | undefined;
  readonly assetPathByPackAndId?: ReadonlyMap<string, string> | undefined;
  readonly assetPathById?: ReadonlyMap<string, string> | undefined;
}

/**
 * Read-only render projection for a catalog object type. Gameplay objects keep
 * their visual identity on the catalog's `visual-ref`; this projection lets the
 * viewport render that identity without duplicating it into every MapObject.
 */
export interface EditorCatalogObjectVisual {
  readonly placeableId: PlaceableId;
  readonly width: number;
  readonly height: number;
}

export class EditorViewportController {
  private readonly adapter: PixiRendererAdapter;
  private readonly worldRoot: Container;
  private readonly gridLayer: Container;
  private readonly tileLayerRoot: Container;
  private readonly objectLayerRoot: Container;
  private readonly collisionLayerRoot: Container;
  private readonly selectionLayer: Graphics;
  private readonly brushPreviewLayer: Graphics;
  private readonly gizmosLayer: Graphics;
  private readonly debugLayer: Container;
  private readonly debugText: Text;
  private readonly chunkTilemaps = new Map<string, CompositeTilemap>();
  // Brush-driven palette/placeable packs are merged in after mount (see
  // `mergeAssetBundle`), so the aggregated, cross-pack lookups are mutable.
  private placeables: readonly EditorViewportPlaceableEntry[];
  private readonly autotileRules: readonly AutotileRule[];
  private readonly terrainTransitions: readonly TerrainTransition[];
  private readonly collisionMaskByTileIndex: ReadonlyMap<number, CollisionMaskType>;
  private readonly tileFramesByIndex: ReadonlyMap<number, EditorTileFrame>;
  private readonly tileTextureCache = new Map<number, Texture>();
  private readonly objectTextureCache = new Map<string, Texture>();
  private renderableAssetIdByPath: ReadonlyMap<string, AssetId | number>;
  private assetPathByPackAndId: ReadonlyMap<string, string>;
  private assetPathById: ReadonlyMap<string, string>;
  private map: TileborneMap | undefined;
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private viewWidth = 0;
  private viewHeight = 0;
  private showGrid = true;
  private showCollision = false;
  private showDebug = false;
  // Read-only catalog footprints keyed by GameObjectTypeId (`object.kind`),
  // projected from the `catalog:resolve` DTO. Drives the placed-object footprint
  // overlay under the same "Collision" toggle as tile collision masks.
  private collisionFootprintByObjectType: ReadonlyMap<string, CollisionFootprintComponent> =
    new Map();
  private catalogVisualByObjectType: ReadonlyMap<string, EditorCatalogObjectVisual> = new Map();
  private activeLayerId: LayerId | null = null;
  private selection = new Set<EntityId>();
  private hoverTile: { x: number; y: number } | null = null;
  private brushPreview: {
    x: number;
    y: number;
    w?: number;
    h?: number;
    tileIndex?: number;
    variant?: 'paint' | 'select';
  } | null = null;
  private frameCount = 0;
  private lastFrameAt = performance.now();
  private fps = 0;
  private renderFrameHandle: number | undefined;
  // Ticker-driven sprite animation. A single shared clock advances all animated
  // object sprites; each computes its active frame by `(clock + offset) * speed`.
  private animatedSprites: AnimatedObjectSprite[] = [];
  private animationFrameHandle: number | undefined;
  private animationClockMs = 0;
  private lastAnimationTickAt: number | undefined;

  constructor(
    adapter: PixiRendererAdapter,
    atlas: EditorViewportTileAtlas = { renderableAssetIdByPath: new Map() },
  ) {
    this.adapter = adapter;
    this.placeables = atlas.placeables ?? [];
    this.autotileRules = atlas.autotileRules ?? [];
    this.terrainTransitions = atlas.terrainTransitions ?? [];
    this.collisionMaskByTileIndex = atlas.collisionMaskByTileIndex ?? new Map();
    this.renderableAssetIdByPath = atlas.renderableAssetIdByPath;
    this.assetPathByPackAndId = atlas.assetPathByPackAndId ?? new Map();
    this.assetPathById = atlas.assetPathById ?? new Map();
    this.tileFramesByIndex = atlas.tileFramesByIndex ?? new Map();
    this.worldRoot = adapter.getEditorWorldRoot();
    this.tileLayerRoot = this.makeLayer('tiles', EditorLayerZIndex.tileChunks);
    this.objectLayerRoot = this.makeLayer('objects', EditorLayerZIndex.objectSprites);
    this.gridLayer = this.makeLayer('grid', EditorLayerZIndex.gridOverlay);
    this.collisionLayerRoot = this.makeLayer('collision', EditorLayerZIndex.collisionOverlay);
    this.selectionLayer = new Graphics();
    this.selectionLayer.label = 'selection';
    this.selectionLayer.zIndex = EditorLayerZIndex.selectionOverlay;
    this.brushPreviewLayer = new Graphics();
    this.brushPreviewLayer.label = 'brush-preview';
    this.brushPreviewLayer.zIndex = EditorLayerZIndex.brushPreview;
    this.gizmosLayer = new Graphics();
    this.gizmosLayer.label = 'gizmos';
    this.gizmosLayer.zIndex = EditorLayerZIndex.gizmos;
    this.debugLayer = this.makeLayer('debug', EditorLayerZIndex.debugOverlay);
    this.debugText = new Text({
      text: '',
      style: { fill: 0xffffff, fontSize: 11, fontFamily: 'monospace' },
    });
    this.debugLayer.addChild(this.debugText);
    this.worldRoot.addChild(this.selectionLayer, this.brushPreviewLayer, this.gizmosLayer);
  }

  setMap(map: TileborneMap): void {
    this.map = map;
    this.renderAllChunks();
    this.renderObjects();
    this.renderGrid();
    this.requestRender();
  }

  /** Updates the authoritative map without rebuilding all viewport layers. */
  syncMapContent(map: TileborneMap): void {
    this.map = map;
  }

  /**
   * Adds the renderable assets of a brush-driven palette/placeable bundle into
   * the already-mounted viewport WITHOUT tearing down the adapter or rebuilding
   * tile chunks. Switching the working-palette selection must never remount, so
   * extra-pack atlases and selected-placeable frames stream in here instead of
   * re-running the mount effect.
   *
   * The map pack is always the bundle's primary pack, so its atlas keeps stable
   * renderable ids; only object sprites are rebuilt to pick up new textures.
   */
  async mergeAssetBundle(bundle: MergeableAssetBundle): Promise<void> {
    await Effect.runPromise(this.adapter.loadAssets(bundle.manifest));
    this.placeables = bundle.placeables ?? this.placeables;
    this.renderableAssetIdByPath = bundle.renderableAssetIdByPath;
    this.assetPathByPackAndId = bundle.assetPathByPackAndId ?? this.assetPathByPackAndId;
    this.assetPathById = bundle.assetPathById ?? this.assetPathById;
    // Texture instances were re-registered against the new bundle; drop derived
    // sub-texture caches so the next render rebuilds them from current sources.
    this.objectTextureCache.clear();
    this.tileTextureCache.clear();
    this.renderObjects();
    this.requestRender();
  }

  patchChunk(layerId: LayerId, chunkX: number, chunkY: number, requestRender = true): void {
    if (!this.map) {
      return;
    }
    const layer = findLayerById(this.map, layerId);
    if (layer?._tag === 'tile') {
      this.renderChunk(layerId, chunkX, chunkY);
    } else if (layer?._tag === 'collision') {
      this.renderCollision();
    }
    if (requestRender) {
      this.requestRender();
    }
  }

  patchFromCommand(patch?: ViewportPatch): void {
    if (!this.map) {
      return;
    }
    if (patch?.layerId !== undefined && patch.chunks !== undefined) {
      for (const chunk of this.chunksForPatch(patch)) {
        this.patchChunk(patch.layerId, chunk.chunkX, chunk.chunkY, false);
      }
      this.requestRender();
      return;
    }
    this.renderAllChunks();
    this.renderObjects();
    this.renderCollision();
    this.requestRender();
  }

  setCamera(zoom: number, panX: number, panY: number): void {
    this.zoom = zoom;
    this.panX = panX;
    this.panY = panY;
    this.worldRoot.scale.set(zoom);
    this.worldRoot.position.set(panX, panY);
    this.updateVisibleChunks();
    this.requestRender();
  }

  setShowGrid(show: boolean): void {
    this.showGrid = show;
    this.renderGrid();
    this.requestRender();
  }

  setShowCollision(show: boolean): void {
    this.showCollision = show;
    this.renderCollision();
    this.requestRender();
  }

  /**
   * Supplies the read-only catalog collision footprints (keyed by
   * `GameObjectTypeId`) projected from the `catalog:resolve` DTO. Placed objects
   * whose type carries a `CollisionFootprintComponent` then draw their footprint
   * in the viewport, gated by the same "Collision" overlay toggle as tile masks
   * (ADR-0025 slice 6 / decisions `c-q83p`, `c-cgsd`).
   */
  setCollisionFootprints(footprints: ReadonlyMap<string, CollisionFootprintComponent>): void {
    this.collisionFootprintByObjectType = footprints;
    this.renderCollision();
    this.requestRender();
  }

  /**
   * Supplies catalog-owned visuals keyed by `MapObject.kind`. Explicit
   * `MapObject.placement` sprites still win; this is the canonical fallback for
   * gameplay objects such as spawn points, loot crates, and traps.
   */
  setCatalogObjectVisuals(visuals: ReadonlyMap<string, EditorCatalogObjectVisual>): void {
    this.catalogVisualByObjectType = visuals;
    this.renderObjects();
    this.requestRender();
  }

  setShowDebug(show: boolean): void {
    this.showDebug = show;
    this.debugLayer.visible = show;
    this.requestRender();
  }

  setActiveLayerId(layerId: LayerId | null): void {
    if (this.activeLayerId === layerId) {
      return;
    }
    this.activeLayerId = layerId;
    this.renderAllChunks();
    this.renderObjects();
    this.requestRender();
  }

  setSelection(selection: Set<EntityId>): void {
    this.selection = selection;
    this.renderSelection();
    this.requestRender();
  }

  setHoverTile(tile: { x: number; y: number } | null): void {
    if (
      this.hoverTile?.x === tile?.x &&
      this.hoverTile?.y === tile?.y &&
      (this.hoverTile !== null) === (tile !== null)
    ) {
      return;
    }
    this.hoverTile = tile;
    this.renderDebug();
    this.requestRender();
  }

  setBrushPreview(
    preview: {
      x: number;
      y: number;
      w?: number;
      h?: number;
      tileIndex?: number;
      variant?: 'paint' | 'select';
    } | null,
  ): void {
    if (
      this.brushPreview?.x === preview?.x &&
      this.brushPreview?.y === preview?.y &&
      this.brushPreview?.w === preview?.w &&
      this.brushPreview?.h === preview?.h &&
      this.brushPreview?.tileIndex === preview?.tileIndex &&
      this.brushPreview?.variant === preview?.variant &&
      (this.brushPreview !== null) === (preview !== null)
    ) {
      return;
    }
    this.brushPreview = preview;
    this.renderBrushPreview();
    this.requestRender();
  }

  resize(width: number, height: number): void {
    this.viewWidth = width;
    this.viewHeight = height;
    void Effect.runPromise(this.adapter.resize(width, height)).then(() => {
      this.updateVisibleChunks();
      this.requestRender();
    });
  }

  async dispose(): Promise<void> {
    if (this.renderFrameHandle !== undefined) {
      cancelFrame(this.renderFrameHandle);
      this.renderFrameHandle = undefined;
    }
    this.stopAnimationLoop();
    this.animatedSprites = [];
    this.chunkTilemaps.clear();
    this.tileTextureCache.clear();
    this.map = undefined;
    await Effect.runPromise(this.adapter.dispose());
  }

  requestRender(): void {
    if (this.renderFrameHandle !== undefined) {
      return;
    }
    this.renderFrameHandle = scheduleFrame(() => {
      this.renderFrameHandle = undefined;
      this.renderNow();
    });
  }

  private renderNow(): void {
    this.tickDebugOverlay();
    void Effect.runPromise(this.adapter.requestRender());
  }

  /**
   * Advance the shared animation clock and swap each animated sprite's texture
   * to the frame active at the current clock. Reused by both the sustained
   * animation loop and the per-rebuild initial frame application.
   */
  private applyAnimationFrame(): void {
    for (const animated of this.animatedSprites) {
      const index = resolveClipFrameIndex(animated.clip, this.animationClockMs, {
        speed: animated.speed,
        offsetMs: animated.offsetMs,
      });
      const texture = animated.textures[index];
      if (texture !== undefined && animated.sprite.texture !== texture) {
        animated.sprite.texture = texture;
      }
    }
  }

  /**
   * Sustains a single shared render loop while animated sprites are present.
   * Stops automatically once no animated sprites remain so a static map never
   * burns frames. This intentionally reuses one clock for all sprites rather
   * than per-sprite Pixi tickers.
   */
  private ensureAnimationLoop(): void {
    if (this.animatedSprites.length === 0) {
      this.stopAnimationLoop();
      return;
    }
    if (this.animationFrameHandle !== undefined) {
      return;
    }
    this.lastAnimationTickAt = performance.now();
    const tick = (): void => {
      this.animationFrameHandle = scheduleFrame(() => {
        const now = performance.now();
        this.animationClockMs += now - (this.lastAnimationTickAt ?? now);
        this.lastAnimationTickAt = now;
        this.applyAnimationFrame();
        void Effect.runPromise(this.adapter.requestRender());
        if (this.animatedSprites.length > 0) {
          tick();
        } else {
          this.animationFrameHandle = undefined;
        }
      });
    };
    tick();
  }

  private stopAnimationLoop(): void {
    if (this.animationFrameHandle !== undefined) {
      cancelFrame(this.animationFrameHandle);
      this.animationFrameHandle = undefined;
    }
    this.lastAnimationTickAt = undefined;
  }

  /**
   * Advances the FPS counter and refreshes the debug-overlay text for one
   * rendered frame. The editor render loop runs this from `renderNow`. The
   * playtest viewports drive the adapter directly via `renderFromEntities`,
   * bypassing `renderNow`, so they must call this per frame — otherwise the
   * debug layer is shown but its FPS/Draw/Hover readout never updates.
   */
  tickDebugOverlay(): void {
    this.frameCount += 1;
    const now = performance.now();
    if (now - this.lastFrameAt >= 500) {
      this.fps = Math.round((this.frameCount * 1000) / (now - this.lastFrameAt));
      this.frameCount = 0;
      this.lastFrameAt = now;
    }
    this.renderDebug();
  }

  private makeLayer(label: string, zIndex: number): Container {
    const layer = new Container();
    layer.label = label;
    layer.zIndex = zIndex;
    this.worldRoot.addChild(layer);
    return layer;
  }

  private renderGrid(): void {
    this.gridLayer.removeChildren();
    if (!this.map || !this.showGrid) {
      return;
    }
    const map = this.map;
    const graphics = new Graphics();
    const tileW = map.tileSize.width;
    const tileH = map.tileSize.height;
    const mapW = map.size.width * tileW;
    const mapH = map.size.height * tileH;
    const drawGridPath = () => {
      for (let x = 0; x <= map.size.width; x += 1) {
        graphics.moveTo(x * tileW, 0);
        graphics.lineTo(x * tileW, mapH);
      }
      for (let y = 0; y <= map.size.height; y += 1) {
        graphics.moveTo(0, y * tileH);
        graphics.lineTo(mapW, y * tileH);
      }
    };
    drawGridPath();
    graphics.stroke({ width: 2, color: EDITOR_GRID_OUTLINE_COLOR, alpha: 0.45 });
    drawGridPath();
    graphics.stroke({ width: 1, color: EDITOR_GRID_STROKE_COLOR, alpha: 0.55 });
    this.gridLayer.addChild(graphics);
  }

  private renderAllChunks(): void {
    if (!this.map) {
      return;
    }
    // Full reset path (map/layer swap): drop every built chunk so stale alpha and
    // content can be rebuilt, then build only the chunks inside the visible set.
    this.tileLayerRoot.removeChildren();
    this.chunkTilemaps.clear();
    const hasTileLayer = this.map.layers.some((layer) => layer._tag === 'tile');
    if (!hasTileLayer) {
      return;
    }
    this.updateVisibleChunks();
    this.renderCollision();
  }

  /**
   * Chunk-origin bounding box (tile coords) intersecting the viewport plus one
   * chunk of padding on every side. Returns `undefined` when canvas dimensions
   * are unknown (before the first resize / headless tests), meaning "no culling
   * — every chunk is visible" so small maps still render fully.
   */
  private visibleChunkBounds():
    | { readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number }
    | undefined {
    const map = this.map;
    if (!map || !(this.viewWidth > 0 && this.viewHeight > 0 && this.zoom > 0)) {
      return undefined;
    }
    const tileW = map.tileSize.width;
    const tileH = map.tileSize.height;
    // Visible world rect = inverse of the worldRoot pan/zoom over the canvas.
    const worldMinX = -this.panX / this.zoom;
    const worldMinY = -this.panY / this.zoom;
    const worldMaxX = (this.viewWidth - this.panX) / this.zoom;
    const worldMaxY = (this.viewHeight - this.panY) / this.zoom;
    const chunkOriginFor = (tile: number): number => Math.floor(tile / CHUNK_SIZE) * CHUNK_SIZE;
    return {
      minX: chunkOriginFor(Math.floor(worldMinX / tileW)) - CHUNK_SIZE,
      maxX: chunkOriginFor(Math.floor(worldMaxX / tileW)) + CHUNK_SIZE,
      minY: chunkOriginFor(Math.floor(worldMinY / tileH)) - CHUNK_SIZE,
      maxY: chunkOriginFor(Math.floor(worldMaxY / tileH)) + CHUNK_SIZE,
    };
  }

  /** Builds chunk containers entering the visible set and destroys ones leaving it. */
  private updateVisibleChunks(): void {
    if (!this.map) {
      return;
    }
    const bounds = this.visibleChunkBounds();
    const isVisible = (chunkX: number, chunkY: number): boolean =>
      bounds === undefined ||
      (chunkX >= bounds.minX &&
        chunkX <= bounds.maxX &&
        chunkY >= bounds.minY &&
        chunkY <= bounds.maxY);
    const wanted = new Set<string>();
    for (const layer of this.map.layers) {
      if (layer._tag !== 'tile') {
        continue;
      }
      for (const chunk of layer.chunks) {
        if (!isVisible(chunk.x, chunk.y)) {
          continue;
        }
        const key = `${layer.id}:${chunk.x}:${chunk.y}`;
        wanted.add(key);
        if (!this.chunkTilemaps.has(key)) {
          this.renderChunk(layer.id, chunk.x, chunk.y);
        }
      }
    }
    for (const [key, tilemap] of this.chunkTilemaps) {
      if (!wanted.has(key)) {
        tilemap.removeFromParent();
        this.chunkTilemaps.delete(key);
      }
    }
  }

  private chunksForPatch(
    patch: ViewportPatch,
  ): readonly { readonly chunkX: number; readonly chunkY: number }[] {
    const chunks = new Map<string, { readonly chunkX: number; readonly chunkY: number }>();
    const addChunk = (chunkX: number, chunkY: number): void => {
      chunks.set(`${chunkX}:${chunkY}`, { chunkX, chunkY });
    };

    for (const chunk of patch.chunks ?? []) {
      addChunk(chunk.chunkX, chunk.chunkY);
    }

    if (!this.map || patch.cells === undefined) {
      return [...chunks.values()];
    }

    for (const cell of this.refreshCellsForBrushEdit(patch.cells)) {
      if (
        cell.x < 0 ||
        cell.y < 0 ||
        cell.x >= this.map.size.width ||
        cell.y >= this.map.size.height
      ) {
        continue;
      }
      addChunk(Math.floor(cell.x / 32) * 32, Math.floor(cell.y / 32) * 32);
    }

    return [...chunks.values()];
  }

  private refreshCellsForBrushEdit(
    changedCells: readonly { readonly x: number; readonly y: number }[],
  ): readonly GridCell[] {
    const cells = new Map<string, GridCell>();
    const addCell = (cell: GridCell): void => {
      cells.set(`${cell.x}:${cell.y}`, cell);
    };

    const rules = this.autotileRules;
    const transitions = this.terrainTransitions;
    const ruleForId = (ruleId: (typeof rules)[number]['id']) =>
      rules.find((rule) => String(rule.id) === String(ruleId));

    for (const changedCell of changedCells) {
      addCell(changedCell);
      for (const rule of rules) {
        for (const cell of cellsNeedingRefresh(changedCell, neighborhoodForRule(rule))) {
          addCell(cell);
        }
      }
      for (const cell of transitionCellsToRefresh({
        changedCell,
        transitions,
        ruleForId,
      })) {
        addCell(cell);
      }
    }

    return [...cells.values()];
  }

  private renderChunk(layerId: LayerId, chunkX: number, chunkY: number): void {
    if (!this.map) {
      return;
    }
    const layer = findLayerById(this.map, layerId);
    if (!layer || layer._tag !== 'tile') {
      return;
    }
    const chunk = layer.chunks.find((entry) => entry.x === chunkX && entry.y === chunkY);
    const key = `${layerId}:${chunkX}:${chunkY}`;
    // @pixi/tilemap's update model is clear + re-add (no per-tile mutation), so an
    // edit rebuilds the whole chunk: drop the previous tilemap and build a fresh one.
    this.chunkTilemaps.get(key)?.removeFromParent();
    const tilemap = new CompositeTilemap();
    tilemap.label = key;
    tilemap.alpha = layerAlpha(layer);
    const tileW = this.map.tileSize.width;
    const tileH = this.map.tileSize.height;
    const diagnostics = new Graphics();
    let usedDiagnosticGraphics = false;
    if (chunk) {
      for (let localY = 0; localY < chunk.height; localY += 1) {
        for (let localX = 0; localX < chunk.width; localX += 1) {
          const index = chunk.tiles[localY * chunk.width + localX] ?? 0;
          if (index === 0) {
            continue;
          }
          const x = (chunk.x + localX) * tileW;
          const y = (chunk.y + localY) * tileH;
          const texture = this.textureForTileIndex(index);
          if (texture) {
            tilemap.tile(texture, x, y, { tileWidth: tileW, tileHeight: tileH });
          } else {
            diagnostics.rect(x, y, tileW, tileH);
            diagnostics.fill({ color: missingTileTextureDiagnosticColor(index), alpha: 0.22 });
            diagnostics.stroke({
              width: 1,
              color: MISSING_TILE_TEXTURE_DIAGNOSTIC_COLOR,
              alpha: 0.85,
            });
            usedDiagnosticGraphics = true;
          }
        }
      }
    }
    // Unresolved tiles keep a visible diagnostic overlay layered above the batch.
    if (usedDiagnosticGraphics) {
      tilemap.addChild(diagnostics);
    }
    this.chunkTilemaps.set(key, tilemap);
    this.tileLayerRoot.addChild(tilemap);
  }

  private textureForTileIndex(tileIndex: number): Texture | undefined {
    const cached = this.tileTextureCache.get(tileIndex);
    if (cached) {
      return cached;
    }
    const frame = this.tileFramesByIndex.get(tileIndex);
    if (!frame) {
      return undefined;
    }
    const renderableAssetId = this.renderableAssetIdByPath.get(frame.assetPath);
    if (renderableAssetId === undefined) {
      return undefined;
    }
    const atlasTexture = this.adapter.textureForRenderableAssetId(renderableAssetId);
    if (!atlasTexture) {
      return undefined;
    }
    const texture = new Texture({
      source: atlasTexture.source,
      frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
    });
    this.tileTextureCache.set(tileIndex, texture);
    return texture;
  }

  private renderObjects(): void {
    this.objectLayerRoot.removeChildren();
    // Sprites are recreated below; drop the previous animation registry so it
    // never references detached sprites.
    this.animatedSprites = [];
    if (!this.map) {
      this.ensureAnimationLoop();
      return;
    }
    const layerById = new Map(this.map.layers.map((layer) => [layer.id, layer] as const));
    for (const object of this.map.objects) {
      const objectLayer = layerById.get(object.layerId);
      if (objectLayer?._tag !== 'object') {
        continue;
      }
      const graphic = this.objectGraphic(object);
      graphic.alpha = layerAlpha(objectLayer);
      this.objectLayerRoot.addChild(graphic);
    }
    this.applyAnimationFrame();
    this.ensureAnimationLoop();
  }

  private objectGraphic(object: MapObject): Container {
    const container = new Container();
    const dimensions = this.objectDimensions(object);
    const placementSprite = this.spriteForObjectPlacement(object, dimensions);
    if (placementSprite !== undefined) {
      container.addChild(placementSprite);
      return container;
    }

    const graphics = new Graphics();
    if (object.kind === TRIGGER_REGION_OBJECT_TYPE_ID) {
      graphics.rect(object.x, object.y, dimensions.width, dimensions.height);
      graphics.fill({ color: 0x5c7a8a, alpha: 0.25 });
      graphics.stroke({ width: 2, color: 0x5c7a8a, alpha: 0.8 });
    } else {
      graphics.circle(
        object.x + dimensions.width / 2,
        object.y + dimensions.height / 2,
        Math.min(dimensions.width, dimensions.height) / 3,
      );
      graphics.fill({ color: 0xf08a3c, alpha: 0.85 });
    }
    container.addChild(graphics);
    return container;
  }

  private objectDimensions(object: MapObject): { readonly width: number; readonly height: number } {
    const placement = object.placement;
    const catalogVisual = this.catalogVisualByObjectType.get(String(object.kind));
    const placementPackId = optionValue(placement?.packId);
    const placeable =
      placement === undefined
        ? undefined
        : this.placeables
            .filter((entry) => placementPackId === undefined || entry.packId === placementPackId)
            .map((entry) => entry.placeable)
            .find((candidate) => candidate.id === placement.placeableId);
    const tileW = this.map?.tileSize.width ?? 32;
    const tileH = this.map?.tileSize.height ?? 32;
    const legacyWidth =
      typeof object.properties.tileWidth === 'number' ? object.properties.tileWidth * tileW : tileW;
    const legacyHeight =
      typeof object.properties.tileHeight === 'number'
        ? object.properties.tileHeight * tileH
        : tileH;
    return {
      width:
        optionValue(object.width) ?? placeable?.size.width ?? catalogVisual?.width ?? legacyWidth,
      height:
        optionValue(object.height) ??
        placeable?.size.height ??
        catalogVisual?.height ??
        legacyHeight,
    };
  }

  private spriteForObjectPlacement(
    object: MapObject,
    dimensions: { readonly width: number; readonly height: number },
  ): Sprite | undefined {
    const placement = object.placement;
    const catalogVisual = this.catalogVisualByObjectType.get(String(object.kind));
    const placeableId = placement?.placeableId ?? catalogVisual?.placeableId;
    if (placeableId === undefined) {
      return undefined;
    }
    const placementPackId = optionValue(placement?.packId);
    const placeableEntry = this.placeables
      .filter((entry) => placementPackId === undefined || entry.packId === placementPackId)
      .find((candidate) => candidate.placeable.id === placeableId);
    if (placeableEntry === undefined) {
      return undefined;
    }
    const placeable = placeableEntry.placeable;
    const placeablePackId = placeableEntry.packId;

    const textureForFrame = (frame: PlaceableFrameRef): Texture | undefined => {
      const assetPath =
        this.assetPathByPackAndId.get(`${placeablePackId}:${frame.assetId}`) ??
        this.assetPathById.get(String(frame.assetId));
      if (assetPath === undefined) {
        return undefined;
      }
      const cacheKey = `${placeablePackId}:${frame.assetId}:${frame.tileId}:${frame.uv.x}:${frame.uv.y}:${frame.uv.w}:${frame.uv.h}`;
      const cached = this.objectTextureCache.get(cacheKey);
      return cached ?? this.textureForObjectFrame(cacheKey, assetPath, frame.uv);
    };

    const activeClip = activeClipForPlacement(placeable, placement);
    const autoplay = placement?.autoplay ?? true;
    const animated = autoplay && activeClip.frames.length > 1;

    if (animated) {
      const textures: Texture[] = [];
      for (const clipFrame of activeClip.frames) {
        const texture = textureForFrame(clipFrame);
        if (texture !== undefined) {
          textures.push(texture);
        }
      }
      if (textures.length > 1) {
        const clip = compileClipTimeline(
          activeClip.frames.map((clipFrame) => optionValue(clipFrame.durationMs)),
          { loop: activeClip.loop, defaultDurationMs: activeClip.defaultDurationMs },
        );
        const offsetMs = offsetForObjectId(String(object.id));
        const speed = placement?.speed ?? 1;
        const initialIndex = resolveClipFrameIndex(clip, this.animationClockMs, {
          speed,
          offsetMs,
        });
        const sprite = new Sprite({ texture: textures[initialIndex] ?? textures[0]! });
        sprite.x = object.x;
        sprite.y = object.y;
        sprite.width = dimensions.width;
        sprite.height = dimensions.height;
        applyObjectAnchor(sprite, placeable, object, dimensions);
        this.animatedSprites.push({ sprite, textures, clip, speed, offsetMs });
        return sprite;
      }
    }

    // Static fallback: respect the placement's pinned asset/tile selection.
    const placementAssetId = optionValue(placement?.assetId);
    const placementTileId = optionValue(placement?.tileId);
    const frame =
      activeClip.frames.find(
        (candidate) =>
          (placementAssetId === undefined || candidate.assetId === placementAssetId) &&
          (placementTileId === undefined || candidate.tileId === placementTileId),
      ) ??
      activeClip.frames[0] ??
      placeable.frames[0];
    if (frame === undefined) {
      return undefined;
    }
    const texture = textureForFrame(frame);
    if (texture === undefined) {
      return undefined;
    }
    const sprite = new Sprite({ texture });
    sprite.x = object.x;
    sprite.y = object.y;
    sprite.width = dimensions.width;
    sprite.height = dimensions.height;
    applyObjectAnchor(sprite, placeable, object, dimensions);
    return sprite;
  }

  private textureForObjectFrame(
    cacheKey: string,
    assetPath: string,
    uv: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  ): Texture | undefined {
    const renderableAssetId = this.renderableAssetIdByPath.get(assetPath);
    if (renderableAssetId === undefined) {
      return undefined;
    }
    const atlasTexture = this.adapter.textureForRenderableAssetId(renderableAssetId);
    if (!atlasTexture) {
      return undefined;
    }
    const texture = new Texture({
      source: atlasTexture.source,
      frame: new Rectangle(uv.x, uv.y, uv.w, uv.h),
    });
    this.objectTextureCache.set(cacheKey, texture);
    return texture;
  }

  private renderCollision(): void {
    this.collisionLayerRoot.removeChildren();
    if (!this.map || !this.showCollision) {
      return;
    }
    const graphics = new Graphics();
    const tileW = this.map.tileSize.width;
    const tileH = this.map.tileSize.height;
    for (const layer of this.map.layers) {
      if (layer._tag !== 'tile' || !layer.visible) {
        continue;
      }
      for (const chunk of layer.chunks) {
        for (let localY = 0; localY < chunk.height; localY += 1) {
          for (let localX = 0; localX < chunk.width; localX += 1) {
            const tileIndex = chunk.tiles[localY * chunk.width + localX] ?? 0;
            const mask = this.collisionMaskByTileIndex.get(tileIndex);
            if (tileIndex === 0 || mask === undefined || !collisionMaskBlocksMovement(mask)) {
              continue;
            }
            graphics.rect((chunk.x + localX) * tileW, (chunk.y + localY) * tileH, tileW, tileH);
            graphics.fill({ color: COLLISION_OVERLAY_FILL_COLOR, alpha: 0.35 });
          }
        }
      }
    }
    this.collisionLayerRoot.addChild(graphics);
    this.renderObjectFootprints();
  }

  /**
   * Draws each placed object's read-only catalog collision footprint, shifted by
   * its per-instance offset. Shares the "Collision" overlay (callers gate on
   * `showCollision` before this runs) and the collision red, but adds an outline
   * so a footprint reads distinctly from a tile mask. Only visible object layers
   * contribute, mirroring how tile masks honor layer visibility. The footprint
   * child is added only when at least one footprint is drawn, so objects without
   * a footprint component contribute nothing.
   */
  private renderObjectFootprints(): void {
    if (!this.map || this.collisionFootprintByObjectType.size === 0) {
      return;
    }
    const layerById = new Map(this.map.layers.map((layer) => [layer.id, layer] as const));
    const graphics = new Graphics();
    let drewFootprint = false;
    for (const object of this.map.objects) {
      const objectLayer = layerById.get(object.layerId);
      if (objectLayer?._tag !== 'object' || !objectLayer.visible) {
        continue;
      }
      const footprint = this.collisionFootprintByObjectType.get(String(object.kind));
      if (footprint === undefined) {
        continue;
      }
      for (const rect of positionedFootprintRects(object, footprint.parts)) {
        graphics.rect(rect.x, rect.y, rect.width, rect.height);
        graphics.fill({ color: COLLISION_OVERLAY_FILL_COLOR, alpha: 0.3 });
        graphics.stroke({ width: 1, color: COLLISION_FOOTPRINT_STROKE_COLOR, alpha: 0.9 });
        drewFootprint = true;
      }
    }
    if (!drewFootprint) {
      return;
    }
    graphics.label = OBJECT_FOOTPRINT_LAYER_LABEL;
    this.collisionLayerRoot.addChild(graphics);
  }

  private renderSelection(): void {
    this.selectionLayer.clear();
    if (!this.map) {
      return;
    }
    const tileW = this.map.tileSize.width;
    const tileH = this.map.tileSize.height;
    const objectsById = new Map<string, MapObject>(
      this.map.objects.map((object) => [String(object.id), object]),
    );
    for (const entityId of this.selection) {
      const object = objectsById.get(String(entityId));
      if (object) {
        const { width, height } = this.objectDimensions(object);
        this.selectionLayer.rect(object.x, object.y, width, height);
        this.selectionLayer.fill({ color: 0xf08a3c, alpha: 0.25 });
        this.selectionLayer.stroke({ width: 2, color: 0xf08a3c });
        continue;
      }
      const [tileXRaw, tileYRaw] = entityId.split(':');
      const tileX = Number(tileXRaw);
      const tileY = Number(tileYRaw);
      if (Number.isFinite(tileX) && Number.isFinite(tileY)) {
        this.selectionLayer.rect(tileX * tileW, tileY * tileH, tileW, tileH);
        this.selectionLayer.fill({ color: 0xf08a3c, alpha: 0.25 });
        this.selectionLayer.stroke({ width: 2, color: 0xf08a3c });
      }
    }
  }

  private renderBrushPreview(): void {
    this.brushPreviewLayer.clear();
    if (!this.map || !this.brushPreview) {
      return;
    }
    const tileW = this.map.tileSize.width;
    const tileH = this.map.tileSize.height;
    const { x, y, w = 1, h = 1, tileIndex = 1, variant = 'paint' } = this.brushPreview;
    this.brushPreviewLayer.rect(x * tileW, y * tileH, w * tileW, h * tileH);
    if (variant === 'select') {
      // Marquee for the select tool: mirror the committed-selection color so the
      // dragged area reads as "what will be selected", not a paint fill.
      this.brushPreviewLayer.fill({ color: 0xf08a3c, alpha: 0.2 });
      this.brushPreviewLayer.stroke({ width: 2, color: 0xf08a3c });
      return;
    }
    this.brushPreviewLayer.fill({ color: tileColor(tileIndex), alpha: 0.45 });
    this.brushPreviewLayer.stroke({ width: 1, color: 0xffffff, alpha: 0.6 });
  }

  private renderDebug(): void {
    if (!this.showDebug) {
      return;
    }
    const hover = this.hoverTile;
    const objectCount = this.map?.objects.length ?? 0;
    this.debugText.text = `FPS ${this.fps}\nDraw ${this.chunkTilemaps.size + objectCount}\nHover ${hover ? `${hover.x},${hover.y}` : '—'}`;
  }
}

export const tileCoordsFromPointer = (
  map: TileborneMap,
  zoom: number,
  panX: number,
  panY: number,
  clientX: number,
  clientY: number,
  bounds: DOMRect,
): { x: number; y: number } => {
  const localX = (clientX - bounds.left - panX) / zoom;
  const localY = (clientY - bounds.top - panY) / zoom;
  const tileX = Math.floor(localX / map.tileSize.width);
  const tileY = Math.floor(localY / map.tileSize.height);
  return {
    x: Math.max(0, Math.min(map.size.width - 1, tileX)),
    y: Math.max(0, Math.min(map.size.height - 1, tileY)),
  };
};
