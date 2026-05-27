import { create } from 'zustand';
import { createJSONStorage, persist, subscribeWithSelector } from 'zustand/middleware';

import type { LayerId, PackId } from '@tileborne/core';
import type {
  AutotileRuleIdType,
  PlaceableIdType,
  TerrainClassType,
  TileIdType,
} from '@tileborne/sdk-tileset/schemas';

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

export type WorkspaceTabKind = 'map' | 'overview' | 'assets' | 'plugins' | 'settings';

export interface WorkspaceTab {
  readonly id: string;
  readonly kind: WorkspaceTabKind;
  readonly projectId?: string;
  readonly mapId?: string;
}

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
  }
}

export function normalizeWorkspaceTabs(tabs: readonly WorkspaceTab[]): WorkspaceTab[] {
  const normalized: WorkspaceTab[] = [];
  const seen = new Set<string>();

  for (const tab of tabs) {
    const projectId = normalizeOptionalRouteParam(tab.projectId);
    const mapId = normalizeOptionalRouteParam(tab.mapId);

    if (tab.kind === 'map' && (!projectId || !mapId)) {
      continue;
    }
    if (
      (tab.kind === 'overview' || tab.kind === 'assets' || tab.kind === 'plugins') &&
      !projectId
    ) {
      continue;
    }

    const id = workspaceTabId({
      kind: tab.kind,
      ...(projectId === undefined ? {} : { projectId }),
      ...(mapId === undefined ? {} : { mapId }),
    });
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    normalized.push({
      id,
      kind: tab.kind,
      ...(projectId === undefined ? {} : { projectId }),
      ...(tab.kind === 'map' && mapId !== undefined ? { mapId } : {}),
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

export type BrushIntent =
  | { readonly kind: 'tile'; readonly tileId: TileIdType; readonly packId?: PackId | undefined }
  | { readonly kind: 'autotile'; readonly ruleId: AutotileRuleIdType; readonly packId?: PackId | undefined }
  | { readonly kind: 'terrain'; readonly classId: TerrainClassType; readonly packId?: PackId | undefined }
  | { readonly kind: 'placeable'; readonly placeableId: PlaceableIdType; readonly packId?: PackId | undefined }
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
  stagedObjectKind: string;
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
  commandPaletteOpen: boolean;
  generateMapDialogOpen: boolean;
  createMapDialogOpen: boolean;
  pluginInstallDialogOpen: boolean;
  assetImportDialogOpen: boolean;
  assetImportSourcePath: string | null;
  createProjectDialogOpen: boolean;
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
  openTabs: readonly WorkspaceTab[];
}

interface EditorUiActions {
  setSelection: (selection: Set<EntityId>) => void;
  toggleSelection: (entityId: EntityId) => void;
  clearSelection: () => void;
  setHoverEntityId: (entityId: EntityId | null) => void;
  setHoverTile: (tile: HoverTile | null) => void;
  setActiveTool: (tool: EditorTool) => void;
  setBrushParams: (params: Partial<BrushParams>) => void;
  setCamera: (camera: Partial<CameraState>) => void;
  setBrushIntent: (intent: BrushIntent) => void;
  selectBrush: (intent: BrushIntent, tool?: EditorTool) => void;
  setStagedObjectKind: (kind: string) => void;
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
  setCommandPaletteOpen: (open: boolean) => void;
  setGenerateMapDialogOpen: (open: boolean) => void;
  setCreateMapDialogOpen: (open: boolean) => void;
  setPluginInstallDialogOpen: (open: boolean) => void;
  setAssetImportDialogOpen: (open: boolean) => void;
  setAssetImportSourcePath: (path: string | null) => void;
  setCreateProjectDialogOpen: (open: boolean) => void;
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
      return left.kind === 'autotile' && left.ruleId === right.ruleId && left.packId === right.packId;
    case 'terrain':
      return left.kind === 'terrain' && left.classId === right.classId && left.packId === right.packId;
    case 'placeable':
      return left.kind === 'placeable' && left.placeableId === right.placeableId && left.packId === right.packId;
    case 'eraser':
      return true;
  }
};

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
        stagedObjectKind: 'prop',
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
        commandPaletteOpen: false,
        generateMapDialogOpen: false,
        createMapDialogOpen: false,
        pluginInstallDialogOpen: false,
        assetImportDialogOpen: false,
        assetImportSourcePath: null,
        createProjectDialogOpen: false,
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
        setActiveTool: (activeTool) => {
          if (get().activeTool !== activeTool) {
            set({ activeTool });
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
          const state = get();
          const next: Partial<EditorUiState> = {};
          if (!brushIntentEquals(state.brushIntent, brushIntent)) {
            next.brushIntent = brushIntent;
          }
          if (state.activeTool !== activeTool) {
            next.activeTool = activeTool;
          }
          if (next.brushIntent !== undefined || next.activeTool !== undefined) {
            set(next);
          }
        },
        setStagedObjectKind: (stagedObjectKind) => set({ stagedObjectKind }),
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
        setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
        setGenerateMapDialogOpen: (generateMapDialogOpen) => set({ generateMapDialogOpen }),
        setCreateMapDialogOpen: (createMapDialogOpen) => set({ createMapDialogOpen }),
        setPluginInstallDialogOpen: (pluginInstallDialogOpen) => set({ pluginInstallDialogOpen }),
        setAssetImportDialogOpen: (assetImportDialogOpen) => set({ assetImportDialogOpen }),
        setAssetImportSourcePath: (assetImportSourcePath) => set({ assetImportSourcePath }),
        setCreateProjectDialogOpen: (createProjectDialogOpen) => set({ createProjectDialogOpen }),
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
