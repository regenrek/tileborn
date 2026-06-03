import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      retry: 1,
    },
  },
});

export const queryKeys = {
  projects: {
    all: ['projects'] as const,
    list: () => [...queryKeys.projects.all, 'list'] as const,
    detail: (projectId: string) => [...queryKeys.projects.all, projectId] as const,
  },
  maps: {
    all: ['maps'] as const,
    list: (projectId: string) => [...queryKeys.maps.all, projectId, 'list'] as const,
    detail: (projectId: string, mapId: string) =>
      [...queryKeys.maps.all, projectId, mapId] as const,
  },
  assets: {
    all: ['assets'] as const,
    list: () => [...queryKeys.assets.all, 'list'] as const,
    detail: (packId: string) => [...queryKeys.assets.all, packId] as const,
    packAssets: (packId: string) => [...queryKeys.assets.all, packId, 'assets'] as const,
    dataUrl: (packId: string, integrityHash: string, assetPath: string, cacheVersion: string) =>
      [...queryKeys.assets.all, packId, integrityHash, 'dataUrl', assetPath, cacheVersion] as const,
    thumbnail: (
      packId: string,
      integrityHash: string,
      assetPath: string,
      sizePx: number,
      cacheVersion: string,
      variantKey: string,
    ) =>
      [
        ...queryKeys.assets.all,
        packId,
        integrityHash,
        'thumbnail',
        assetPath,
        sizePx,
        cacheVersion,
        variantKey,
      ] as const,
    seededPath: (packKey: string) => [...queryKeys.assets.all, 'seeded', packKey] as const,
    tilesetPack: (packId: string, integrityHash: string) =>
      [...queryKeys.assets.all, packId, integrityHash, 'tilesetPack'] as const,
  },
  assetLibrary: {
    all: ['assetLibrary'] as const,
    status: (packId: string, integrityHash: string) =>
      [...queryKeys.assetLibrary.all, packId, integrityHash, 'status'] as const,
    packLibraryPage: (
      packId: string,
      integrityHash: string,
      groupKind: string,
      query: string,
      offset: number,
      limit: number,
      cacheVersion: string,
    ) =>
      [
        ...queryKeys.assetLibrary.all,
        packId,
        integrityHash,
        'page',
        groupKind,
        query,
        offset,
        limit,
        cacheVersion,
      ] as const,
    previews: (packId: string, refsKey: string) =>
      [...queryKeys.assetLibrary.all, packId, 'previews', refsKey] as const,
  },
  workingPalettes: {
    all: ['workingPalettes'] as const,
    project: (projectId: string) => [...queryKeys.workingPalettes.all, projectId] as const,
  },
  plugins: {
    all: ['plugins'] as const,
    list: () => [...queryKeys.plugins.all, 'list'] as const,
    manifest: (pluginId: string) => [...queryKeys.plugins.all, pluginId, 'manifest'] as const,
    contributions: () => [...queryKeys.plugins.all, 'contributions'] as const,
  },
  catalog: {
    all: ['catalog'] as const,
    resolve: (projectId: string) => [...queryKeys.catalog.all, projectId, 'resolve'] as const,
    validate: (projectId: string) => [...queryKeys.catalog.all, projectId, 'validate'] as const,
  },
  jobs: {
    all: ['jobs'] as const,
    list: () => [...queryKeys.jobs.all, 'list'] as const,
    detail: (jobId: string) => [...queryKeys.jobs.all, jobId] as const,
  },
  builds: {
    all: ['builds'] as const,
    list: (projectId: string) => [...queryKeys.builds.all, projectId, 'list'] as const,
    detail: (buildId: string) => [...queryKeys.builds.all, buildId] as const,
  },
  exports: {
    all: ['exports'] as const,
    list: (buildId: string) => [...queryKeys.exports.all, buildId, 'list'] as const,
    detail: (exportId: string) => [...queryKeys.exports.all, exportId] as const,
  },
  deployments: {
    all: ['deployments'] as const,
    list: (buildId: string) => [...queryKeys.deployments.all, buildId, 'list'] as const,
    detail: (deploymentId: string) => [...queryKeys.deployments.all, deploymentId] as const,
  },
  playtest: {
    all: ['playtest'] as const,
    list: () => [...queryKeys.playtest.all, 'list'] as const,
  },
  support: {
    all: ['support'] as const,
    list: () => [...queryKeys.support.all, 'list'] as const,
    detail: (bundleId: string) => [...queryKeys.support.all, bundleId] as const,
  },
  system: {
    all: ['system'] as const,
    version: () => [...queryKeys.system.all, 'version'] as const,
    homePaths: () => [...queryKeys.system.all, 'homePaths'] as const,
  },
  logs: {
    all: ['logs'] as const,
    list: () => [...queryKeys.logs.all, 'list'] as const,
  },
} as const;
