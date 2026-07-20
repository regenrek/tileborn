import type { ComponentType } from 'react';
import { create } from 'zustand';
import { PERSISTED_SCHEMA_VERSIONS } from '@tileborne/core';
import { createJSONStorage, persist, subscribeWithSelector } from 'zustand/middleware';

import type { LayerId, PackId } from '@tileborne/core';
import type {
  AutotileRuleIdType,
  ClipIdType,
  PlaceableIdType,
  TerrainClassType,
  TileIdType,
} from '@tileborne/sdk-tileset/schemas';

import { assertNever } from '@/lib/assert-never';
import type { BottomDrawerTabValue } from '@/components/bottom-drawer/constants';
import { normalizeOptionalRouteParam, normalizeRouteParam } from '@/lib/route-params';

export type EntityId = string;

export type EditorTool =
  | 'select'
  | 'pan'
  | 'tileBrush'
  | 'rectangleFill'
  | 'eraser'
  | 'objectPlace'
  | 'objectMove'
  | 'collisionPaint'
  | 'regionMark';

export type ThemePreference = 'light' | 'dark' | 'system';

export type WorkspaceTabKind =
  | 'map'
  | 'overview'
  | 'assets'
  | 'plugins'
  | 'settings'
  | 'player-model-editor'
  | 'entity-editor'
  | 'game-content'
  | 'game-shell'
  | 'behaviors';

export interface WorkspaceTab {
  readonly id: string;
  readonly kind: WorkspaceTabKind;
  readonly projectId?: string;
  readonly mapId?: string;
}

const CURRENT_WORKSPACE_TAB_KINDS = new Set<WorkspaceTabKind>([
  'map',
  'overview',
  'assets',
  'plugins',
  'settings',
  'player-model-editor',
  'entity-editor',
  'game-content',
  'game-shell',
  'behaviors',
]);

const isWorkspaceTabRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const normalizeWorkspaceTabKind = (kind: unknown): WorkspaceTabKind | undefined => {
  if (typeof kind !== 'string') {
    return undefined;
  }
  if (CURRENT_WORKSPACE_TAB_KINDS.has(kind as WorkspaceTabKind)) {
    return kind as WorkspaceTabKind;
  }
  return undefined;
};

const normalizeWorkspaceTabRouteParam = (value: unknown): string | undefined =>
  typeof value === 'string' ? normalizeOptionalRouteParam(value) : undefined;

export function workspaceTabId(tab: {
  kind: WorkspaceTabKind;
  projectId?: string;
  mapId?: string;
}): string {
  switch (tab.kind) {
    case 'map':
      return `map:${tab.projectId ?? ''}:${tab.mapId ?? ''}`;
    case 'overview':
      return `overview:${tab.projectId ?? ''}`;
    case 'assets':
      return `assets:${tab.projectId ?? ''}`;
    case 'plugins':
      return `plugins:${tab.projectId ?? ''}`;
    case 'settings':
      return `settings:${tab.projectId ?? 'global'}`;
    case 'player-model-editor':
      return `player-model-editor:${tab.projectId ?? ''}`;
    case 'entity-editor':
      return `entity-editor:${tab.projectId ?? ''}`;
    case 'game-content':
      return `game-content:${tab.projectId ?? ''}`;
    case 'game-shell':
      return `game-shell:${tab.projectId ?? ''}`;
    case 'behaviors':
      return `behaviors:${tab.projectId ?? ''}`;
  }
}

export function normalizeWorkspaceTabs(tabs: readonly unknown[]): WorkspaceTab[] {
  const normalized: WorkspaceTab[] = [];
  const seen = new Set<string>();

  for (const tab of tabs) {
    if (!isWorkspaceTabRecord(tab)) {
      continue;
    }
    const kind = normalizeWorkspaceTabKind(tab.kind);
    if (kind === undefined) {
      continue;
    }
    const projectId = normalizeWorkspaceTabRouteParam(tab.projectId);
    const mapId = normalizeWorkspaceTabRouteParam(tab.mapId);

    if (kind === 'map' && (!projectId || !mapId)) {
      continue;
    }
    if (
      (kind === 'overview' ||
        kind === 'assets' ||
        kind === 'plugins' ||
        kind === 'player-model-editor' ||
        kind === 'entity-editor' ||
        kind === 'game-content' ||
        kind === 'game-shell' ||
        kind === 'behaviors') &&
      !projectId
    ) {
      continue;
    }

    const id = workspaceTabId({
      kind,
      ...(projectId === undefined ? {} : { projectId }),
      ...(mapId === undefined ? {} : { mapId }),
    });
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    normalized.push({
      id,
      kind,
      ...(projectId === undefined ? {} : { projectId }),
      ...(kind === 'map' && mapId !== undefined ? { mapId } : {}),
    });
  }

  return normalized;
}

const normalizeRecentProjectIds = (projectIds: readonly string[]): string[] => {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const projectId of projectIds) {
    const next = normalizeRouteParam(projectId);
    if (seen.has(next)) {
      continue;
    }
    seen.add(next);
    normalized.push(next);
  }

  return normalized.slice(0, 12);
};

const normalizeRecentProjectMaps = (
  projectMaps: Record<string, string>,
): Record<string, string> => {
  const normalized: Record<string, string> = {};
  for (const [projectId, mapId] of Object.entries(projectMaps)) {
    normalized[normalizeRouteParam(projectId)] = normalizeRouteParam(mapId);
  }
  return normalized;
};

const workspaceTabsEqual = (
  left: readonly WorkspaceTab[],
  right: readonly WorkspaceTab[],
): boolean =>
  left.length === right.length &&
  left.every((tab, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      tab.id === other.id &&
      tab.kind === other.kind &&
      tab.projectId === other.projectId &&
      tab.mapId === other.mapId
    );
  });

/**
 * Icon component contributed for a `plugin-object` palette action. Typed as a
 * minimal React component (only `className` is required) so the store stays
 * decoupled from any specific icon library and from any plugin.
 */
export type PaletteActionIcon = ComponentType<{ readonly className?: string }>;

export type BrushIntent =
  | { readonly kind: 'tile'; readonly tileId: TileIdType; readonly packId?: PackId | undefined }
  | {
      readonly kind: 'autotile';
      readonly ruleId: AutotileRuleIdType;
      readonly packId?: PackId | undefined;
    }
  | {
      readonly kind: 'terrain';
      readonly classId: TerrainClassType;
      readonly packId?: PackId | undefined;
    }
  | {
      readonly kind: 'placeable';
      readonly placeableId: PlaceableIdType;
      readonly packId?: PackId | undefined;
      /** Default animation clip for animated sprites; pinned onto the placement. */
      readonly clipId?: ClipIdType | undefined;
    }
  | {
      /**
       * A plugin-contributed placement action surfaced as a first-class palette
       * brush. Placement is STICKY: the brush stays active and stamps its
       * `objectKind` on every canvas click until another brush is selected. The
       * editor keys purely on this abstract kind + the contributed `objectKind`,
       * never on any plugin-specific string, so a future RPG-mode spawn reuses
       * it unchanged.
       */
      readonly kind: 'plugin-object';
      readonly objectKind: string;
      readonly label: string;
      readonly icon?: PaletteActionIcon | undefined;
      readonly packId?: PackId | undefined;
    }
  | { readonly kind: 'eraser' };

interface CameraState {
  zoom: number;
  panX: number;
  panY: number;
}

interface BrushParams {
  size: number;
  shape: 'square' | 'circle';
}

interface HoverTile {
  x: number;
  y: number;
}

export type PlaytestMode = 'none' | 'single' | 'multiplayer';

export interface LocalHostSession {
  readonly baseUrl: string;
  readonly signingKey: string;
  readonly roomId?: string;
  readonly roomUrl?: string;
  readonly wsUrl?: string;
  readonly deeplink?: string;
}

interface EditorUiState {
  selection: Set<EntityId>;
  hoverEntityId: EntityId | null;
  hoverTile: HoverTile | null;
  activeTool: EditorTool;
  brushParams: BrushParams;
  camera: CameraState;
  brushIntent: BrushIntent;
  activeLayerId: LayerId | null;
  showGrid: boolean;
  snapToGrid: boolean;
  showCollisionOverlay: boolean;
  showDebugOverlay: boolean;
  showMinimapOverlay: boolean;
  undoPreview: unknown | null;
  recentProjectIds: string[];
  recentProjectMaps: Record<string, string>;
  recentCommandIds: string[];
  commandUseCounts: Record<string, number>;
  sidebarCollapsed: boolean;
  inspectorCollapsed: boolean;
  bottomDrawerOpen: boolean;
  bottomDrawerTab: BottomDrawerTabValue;
  commandPaletteOpen: boolean;
  generateMapDialogOpen: boolean;
  createMapDialogOpen: boolean;
  pluginInstallDialogOpen: boolean;
  assetImportDialogOpen: boolean;
  assetImportSourcePath: string | null;
  spriteEditorOpen: boolean;
  createProjectDialogOpen: boolean;
  shipGameDialogOpen: boolean;
  playtestActive: boolean;
  playtestSessionId: string | null;
  playtestActivePlugins: readonly string[];
  playtestMode: PlaytestMode;
  localHostSession: LocalHostSession | null;
  playtestHostModalOpen: boolean;
  playtestJoinModalOpen: boolean;
  telemetryEnabled: boolean;
  theme: ThemePreference;
  activePalettePackId: string | null;
  pendingImportJobId: string | null;
  catalogTargetObjectTypeId: string | null;
  openTabs: readonly WorkspaceTab[];
}

interface EditorUiActions {
  setSelection: (selection: Set<EntityId>) => void;
  toggleSelection: (entityId: EntityId) => void;
  clearSelection: () => void;
  setHoverEntityId: (entityId: EntityId | null) => void;
  setHoverTile: (tile: HoverTile | null) => void;
  /**
   * Canonical tool-selection path. Sets `activeTool` and normalizes
   * `brushIntent` so a tool that does not consume the active brush clears its
   * palette/inspector highlight. Route every tool entry point (toolbar,
   * keyboard, command palette) through this — never set `activeTool` directly.
   */
  selectTool: (tool: EditorTool) => void;
  setBrushParams: (params: Partial<BrushParams>) => void;
  setCamera: (camera: Partial<CameraState>) => void;
  setBrushIntent: (intent: BrushIntent) => void;
  selectBrush: (intent: BrushIntent, tool?: EditorTool) => void;
  setActiveLayerId: (layerId: LayerId | null) => void;
  setShowGrid: (show: boolean) => void;
  setSnapToGrid: (snap: boolean) => void;
  setShowCollisionOverlay: (show: boolean) => void;
  setShowDebugOverlay: (show: boolean) => void;
  setShowMinimapOverlay: (show: boolean) => void;
  setUndoPreview: (preview: unknown | null) => void;
  addRecentProject: (projectId: string) => void;
  setRecentProjectMap: (projectId: string, mapId: string) => void;
  recordCommandUsage: (commandId: string) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setInspectorCollapsed: (collapsed: boolean) => void;
  setBottomDrawerOpen: (open: boolean) => void;
  setBottomDrawerTab: (tab: BottomDrawerTabValue) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setGenerateMapDialogOpen: (open: boolean) => void;
  setCreateMapDialogOpen: (open: boolean) => void;
  setPluginInstallDialogOpen: (open: boolean) => void;
  setAssetImportDialogOpen: (open: boolean) => void;
  setSpriteEditorOpen: (open: boolean) => void;
  setAssetImportSourcePath: (path: string | null) => void;
  setCreateProjectDialogOpen: (open: boolean) => void;
  setShipGameDialogOpen: (open: boolean) => void;
  setPlaytestActive: (active: boolean) => void;
  setPlaytestSessionId: (sessionId: string | null) => void;
  setPlaytestActivePlugins: (plugins: readonly string[]) => void;
  setPlaytestMode: (mode: PlaytestMode) => void;
  setLocalHostSession: (session: LocalHostSession | null) => void;
  setPlaytestHostModalOpen: (open: boolean) => void;
  setPlaytestJoinModalOpen: (open: boolean) => void;
  resetMultiplayerPlaytest: () => void;
  setTelemetryEnabled: (enabled: boolean) => void;
  setTheme: (theme: ThemePreference) => void;
  setActivePalettePackId: (packId: string | null) => void;
  setPendingImportJobId: (jobId: string | null) => void;
  setCatalogTargetObjectTypeId: (objectTypeId: string | null) => void;
  /** Insert a tab if not present; updates position to keep insertion order. */
  ensureTab: (tab: WorkspaceTab) => void;
  /** Remove a tab by id. Returns the neighbor that should become active, or null. */
  closeTab: (tabId: string) => WorkspaceTab | null;
  closeOtherTabs: (tabId: string) => void;
  closeAllTabs: () => void;
  reorderTabs: (tabIds: readonly string[]) => void;
  /** Drop tabs that reference a project that no longer exists, etc. */
  pruneTabs: (predicate: (tab: WorkspaceTab) => boolean) => void;
}

type PersistedSlice = Pick<
  EditorUiState,
  | 'camera'
  | 'recentProjectIds'
  | 'recentProjectMaps'
  | 'recentCommandIds'
  | 'commandUseCounts'
  | 'telemetryEnabled'
  | 'theme'
  | 'snapToGrid'
  | 'showCollisionOverlay'
  | 'showMinimapOverlay'
  | 'activePalettePackId'
  | 'openTabs'
>;

const defaultCamera: CameraState = { zoom: 1, panX: 0, panY: 0 };

const memoryStorage = new Map<string, string>();

const brushIntentEquals = (left: BrushIntent, right: BrushIntent): boolean => {
  if (left.kind !== right.kind) {
    return false;
  }
  switch (right.kind) {
    case 'tile':
      return left.kind === 'tile' && left.tileId === right.tileId && left.packId === right.packId;
    case 'autotile':
      return (
        left.kind === 'autotile' && left.ruleId === right.ruleId && left.packId === right.packId
      );
    case 'terrain':
      return (
        left.kind === 'terrain' && left.classId === right.classId && left.packId === right.packId
      );
    case 'placeable':
      return (
        left.kind === 'placeable' &&
        left.placeableId === right.placeableId &&
        left.packId === right.packId
      );
    case 'plugin-object':
      // Identity is the abstract object kind (+ optional pack); the contributed
      // label/icon are presentation and never affect which brush is active.
      return (
        left.kind === 'plugin-object' &&
        left.objectKind === right.objectKind &&
        left.packId === right.packId
      );
    case 'eraser':
      return true;
  }
  return assertNever(right);
};

/**
 * The brush kinds each tool actually paints/places with. A tool switch keeps the
 * active brush only when the destination tool consumes that brush kind; any
 * other brush is normalized to the inert eraser intent so no palette/inspector
 * chip stays highlighted while a tool that ignores it is active. This is the
 * single rule that keeps `activeTool` and `brushIntent` from ever disagreeing
 * (SSOT: exactly one logical brush/tool highlights anywhere).
 */
const TOOL_BRUSH_KINDS: Record<EditorTool, ReadonlySet<BrushIntent['kind']>> = {
  select: new Set(),
  pan: new Set(),
  objectMove: new Set(),
  collisionPaint: new Set(),
  regionMark: new Set(),
  eraser: new Set(['eraser']),
  tileBrush: new Set(['tile', 'autotile', 'terrain', 'placeable']),
  rectangleFill: new Set(['tile', 'autotile', 'terrain']),
  objectPlace: new Set(['placeable', 'plugin-object']),
};

/** Inert brush: highlights nothing in the palette and paints nothing. */
const NEUTRAL_BRUSH_INTENT: BrushIntent = { kind: 'eraser' };

/**
 * Returns the brush the editor should hold after switching to `tool`. When the
 * destination tool consumes the current brush kind it is kept unchanged;
 * otherwise it collapses to {@link NEUTRAL_BRUSH_INTENT} (e.g. switching to
 * select/pan/objectMove clears a tile/placeable/plugin-object highlight, while
 * the eraser tool normalizes any non-eraser brush to the eraser intent).
 */
const normalizeBrushIntentForTool = (tool: EditorTool, intent: BrushIntent): BrushIntent =>
  TOOL_BRUSH_KINDS[tool].has(intent.kind) ? intent : NEUTRAL_BRUSH_INTENT;

const hoverTileEquals = (left: HoverTile | null, right: HoverTile | null): boolean =>
  left?.x === right?.x && left?.y === right?.y && (left !== null) === (right !== null);

const editorStorage = createJSONStorage(() => {
  const storage = globalThis.localStorage;
  if (
    storage !== undefined &&
    typeof storage.getItem === 'function' &&
    typeof storage.setItem === 'function' &&
    typeof storage.removeItem === 'function'
  ) {
    return storage;
  }
  return {
    getItem: (name: string) => memoryStorage.get(name) ?? null,
    setItem: (name: string, value: string) => {
      memoryStorage.set(name, value);
    },
    removeItem: (name: string) => {
      memoryStorage.delete(name);
    },
  };
});

export const useEditorUiStore = create<EditorUiState & EditorUiActions>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        selection: new Set<EntityId>(),
        hoverEntityId: null,
        hoverTile: null,
        activeTool: 'select',
        brushParams: { size: 1, shape: 'square' },
        camera: defaultCamera,
        brushIntent: { kind: 'eraser' },
        activeLayerId: null,
        showGrid: true,
        snapToGrid: true,
        showCollisionOverlay: false,
        showDebugOverlay: false,
        showMinimapOverlay: true,
        undoPreview: null,
        recentProjectIds: [],
        recentProjectMaps: {},
        recentCommandIds: [],
        commandUseCounts: {},
        sidebarCollapsed: false,
        inspectorCollapsed: false,
        bottomDrawerOpen: false,
        bottomDrawerTab: 'jobs',
        commandPaletteOpen: false,
        generateMapDialogOpen: false,
        createMapDialogOpen: false,
        pluginInstallDialogOpen: false,
        assetImportDialogOpen: false,
        spriteEditorOpen: false,
        assetImportSourcePath: null,
        createProjectDialogOpen: false,
        shipGameDialogOpen: false,
        playtestActive: false,
        playtestSessionId: null,
        playtestActivePlugins: [],
        playtestMode: 'none',
        localHostSession: null,
        playtestHostModalOpen: false,
        playtestJoinModalOpen: false,
        telemetryEnabled: false,
        theme: 'dark',
        activePalettePackId: null,
        pendingImportJobId: null,
        catalogTargetObjectTypeId: null,
        openTabs: [],

        setSelection: (selection) => set({ selection: new Set(selection) }),
        toggleSelection: (entityId) => {
          const next = new Set(get().selection);
          if (next.has(entityId)) {
            next.delete(entityId);
          } else {
            next.add(entityId);
          }
          set({ selection: next });
        },
        clearSelection: () => set({ selection: new Set() }),
        setHoverEntityId: (hoverEntityId) => {
          if (get().hoverEntityId !== hoverEntityId) {
            set({ hoverEntityId });
          }
        },
        setHoverTile: (hoverTile) => {
          if (!hoverTileEquals(get().hoverTile, hoverTile)) {
            set({ hoverTile });
          }
        },
        selectTool: (activeTool) => {
          // Selecting a tool is the single source of truth for the active tool:
          // it switches `activeTool` and normalizes `brushIntent` so the palette
          // never keeps a brush highlighted that the new tool would ignore.
          const state = get();
          const brushIntent = normalizeBrushIntentForTool(activeTool, state.brushIntent);
          const next: Partial<EditorUiState> = {};
          if (state.activeTool !== activeTool) {
            next.activeTool = activeTool;
          }
          if (!brushIntentEquals(state.brushIntent, brushIntent)) {
            next.brushIntent = brushIntent;
          }
          if (Object.keys(next).length > 0) {
            set(next);
          }
        },
        setBrushParams: (params) => set({ brushParams: { ...get().brushParams, ...params } }),
        setCamera: (camera) => set({ camera: { ...get().camera, ...camera } }),
        setBrushIntent: (brushIntent) => {
          if (!brushIntentEquals(get().brushIntent, brushIntent)) {
            set({ brushIntent });
          }
        },
        selectBrush: (brushIntent, activeTool = 'tileBrush') => {
          // Selecting ANY brush/tool is the single source of truth for the
          // active brush: it overwrites `brushIntent` (deselecting whatever was
          // active before — tile, placeable, or plugin-object) and switches to
          // the tool that drives it. Exactly one thing is highlighted anywhere.
          const state = get();
          const next: Partial<EditorUiState> = {};
          if (!brushIntentEquals(state.brushIntent, brushIntent)) {
            next.brushIntent = brushIntent;
          }
          if (state.activeTool !== activeTool) {
            next.activeTool = activeTool;
          }
          if (Object.keys(next).length > 0) {
            set(next);
          }
        },
        setActiveLayerId: (activeLayerId) => set({ activeLayerId }),
        setShowGrid: (showGrid) => set({ showGrid }),
        setSnapToGrid: (snapToGrid) => set({ snapToGrid }),
        setShowCollisionOverlay: (showCollisionOverlay) => set({ showCollisionOverlay }),
        setShowDebugOverlay: (showDebugOverlay) => set({ showDebugOverlay }),
        setShowMinimapOverlay: (showMinimapOverlay) => set({ showMinimapOverlay }),
        setUndoPreview: (undoPreview) => set({ undoPreview }),
        addRecentProject: (projectId) => {
          const normalizedProjectId = normalizeRouteParam(projectId);
          const filtered = normalizeRecentProjectIds(get().recentProjectIds).filter(
            (id) => id !== normalizedProjectId,
          );
          set({ recentProjectIds: [normalizedProjectId, ...filtered].slice(0, 12) });
        },
        setRecentProjectMap: (projectId, mapId) => {
          const normalizedProjectId = normalizeRouteParam(projectId);
          const normalizedMapId = normalizeRouteParam(mapId);
          set({
            recentProjectMaps: {
              ...normalizeRecentProjectMaps(get().recentProjectMaps),
              [normalizedProjectId]: normalizedMapId,
            },
          });
        },
        recordCommandUsage: (commandId) => {
          const filtered = get().recentCommandIds.filter((id) => id !== commandId);
          set({
            recentCommandIds: [commandId, ...filtered].slice(0, 12),
            commandUseCounts: {
              ...get().commandUseCounts,
              [commandId]: (get().commandUseCounts[commandId] ?? 0) + 1,
            },
          });
        },
        setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
        setInspectorCollapsed: (inspectorCollapsed) => set({ inspectorCollapsed }),
        setBottomDrawerOpen: (bottomDrawerOpen) => set({ bottomDrawerOpen }),
        setBottomDrawerTab: (bottomDrawerTab) => set({ bottomDrawerTab }),
        setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
        setGenerateMapDialogOpen: (generateMapDialogOpen) => set({ generateMapDialogOpen }),
        setCreateMapDialogOpen: (createMapDialogOpen) => set({ createMapDialogOpen }),
        setPluginInstallDialogOpen: (pluginInstallDialogOpen) => set({ pluginInstallDialogOpen }),
        setAssetImportDialogOpen: (assetImportDialogOpen) => set({ assetImportDialogOpen }),
        setSpriteEditorOpen: (spriteEditorOpen) => set({ spriteEditorOpen }),
        setAssetImportSourcePath: (assetImportSourcePath) => set({ assetImportSourcePath }),
        setCreateProjectDialogOpen: (createProjectDialogOpen) => set({ createProjectDialogOpen }),
        setShipGameDialogOpen: (shipGameDialogOpen) => set({ shipGameDialogOpen }),
        setPlaytestActive: (playtestActive) => set({ playtestActive }),
        setPlaytestSessionId: (playtestSessionId) => set({ playtestSessionId }),
        setPlaytestActivePlugins: (playtestActivePlugins) => set({ playtestActivePlugins }),
        setPlaytestMode: (playtestMode) => set({ playtestMode }),
        setLocalHostSession: (localHostSession) => set({ localHostSession }),
        setPlaytestHostModalOpen: (playtestHostModalOpen) => set({ playtestHostModalOpen }),
        setPlaytestJoinModalOpen: (playtestJoinModalOpen) => set({ playtestJoinModalOpen }),
        resetMultiplayerPlaytest: () =>
          set({
            playtestMode: 'none',
            playtestActive: false,
            localHostSession: null,
            playtestHostModalOpen: false,
            playtestJoinModalOpen: false,
          }),
        setTelemetryEnabled: (telemetryEnabled) => set({ telemetryEnabled }),
        setTheme: (theme) => set({ theme }),
        setActivePalettePackId: (activePalettePackId) => set({ activePalettePackId }),
        setPendingImportJobId: (pendingImportJobId) => set({ pendingImportJobId }),
        setCatalogTargetObjectTypeId: (catalogTargetObjectTypeId) =>
          set({ catalogTargetObjectTypeId }),
        ensureTab: (tab) => {
          const current = normalizeWorkspaceTabs(get().openTabs);
          const normalizedTab = normalizeWorkspaceTabs([tab])[0];
          if (normalizedTab === undefined) {
            return;
          }
          if (current.some((existing) => existing.id === normalizedTab.id)) {
            if (!workspaceTabsEqual(current, get().openTabs)) {
              set({ openTabs: current });
            }
            return;
          }
          set({ openTabs: [...current, normalizedTab] });
        },
        closeTab: (tabId) => {
          const current = normalizeWorkspaceTabs(get().openTabs);
          const index = current.findIndex((tab) => tab.id === tabId);
          if (index < 0) {
            if (!workspaceTabsEqual(current, get().openTabs)) {
              set({ openTabs: current });
            }
            return null;
          }
          const next = current.filter((tab) => tab.id !== tabId);
          set({ openTabs: next });
          if (next.length === 0) {
            return null;
          }
          return next[Math.min(index, next.length - 1)] ?? null;
        },
        closeOtherTabs: (tabId) => {
          const kept = normalizeWorkspaceTabs(get().openTabs).filter((tab) => tab.id === tabId);
          set({ openTabs: kept });
        },
        closeAllTabs: () => set({ openTabs: [] }),
        reorderTabs: (tabIds) => {
          const current = normalizeWorkspaceTabs(get().openTabs);
          const byId = new Map(current.map((tab) => [tab.id, tab] as const));
          const reordered: WorkspaceTab[] = [];
          for (const id of tabIds) {
            const tab = byId.get(id);
            if (tab !== undefined) {
              reordered.push(tab);
              byId.delete(id);
            }
          }
          for (const remaining of byId.values()) {
            reordered.push(remaining);
          }
          set({ openTabs: reordered });
        },
        pruneTabs: (predicate) => {
          const current = normalizeWorkspaceTabs(get().openTabs);
          const next = current.filter(predicate);
          if (!workspaceTabsEqual(next, get().openTabs)) {
            set({ openTabs: next });
          }
        },
      }),
      {
        name: 'tileborne-editor-ui',
        version: PERSISTED_SCHEMA_VERSIONS.editorUiStore,
        storage: editorStorage,
        partialize: (state): PersistedSlice => ({
          camera: state.camera,
          recentProjectIds: normalizeRecentProjectIds(state.recentProjectIds),
          recentProjectMaps: normalizeRecentProjectMaps(state.recentProjectMaps),
          recentCommandIds: state.recentCommandIds,
          commandUseCounts: state.commandUseCounts,
          telemetryEnabled: state.telemetryEnabled,
          theme: state.theme,
          snapToGrid: state.snapToGrid,
          showCollisionOverlay: state.showCollisionOverlay,
          showMinimapOverlay: state.showMinimapOverlay,
          activePalettePackId: state.activePalettePackId,
          openTabs: normalizeWorkspaceTabs(state.openTabs),
        }),
        merge: (persisted, current) => {
          const saved = persisted as Partial<PersistedSlice> | undefined;
          return {
            ...current,
            camera: saved?.camera ?? current.camera,
            recentProjectIds: normalizeRecentProjectIds(
              saved?.recentProjectIds ?? current.recentProjectIds,
            ),
            recentProjectMaps: normalizeRecentProjectMaps(
              saved?.recentProjectMaps ?? current.recentProjectMaps,
            ),
            recentCommandIds: saved?.recentCommandIds ?? current.recentCommandIds,
            commandUseCounts: saved?.commandUseCounts ?? current.commandUseCounts,
            telemetryEnabled: saved?.telemetryEnabled ?? current.telemetryEnabled,
            theme: saved?.theme ?? current.theme,
            snapToGrid: saved?.snapToGrid ?? current.snapToGrid,
            showCollisionOverlay: saved?.showCollisionOverlay ?? current.showCollisionOverlay,
            showMinimapOverlay: saved?.showMinimapOverlay ?? current.showMinimapOverlay,
            activePalettePackId: saved?.activePalettePackId ?? current.activePalettePackId,
            openTabs: normalizeWorkspaceTabs(saved?.openTabs ?? current.openTabs),
          };
        },
      },
    ),
  ),
);
