import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { PackId, PluginId, ProjectId } from '@tileborne/core';
import type { PlaytestSessionId } from '@tileborne/services-build';

import type { MapId } from '@tileborne/core';

import type {
  AssetLibraryReloadPackCacheResponse,
  AssetPackRemoveResponse,
  AssetPacksListResponse,
  MapsImportTiledResponse,
  MapsGenerateResponse,
  MapsScanTiledResponse,
  MapsSetMapTilesetPackResponse,
  PluginsInstallResponse,
  ProjectsCreateResponse,
  PlaytestStartResponse,
  TiledImportApplyResponse,
  TiledImportPlanResponse,
  TiledImportScanResponse,
} from '@/lib/bridge-types';
import { invokeIpc, type TileborneQueryError } from '@/lib/ipc';
import { normalizeMapForIpc } from '@/lib/map-ipc-normalization';
import {
  formatMutationError,
  isUserCancelledMutation,
  type MutationToastMeta,
  mutationErrorToast,
  mutationSuccessToast,
  isMutationSilent,
} from '@/lib/mutation-notifications';
import { queryKeys } from '@/lib/query-client';
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
  readonly reloadPackCache?:
    | typeof window.tileborne.assetLibrary.reloadPackCache
    | undefined;
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
        (queryKey[0] === 'assetLibrary' && queryKeyPackId(queryKey) === packId)
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
    },
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
    },
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
    },
  });
}

export function useTiledImportCancel() {
  return useMutation({
    mutationFn: (input: Parameters<typeof window.tileborne.tiledImport.cancel>[0]) =>
      invokeIpc(() => window.tileborne.tiledImport.cancel(input)),
  });
}

export function useUpdateMap() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof window.tileborne.maps.update>[0]) =>
      invokeIpc(() =>
        window.tileborne.maps.update({
          ...input,
          map: normalizeMapForIpc(input.map) as typeof input.map,
        }),
      ),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.maps.list(input.projectId),
      });
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
    },
  });
}

export function useDetectImportSource() {
  return useMutation({
    mutationFn: (input: { path: string }) =>
      invokeIpc(() => window.tileborne.assets.detectImportSource(input)),
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
      if (input.projectId !== undefined) {
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
      const editorUi = useEditorUiStore.getState();
      if (editorUi.activePalettePackId === packId) {
        editorUi.setActivePalettePackId(null);
      }
      const workingPalettes = useWorkingPalettesStore.getState();
      const selectedBrushWasRemoved = workingPalettes.palettes.some((palette) =>
        palette.items.some(
          (item) => item.ref.packId === packId && brushIntentMatchesItem(editorUi.brushIntent, item),
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
    },
  });
}

export function useInstallBattleRoyalePlugin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => invokeIpc(() => window.tileborne.plugins.installBundledBattleRoyale({})),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.plugins.all });
    },
  });
}

export function useInstallPluginFromPath() {
  const queryClient = useQueryClient();
  const installPlugin = useInstallPlugin();
  return useMutation({
    mutationFn: (path: string) =>
      installPlugin.mutateAsync(localPluginSource(path.startsWith('file://') ? path.slice(7) : path)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.plugins.all });
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
