import { Layer } from 'effect';
import path from 'node:path';
import { app } from 'electron';

import { makeServicesBuildLayer, nodeBuildPromotionOperations } from '@tileborne/services-build';
import { ConfigLayer, LoggerServiceLive } from '@tileborne/services-foundation';
import { PluginInstallerLayer } from '@tileborne/services-plugin';

import { CatalogServiceLive } from './catalog/index.js';

const LoggerStack = LoggerServiceLive.pipe(Layer.provideMerge(ConfigLayer));
const gameHostBuildAssetsRoot = app.isPackaged
  ? path.join(process.resourcesPath, 'game-host-build-assets')
  : path.resolve(app.getAppPath(), '../game-host/dist/build-assets');
const DesktopServicesBuildLayer = makeServicesBuildLayer(nodeBuildPromotionOperations, {
  gameHostBuildAssetsRoot,
});

/**
 * Desktop main-process service graph (single ManagedRuntime). The editor
 * catalog app service (ADR-0025) layers on top of `ServicesBuildLayer`, which
 * already exposes the `PluginLoaderService`/`PluginRegistryService`/`ProjectService`
 * it needs.
 */
export const AppLayer = CatalogServiceLive.pipe(
  Layer.provideMerge(DesktopServicesBuildLayer),
  Layer.provideMerge(PluginInstallerLayer),
  Layer.provideMerge(LoggerStack),
);
