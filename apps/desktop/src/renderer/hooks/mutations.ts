import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { GameObjectTypeId, PackId, PluginId, ProjectId } from '@tileborne/core';
import type { ProjectDefinitionKind } from '@tileborne/ipc-contracts';
import type { PlaytestSessionId } from '@tileborne/services-build';

import type { MapId } from '@tileborne/core';

import type {
  AssetLibraryReloadPackCacheResponse,
  AssetPackRemoveResponse,
  AudioApplyResponse,
  AudioPreviewResponse,
  AudioSaveResponse,
  GameShellApplyResponse,
  GameShellPreviewResponse,
  GameShellSaveResponse,
  AssetPacksListResponse,
  CatalogExportResponse,
  CatalogDuplicateDefinitionResponse,
  CatalogImportResponse,
  CatalogRemoveDefinitionResponse,
  CatalogRemoveTypeResponse,
  CatalogUpsertDefinitionResponse,
  CatalogUpsertTypeResponse,
  MapsImportTiledResponse,
  MapsGenerateResponse,
  MapsScanTiledResponse,
  MapsSetMapTilesetPackResponse,
  PluginsInstallResponse,
  ProjectsCreateResponse,
  ProjectsCreateGameResponse,
  PlaytestStartResponse,
  TiledImportApplyResponse,
  TiledImportPlanResponse,
  TiledImportScanResponse,
} from '@/lib/bridge-types';
import { invokeIpc, type TileborneQueryError } from '@/lib/ipc';
import {
  formatMutationError,
  isUserCancelledMutation,
  type MutationToastMeta,
  mutationErrorToast,
  mutationSuccessToast,
  isMutationSilent,
} from '@/lib/mutation-notifications';
import {
  invalidateAssetUseSites,
  invalidateBehaviorReferences,
  queryKeys,
} from '@/lib/query-client';
import { localPluginSource, type PluginInstallSource } from '@/lib/plugin-source';
import { useEditorUiStore } from '@/stores/editor-ui-store';
import { useWorkingPalettesStore } from '@/stores/working-palettes-store';
import { brushIntentMatchesItem } from '@/lib/working-palettes-bridge';

const mutationMeta = (meta: unknown): MutationToastMeta | undefined =>
  typeof meta === 'object' && meta !== null ? (meta as MutationToastMeta) : undefined;

type AssetLibraryCacheMutationInput = {
  readonly packId: string;
  readonly integrityHash?: string | undefined;
};

type AssetLibraryCacheMutationResult = {
  readonly supported: boolean;
  readonly response?: AssetLibraryReloadPackCacheResponse | undefined;
};

type AssetLibraryCacheMutationBridge = {
  readonly reloadPackCache?: typeof window.tileborne.assetLibrary.reloadPackCache | undefined;
};

type CatalogImportMutationInput = {
  readonly projectId: string;
  readonly catalogJson: unknown;
};

const assetLibraryCacheMutationBridge = (): AssetLibraryCacheMutationBridge =>
  typeof window === 'undefined'
    ? {}
    : (window.tileborne.assetLibrary as unknown as AssetLibraryCacheMutationBridge);

const callOptionalAssetLibraryCacheMutation = async (
  input: AssetLibraryCacheMutationInput,
): Promise<AssetLibraryCacheMutationResult> => {
  const bridge = assetLibraryCacheMutationBridge();
  const method = bridge.reloadPackCache;
  if (method === undefined) {
    return { supported: false };
  }
  const response = await invokeIpc(() => method.call(bridge, { packId: input.packId as PackId }));
  return { supported: true, response };
};

const queryKeyPackId = (queryKey: readonly unknown[]): string | undefined =>
  typeof queryKey[1] === 'string' ? queryKey[1] : undefined;

const removeAssetPackQueries = (queryClient: ReturnType<typeof useQueryClient>, packId: string) => {
  queryClient.removeQueries({
    predicate: (query) => {
      const queryKey = query.queryKey;
      return (
        (queryKey[0] === 'assets' && queryKeyPackId(queryKey) === packId) ||
        (queryKey[0] === 'assetLibrary' && queryKeyPackId(queryKey) === packId) ||
        (queryKey[0] === 'assetLibrary' && queryKey[1] === 'useSites' && queryKey[3] === packId)
      );
    },
  });
};

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation<
    ProjectsCreateResponse,
    TileborneQueryError,
    { name: string; engineVersion?: string }
  >({
    mutationFn: (input: { name: string; engineVersion?: string }) =>
      invokeIpc(() =>
        window.tileborne.projects.create({
          name: input.name,
          engineVersion: input.engineVersion,
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.readiness.all });
    },
  });
}

export function useCreateGame() {
  const queryClient = useQueryClient();
  return useMutation<
    ProjectsCreateGameResponse,
    TileborneQueryError,
    { name: string; gameType: 'battle-royale'; idempotencyKey: string }
  >({
    mutationFn: (input) => invokeIpc(() => window.tileborne.projects.createGame(input)),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.maps.list(data.projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.readiness.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.plugins.all });
    },
  });
}

const invalidateAudio = (
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string,
): Promise<unknown> =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.audio.document(projectId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.readiness.all }),
  ]);

const invalidateGameShell = (
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string,
): Promise<unknown> =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.gameShell.document(projectId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.readiness.all }),
  ]);

export function useSaveProjectAudio(): UseMutationResult<
  AudioSaveResponse,
  TileborneQueryError,
  Parameters<typeof window.tileborne.audio.save>[0]
> {
  const queryClient = useQueryClient();
  return useMutation<
    AudioSaveResponse,
    TileborneQueryError,
    Parameters<typeof window.tileborne.audio.save>[0]
  >({
    mutationFn: (input) => invokeIpc(() => window.tileborne.audio.save(input)),
    onSuccess: (_data, input) => invalidateAudio(queryClient, input.projectId),
  });
}

export function useApplyProjectAudioCommand(): UseMutationResult<
  AudioApplyResponse,
  TileborneQueryError,
  Parameters<typeof window.tileborne.audio.apply>[0]
> {
  const queryClient = useQueryClient();
  return useMutation<
    AudioApplyResponse,
    TileborneQueryError,
    Parameters<typeof window.tileborne.audio.apply>[0]
  >({
    mutationFn: (input) => invokeIpc(() => window.tileborne.audio.apply(input)),
    onSuccess: (_data, input) => invalidateAudio(queryClient, input.projectId),
  });
}

export function usePreviewProjectAudio(): UseMutationResult<
  AudioPreviewResponse,
  TileborneQueryError,
  Parameters<typeof window.tileborne.audio.preview>[0]
> {
  return useMutation<
    AudioPreviewResponse,
    TileborneQueryError,
    Parameters<typeof window.tileborne.audio.preview>[0]
  >({
    mutationFn: (input) => invokeIpc(() => window.tileborne.audio.preview(input)),
  });
}

export function useSaveProjectGameShell(): UseMutationResult<
  GameShellSaveResponse,
  TileborneQueryError,
  Parameters<typeof window.tileborne.gameShell.save>[0]
> {
  const queryClient = useQueryClient();
  return useMutation<
    GameShellSaveResponse,
    TileborneQueryError,
    Parameters<typeof window.tileborne.gameShell.save>[0]
  >({
    mutationFn: (input) => invokeIpc(() => window.tileborne.gameShell.save(input)),
    onSuccess: (_data, input) => invalidateGameShell(queryClient, input.projectId),
  });
}

export function useApplyProjectGameShellCommand(): UseMutationResult<
  GameShellApplyResponse,
  TileborneQueryError,
  Parameters<typeof window.tileborne.gameShell.apply>[0]
> {
  const queryClient = useQueryClient();
  return useMutation<
    GameShellApplyResponse,
    TileborneQueryError,
    Parameters<typeof window.tileborne.gameShell.apply>[0]
  >({
    mutationFn: (input) => invokeIpc(() => window.tileborne.gameShell.apply(input)),
    onSuccess: (_data, input) => invalidateGameShell(queryClient, input.projectId),
  });
}

export function usePreviewProjectGameShell(): UseMutationResult<
  GameShellPreviewResponse,
  TileborneQueryError,
  Parameters<typeof window.tileborne.gameShell.preview>[0]
> {
  return useMutation<
    GameShellPreviewResponse,
    TileborneQueryError,
    Parameters<typeof window.tileborne.gameShell.preview>[0]
  >({
    mutationFn: (input) => invokeIpc(() => window.tileborne.gameShell.preview(input)),
  });
}

export function useCreateMap() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof window.tileborne.maps.create>[0]) =>
      invokeIpc(() => window.tileborne.maps.create(input)),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.maps.list(input.projectId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.readiness.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
      void invalidateAssetUseSites(queryClient, input.projectId);
      void invalidateBehaviorReferences(queryClient, input.projectId);
    },
  });
}

const invalidateBehaviors = (
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string,
): Promise<unknown> =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.behaviors.documents(projectId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.readiness.all }),
    invalidateBehaviorReferences(queryClient, projectId, 'behavior'),
    queryClient.invalidateQueries({
      queryKey: queryKeys.behaviorReferences.resolveAll(projectId),
    }),
  ]);

export function useCreateVisualBehavior() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof window.tileborne.behaviors.createVisual>[0]) =>
      invokeIpc(() => window.tileborne.behaviors.createVisual(input)),
    onSuccess: (_data, input) => invalidateBehaviors(queryClient, input.projectId),
  });
}

export function useSaveVisualBehavior() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof window.tileborne.behaviors.saveVisual>[0]) =>
      invokeIpc(() => window.tileborne.behaviors.saveVisual(input)),
    onSuccess: (_data, input) => invalidateBehaviors(queryClient, input.projectId),
  });
}

export function useConvertBehaviorToTypeScript() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof window.tileborne.behaviors.convertToTypeScript>[0]) =>
      invokeIpc(() => window.tileborne.behaviors.convertToTypeScript(input)),
    onSuccess: (_data, input) => invalidateBehaviors(queryClient, input.projectId),
  });
}

export function useSaveTypeScriptBehavior() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof window.tileborne.behaviors.saveTypeScript>[0]) =>
      invokeIpc(() => window.tileborne.behaviors.saveTypeScript(input)),
    onSuccess: (_data, input) => invalidateBehaviors(queryClient, input.projectId),
  });
}

export function useRemoveBehavior() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof window.tileborne.behaviors.remove>[0]) =>
      invokeIpc(() => window.tileborne.behaviors.remove(input)),
    onSuccess: (_data, input) => invalidateBehaviors(queryClient, input.projectId),
  });
}

export function useGenerateMap(): UseMutationResult<
  MapsGenerateResponse,
  TileborneQueryError,
  Parameters<typeof window.tileborne.maps.generate>[0]
> {
  const queryClient = useQueryClient();
  return useMutation<
    MapsGenerateResponse,
    TileborneQueryError,
    Parameters<typeof window.tileborne.maps.generate>[0]
  >({
    mutationFn: (input) => invokeIpc(() => window.tileborne.maps.generate(input)),
    onSuccess: (data, input) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.maps.list(input.projectId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.maps.detail(input.projectId, data.map.id),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.readiness.all });
      void invalidateAssetUseSites(queryClient, input.projectId);
      void invalidateBehaviorReferences(queryClient, input.projectId);
    },
  });
}

export function useSetMapTilesetPack(): UseMutationResult<
  MapsSetMapTilesetPackResponse,
  TileborneQueryError,
  Parameters<typeof window.tileborne.maps.setMapTilesetPack>[0]
> {
  const queryClient = useQueryClient();
  return useMutation<
    MapsSetMapTilesetPackResponse,
    TileborneQueryError,
    Parameters<typeof window.tileborne.maps.setMapTilesetPack>[0]
  >({
    mutationFn: (input) => invokeIpc(() => window.tileborne.maps.setMapTilesetPack(input)),
    onSuccess: (_data, input, _onMutateResult, context) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.maps.list(input.projectId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.maps.detail(input.projectId, input.mapId as MapId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.readiness.all });
      void invalidateAssetUseSites(queryClient, input.projectId);
      void invalidateBehaviorReferences(queryClient, input.projectId);
      mutationSuccessToast(
        `Updated map tileset pack to ${input.packId}`,
        mutationMeta(context.meta),
      );
    },
    onError: (error, _variables, _onMutateResult, context) => {
      mutationErrorToast(
        formatMutationError(error, 'set map tileset pack', 'Pick a paintable pack and try again.'),
        mutationMeta(context.meta),
      );
    },
  });
}

export function useScanTiledMap(): UseMutationResult<
  MapsScanTiledResponse,
  TileborneQueryError,
  Parameters<typeof window.tileborne.maps.scanTiled>[0]
> {
  return useMutation({
    mutationFn: (input) => invokeIpc(() => window.tileborne.maps.scanTiled(input)),
  });
}

export function useImportTiledMap(): UseMutationResult<
  MapsImportTiledResponse,
  TileborneQueryError,
  Parameters<typeof window.tileborne.maps.importTiled>[0]
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => invokeIpc(() => window.tileborne.maps.importTiled(input)),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.maps.list(input.projectId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.assets.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.readiness.all });
      void invalidateAssetUseSites(queryClient, input.projectId);
      void invalidateBehaviorReferences(queryClient, input.projectId);
    },
  });
}

export function useTiledImportScan(): UseMutationResult<
  TiledImportScanResponse,
  TileborneQueryError,
  Parameters<typeof window.tileborne.tiledImport.scan>[0]
> {
  return useMutation({
    mutationFn: (input) => invokeIpc(() => window.tileborne.tiledImport.scan(input)),
  });
}

export function useTiledImportPlan(): UseMutationResult<
  TiledImportPlanResponse,
  TileborneQueryError,
  Parameters<typeof window.tileborne.tiledImport.plan>[0]
> {
  return useMutation({
    mutationFn: (input) => invokeIpc(() => window.tileborne.tiledImport.plan(input)),
  });
}

export function useTiledImportApply(): UseMutationResult<
  TiledImportApplyResponse,
  TileborneQueryError,
  Parameters<typeof window.tileborne.tiledImport.apply>[0]
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => invokeIpc(() => window.tileborne.tiledImport.apply(input)),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.maps.list(input.projectId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.assets.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.readiness.all });
      void invalidateAssetUseSites(queryClient, input.projectId);
      void invalidateBehaviorReferences(queryClient, input.projectId);
    },
  });
}

export function useTiledImportCancel() {
  return useMutation({
    mutationFn: (input: Parameters<typeof window.tileborne.tiledImport.cancel>[0]) =>
      invokeIpc(() => window.tileborne.tiledImport.cancel(input)),
  });
}

export function useUpdateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof window.tileborne.projects.update>[0]) =>
      invokeIpc(() => window.tileborne.projects.update(input)),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.projects.detail(input.project.id),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.readiness.all });
      void invalidateAssetUseSites(queryClient, input.project.id);
      void invalidateBehaviorReferences(queryClient, input.project.id);
    },
  });
}

export function useUpdateMap() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof window.tileborne.maps.update>[0]) =>
      invokeIpc(() => window.tileborne.maps.update(input)),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.maps.list(input.projectId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.maps.detail(input.projectId, input.map.id),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.readiness.all });
      void invalidateAssetUseSites(queryClient, input.projectId);
      void invalidateBehaviorReferences(queryClient, input.projectId);
    },
    onError: (error, _variables, _onMutateResult, context) => {
      mutationErrorToast(
        formatMutationError(error, 'save map', 'Your last edit was reverted — try again.'),
        mutationMeta(context.meta),
      );
    },
  });
}

export function useImportAssetPack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { path: string }) =>
      invokeIpc(() =>
        window.tileborne.assets.importPack({
          sourceKind: 'directory',
          path: input.path,
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.assets.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.readiness.all });
      void invalidateAssetUseSites(queryClient);
      void invalidateBehaviorReferences(queryClient);
    },
  });
}

export function useDetectImportSource() {
  return useMutation({
    mutationFn: (input: { path: string }) =>
      invokeIpc(() => window.tileborne.assets.detectImportSource(input)),
  });
}

export function useImportSpriteSheet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof window.tileborne.assets.importSpriteSheet>[0]) =>
      invokeIpc(() => window.tileborne.assets.importSpriteSheet(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.assets.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.readiness.all });
      void invalidateAssetUseSites(queryClient);
      void invalidateBehaviorReferences(queryClient);
    },
  });
}

export function usePickDirectory() {
  const queryClient = useQueryClient();
  return useMutation<{ path?: string | undefined }>({
    mutationFn: () => invokeIpc(() => window.tileborne.system.pickDirectory({})),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.system.all });
    },
  });
}

export function usePickImportSource() {
  const queryClient = useQueryClient();
  return useMutation<{ path?: string | undefined }>({
    mutationFn: () => invokeIpc(() => window.tileborne.system.pickImportSource({})),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.system.all });
    },
  });
}

export function useImportProjectFromDirectory() {
  const queryClient = useQueryClient();
  const pickDirectory = usePickDirectory();
  return useMutation<{ projectId: string }, TileborneQueryError>({
    mutationFn: async () => {
      const picked = await pickDirectory.mutateAsync();
      if (picked.path === undefined) {
        throw new Error('Import cancelled');
      }
      return invokeIpc(() => window.tileborne.projects.importFromDirectory({ path: picked.path! }));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.readiness.all });
    },
  });
}

export function useExportProjectArchive() {
  const queryClient = useQueryClient();
  const pickDirectory = usePickDirectory();
  return useMutation<{ archivePath: string }, TileborneQueryError, { projectId: string }>({
    mutationFn: async ({ projectId }) => {
      const picked = await pickDirectory.mutateAsync();
      if (picked.path === undefined) {
        throw new Error('Export cancelled');
      }
      return invokeIpc(() =>
        window.tileborne.projects.exportArchive({
          projectId: projectId as ProjectId,
          destinationDirectory: picked.path!,
        }),
      );
    },
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.projects.detail(input.projectId),
      });
    },
  });
}

export function useInvokePluginEditorCommand() {
  const queryClient = useQueryClient();
  return useMutation<
    { ok: boolean; message?: string | undefined },
    TileborneQueryError,
    Parameters<typeof window.tileborne.plugins.invokeEditorCommand>[0]
  >({
    mutationFn: (input) => invokeIpc(() => window.tileborne.plugins.invokeEditorCommand(input)),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.plugins.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.assets.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.readiness.all });
      if (input.projectId !== undefined) {
        void invalidateAssetUseSites(queryClient, input.projectId);
        void queryClient.invalidateQueries({
          queryKey: queryKeys.projects.detail(input.projectId),
        });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.maps.list(input.projectId),
        });
      }
      if (input.projectId !== undefined && input.mapId !== undefined) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.maps.detail(input.projectId, input.mapId),
        });
      }
    },
  });
}

export function useRemoveAssetPack() {
  const queryClient = useQueryClient();
  return useMutation<AssetPackRemoveResponse, TileborneQueryError, string>({
    mutationFn: (packId: string) =>
      invokeIpc(() => window.tileborne.assets.removePack({ packId: packId as PackId })),
    onSuccess: (_data, packId, _onMutateResult, context) => {
      queryClient.setQueryData<AssetPacksListResponse | undefined>(
        queryKeys.assets.list(),
        (current) =>
          current === undefined
            ? current
            : { packs: current.packs.filter((pack) => pack.id !== packId) },
      );
      removeAssetPackQueries(queryClient, packId);
      void queryClient.invalidateQueries({ queryKey: queryKeys.assets.list() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.assetLibrary.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.workingPalettes.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.maps.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.readiness.all });
      for (const projectId of _data.affectedProjectIds) {
        void invalidateAssetUseSites(queryClient, projectId);
        void invalidateBehaviorReferences(queryClient, projectId);
      }
      const editorUi = useEditorUiStore.getState();
      if (editorUi.activePalettePackId === packId) {
        editorUi.setActivePalettePackId(null);
      }
      const workingPalettes = useWorkingPalettesStore.getState();
      const selectedBrushWasRemoved = workingPalettes.palettes.some((palette) =>
        palette.items.some(
          (item) =>
            item.ref.packId === packId && brushIntentMatchesItem(editorUi.brushIntent, item),
        ),
      );
      workingPalettes.prunePackReferences(packId);
      if (selectedBrushWasRemoved) {
        editorUi.selectBrush({ kind: 'eraser' }, 'eraser');
      }
      if (workingPalettes.loadedProjectId !== undefined) {
        void workingPalettes.load({ projectId: workingPalettes.loadedProjectId });
      }
      mutationSuccessToast(`Removed pack ${packId}`, mutationMeta(context.meta));
    },
    onError: (error, _variables, _onMutateResult, context) => {
      mutationErrorToast(
        formatMutationError(error, 'remove pack', 'Close editors using the pack and retry.'),
        mutationMeta(context.meta),
      );
    },
  });
}

export function useReloadAssetLibraryCache() {
  const queryClient = useQueryClient();
  return useMutation<
    AssetLibraryCacheMutationResult,
    TileborneQueryError,
    AssetLibraryCacheMutationInput
  >({
    mutationFn: (input) => callOptionalAssetLibraryCacheMutation(input),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.assetLibrary.all });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.assets.tilesetPack(input.packId, input.integrityHash ?? ''),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.readiness.all });
    },
  });
}

export function useInstallPlugin() {
  const queryClient = useQueryClient();
  return useMutation<PluginsInstallResponse, TileborneQueryError, PluginInstallSource>({
    mutationFn: (source: PluginInstallSource) =>
      invokeIpc(() => window.tileborne.plugins.install({ source })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.plugins.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.readiness.all });
      void invalidateAssetUseSites(queryClient);
    },
  });
}

export function useInstallBattleRoyalePlugin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => invokeIpc(() => window.tileborne.plugins.installBundledBattleRoyale({})),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.plugins.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.readiness.all });
      void invalidateAssetUseSites(queryClient);
    },
  });
}

export function useInstallPluginFromPath() {
  const queryClient = useQueryClient();
  const installPlugin = useInstallPlugin();
  return useMutation({
    mutationFn: (path: string) =>
      installPlugin.mutateAsync(
        localPluginSource(path.startsWith('file://') ? path.slice(7) : path),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.plugins.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.readiness.all });
      void invalidateAssetUseSites(queryClient);
    },
  });
}

export function useEnablePlugin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: string | { readonly pluginId: string; readonly silent?: boolean }) => {
      const pluginId = typeof input === 'string' ? input : input.pluginId;
      return invokeIpc(() => window.tileborne.plugins.enable({ pluginId: pluginId as PluginId }));
    },
    onSuccess: (_data, variables, _onMutateResult, context) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.plugins.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.readiness.all });
      void invalidateAssetUseSites(queryClient);
      const silent =
        (typeof variables === 'object' && variables.silent === true) ||
        isMutationSilent(mutationMeta(context.meta));
      mutationSuccessToast(
        `Enabled plugin ${typeof variables === 'string' ? variables : variables.pluginId}`,
        silent ? { silent: true } : undefined,
      );
    },
    onError: (error, variables, _onMutateResult, context) => {
      const silent =
        (typeof variables === 'object' && variables.silent === true) ||
        isMutationSilent(mutationMeta(context.meta));
      mutationErrorToast(
        formatMutationError(error, 'enable plugin', 'Try again from Plugin manager.'),
        silent ? { silent: true } : undefined,
      );
    },
  });
}

export function useDisablePlugin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pluginId: string) =>
      invokeIpc(() => window.tileborne.plugins.disable({ pluginId: pluginId as PluginId })),
    onSuccess: (_data, pluginId, _onMutateResult, context) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.plugins.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.readiness.all });
      void invalidateAssetUseSites(queryClient);
      mutationSuccessToast(`Disabled plugin ${pluginId}`, mutationMeta(context.meta));
    },
    onError: (error, _variables, _onMutateResult, context) => {
      mutationErrorToast(
        formatMutationError(error, 'disable plugin', 'Try again from Plugin manager.'),
        mutationMeta(context.meta),
      );
    },
  });
}

/**
 * Imports a catalog JSON fragment for a project via the `requiresApproval`
 * `tileborne:catalog:import` IPC (ADR-0025 slice 7). The main service decodes +
 * validates the pack and only persists when valid; on a successful (persisted)
 * import we invalidate the `catalog:resolve` query so the catalog-driven palette
 * (slice 4) and inspector (slice 5) reflect the imported fragment without a
 * manual reload. A validation failure returns `{ imported: false, report }`
 * (nothing persisted) — the caller surfaces the report.
 */
export function useImportCatalog(): UseMutationResult<
  CatalogImportResponse,
  TileborneQueryError,
  CatalogImportMutationInput
> {
  const queryClient = useQueryClient();
  return useMutation<CatalogImportResponse, TileborneQueryError, CatalogImportMutationInput>({
    mutationFn: ({ projectId, catalogJson }) =>
      invokeIpc(() =>
        window.tileborne.catalog.import({ projectId: projectId as ProjectId, catalogJson }),
      ),
    onSuccess: (data, input) => {
      if (data.imported) {
        // Refresh both the resolve projection (palette/inspector, slice 4/5)
        // and the validation report (drawer, slice 8) so the catalog-driven UI
        // reflects the imported fragment without a manual reload.
        void queryClient.invalidateQueries({
          queryKey: queryKeys.catalog.resolve(input.projectId),
        });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.catalog.validate(input.projectId),
        });
        void queryClient.invalidateQueries({ queryKey: queryKeys.readiness.all });
        void invalidateAssetUseSites(queryClient, input.projectId);
        void invalidateBehaviorReferences(queryClient, input.projectId);
      }
    },
  });
}

/**
 * Exports the project-authored catalog fragment as a serialized
 * `GameObjectCatalog` JSON pack via `tileborne:catalog:export` (read-only — no
 * approval, no invalidation). The caller saves/copies the returned `catalogJson`.
 */
export function useExportCatalog() {
  return useMutation<CatalogExportResponse, TileborneQueryError, { readonly projectId: string }>({
    mutationFn: ({ projectId }) =>
      invokeIpc(() => window.tileborne.catalog.export({ projectId: projectId as ProjectId })),
  });
}

const invalidateCatalog = (queryClient: ReturnType<typeof useQueryClient>, projectId: string) => {
  void queryClient.invalidateQueries({ queryKey: queryKeys.catalog.resolve(projectId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.catalog.validate(projectId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.readiness.all });
  void invalidateAssetUseSites(queryClient, projectId);
  void invalidateBehaviorReferences(queryClient, projectId);
};

/**
 * Entity-editor authoring write: create or replace ONE project-authored
 * `GameObjectType` in the project catalog fragment via
 * `tileborne:catalog:upsertType`. `objectTypeJson` is the serialized type
 * (callers encode with the core `GameObjectType` schema). Saves
 * work-in-progress entities; the returned report carries any open issues.
 */
export function useUpsertCatalogType(): UseMutationResult<
  CatalogUpsertTypeResponse,
  TileborneQueryError,
  { readonly projectId: string; readonly objectTypeJson: unknown }
> {
  const queryClient = useQueryClient();
  return useMutation<
    CatalogUpsertTypeResponse,
    TileborneQueryError,
    { readonly projectId: string; readonly objectTypeJson: unknown }
  >({
    mutationFn: ({ projectId, objectTypeJson }) =>
      invokeIpc(() =>
        window.tileborne.catalog.upsertType({
          projectId: projectId as ProjectId,
          objectTypeJson,
        }),
      ),
    onSuccess: (data, input) => {
      if (data.saved) {
        invalidateCatalog(queryClient, input.projectId);
      }
    },
  });
}

/** Deletes one project-authored type from the fragment via `tileborne:catalog:removeType`. */
export function useRemoveCatalogType(): UseMutationResult<
  CatalogRemoveTypeResponse,
  TileborneQueryError,
  { readonly projectId: string; readonly objectTypeId: string }
> {
  const queryClient = useQueryClient();
  return useMutation<
    CatalogRemoveTypeResponse,
    TileborneQueryError,
    { readonly projectId: string; readonly objectTypeId: string }
  >({
    mutationFn: ({ projectId, objectTypeId }) =>
      invokeIpc(() =>
        window.tileborne.catalog.removeType({
          projectId: projectId as ProjectId,
          objectTypeId: objectTypeId as GameObjectTypeId,
        }),
      ),
    onSuccess: (data, input) => {
      if (data.removed) {
        invalidateCatalog(queryClient, input.projectId);
      }
    },
  });
}

/** Genre-neutral creator CRUD for project-owned weapons, items and loot tables. */
export function useUpsertCatalogDefinition(): UseMutationResult<
  CatalogUpsertDefinitionResponse,
  TileborneQueryError,
  {
    readonly projectId: string;
    readonly kind: ProjectDefinitionKind;
    readonly definitionJson: unknown;
    readonly label?: string;
  }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, kind, definitionJson, label }) =>
      invokeIpc(() =>
        window.tileborne.catalog.upsertDefinition({
          projectId: projectId as ProjectId,
          kind,
          definitionJson,
          ...(label === undefined ? {} : { label }),
        }),
      ),
    onSuccess: (data, input) => {
      if (data.saved) invalidateCatalog(queryClient, input.projectId);
    },
  });
}

export function useDuplicateCatalogDefinition(): UseMutationResult<
  CatalogDuplicateDefinitionResponse,
  TileborneQueryError,
  {
    readonly projectId: string;
    readonly kind: ProjectDefinitionKind;
    readonly definitionId: string;
    readonly label?: string;
  }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, kind, definitionId, label }) =>
      invokeIpc(() =>
        window.tileborne.catalog.duplicateDefinition({
          projectId: projectId as ProjectId,
          kind,
          definitionId,
          ...(label === undefined ? {} : { label }),
        }),
      ),
    onSuccess: (data, input) => {
      if (data.duplicated) invalidateCatalog(queryClient, input.projectId);
    },
  });
}

export function useRemoveCatalogDefinition(): UseMutationResult<
  CatalogRemoveDefinitionResponse,
  TileborneQueryError,
  {
    readonly projectId: string;
    readonly kind: ProjectDefinitionKind;
    readonly definitionId: string;
  }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, kind, definitionId }) =>
      invokeIpc(() =>
        window.tileborne.catalog.removeDefinition({
          projectId: projectId as ProjectId,
          kind,
          definitionId,
        }),
      ),
    onSuccess: (data, input) => {
      if (data.removed) invalidateCatalog(queryClient, input.projectId);
    },
  });
}

export function useStartBuild() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof window.tileborne.builds.build>[0]) =>
      invokeIpc(() => window.tileborne.builds.build(input)),
    onSuccess: (_data, _variables, _onMutateResult, context) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.builds.list(_variables.projectId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      mutationSuccessToast('Build started', mutationMeta(context.meta));
    },
    onError: (error, _variables, _onMutateResult, context) => {
      if (isUserCancelledMutation(error)) {
        return;
      }
      mutationErrorToast(
        formatMutationError(error, 'start build', 'Open the jobs drawer to check progress.'),
        mutationMeta(context.meta),
      );
    },
  });
}

export function useStartPlaytest() {
  const queryClient = useQueryClient();
  return useMutation<
    PlaytestStartResponse,
    TileborneQueryError,
    Parameters<typeof window.tileborne.playtest.start>[0]
  >({
    mutationFn: (input: Parameters<typeof window.tileborne.playtest.start>[0]) =>
      invokeIpc(() => window.tileborne.playtest.start(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.playtest.all });
    },
  });
}

export function useStopPlaytest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      invokeIpc(() =>
        window.tileborne.playtest.stop({ sessionId: sessionId as PlaytestSessionId }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.playtest.all });
    },
  });
}

export function useControlPlaytestBehaviorDebug() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      readonly sessionId: PlaytestSessionId;
      readonly command: 'pause' | 'step' | 'continue';
    }) => invokeIpc(() => window.tileborne.playtest.behaviorDebugControl(input)),
    onSuccess: (response) => {
      queryClient.setQueryData(
        queryKeys.playtest.behaviorDebug(response.snapshot.sessionId),
        response,
      );
    },
  });
}
