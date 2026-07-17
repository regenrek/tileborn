import { Layer } from 'effect';

import { ServicesAppCoreLayer } from '@tileborne/services-app';
import {
  HomeServiceLive,
  JobServicePersistentLive,
  LoggerLayer,
} from '@tileborne/services-foundation';
import { PluginLoaderMainLayer, PluginRegistryLayer } from '@tileborne/services-plugin';

import {
  makeBuildServiceLive,
  nodeBuildPromotionOperations,
  type BuildPromotionOperations,
  type BuildServiceRuntimeOptions,
} from './build/index.js';
import { ExportServiceLive } from './export/index.js';
import { PlaytestServiceLive } from './playtest/index.js';
import { RuntimeDeployServiceLive } from './runtime-deploy/index.js';
import { SupportServiceLive } from './support/index.js';

export * from './model.js';
export * from './build/index.js';
export * from './behavior/compiler.js';
export * from './behavior/conversion.js';
export * from './behavior/project-package.js';
export * from './map-package/index.js';
export * from './export/index.js';
export * from './playtest/index.js';
export * from './runtime-deploy/index.js';
export * from './support/index.js';

const PersistentJobLayer = JobServicePersistentLive.pipe(Layer.provideMerge(HomeServiceLive));
const FoundationLayer = Layer.mergeAll(LoggerLayer, PersistentJobLayer);

const PluginLayer = PluginLoaderMainLayer.pipe(Layer.provideMerge(PluginRegistryLayer));

const AppLayer = ServicesAppCoreLayer;

const SupportLayer = SupportServiceLive;

const PlaytestLayer = PlaytestServiceLive.pipe(
  Layer.provideMerge(AppLayer),
  Layer.provideMerge(PluginRegistryLayer),
);

export const makeServicesBuildLayer = (
  promotionOperations: BuildPromotionOperations = nodeBuildPromotionOperations,
  runtimeOptions: BuildServiceRuntimeOptions = {},
) => {
  const BuildLayer = makeBuildServiceLive(promotionOperations, runtimeOptions).pipe(
    Layer.provideMerge(AppLayer),
    Layer.provideMerge(PluginLayer),
  );
  const ExportLayer = ExportServiceLive.pipe(
    Layer.provideMerge(BuildLayer),
    Layer.provideMerge(PluginLayer),
  );
  const RuntimeDeployLayer = RuntimeDeployServiceLive.pipe(Layer.provideMerge(BuildLayer));
  return Layer.mergeAll(
    BuildLayer,
    ExportLayer,
    PlaytestLayer,
    RuntimeDeployLayer,
    SupportLayer,
    AppLayer,
    PluginLayer,
    PluginRegistryLayer,
  ).pipe(Layer.provideMerge(FoundationLayer));
};

export const ServicesBuildLayer = makeServicesBuildLayer();
