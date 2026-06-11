import { Layer } from "effect";

import { ServicesAppLayer } from "@tileborne/services-app";
import { ConfigLayer, HomeServiceLive, JobServiceLive } from "@tileborne/services-foundation";
import { PluginLoaderMainLayer, PluginRegistryLayer } from "@tileborne/services-plugin";

import { BuildServiceLive } from "./build/index.js";
import { ExportServiceLive } from "./export/index.js";
import { PlaytestServiceLive } from "./playtest/index.js";
import { RuntimeDeployServiceLive } from "./runtime-deploy/index.js";
import { SupportServiceLive } from "./support/index.js";

export * from "./model.js";
export * from "./build/index.js";
export * from "./map-package/index.js";
export * from "./export/index.js";
export * from "./playtest/index.js";
export * from "./runtime-deploy/index.js";
export * from "./support/index.js";

const FoundationLayer = Layer.mergeAll(HomeServiceLive, JobServiceLive, ConfigLayer);

const PluginLayer = PluginLoaderMainLayer.pipe(
  Layer.provideMerge(PluginRegistryLayer),
  Layer.provideMerge(FoundationLayer),
);

const AppLayer = ServicesAppLayer.pipe(Layer.provideMerge(FoundationLayer));

const BuildLayer = BuildServiceLive.pipe(
  Layer.provideMerge(AppLayer),
  Layer.provideMerge(PluginRegistryLayer),
);

const ExportLayer = ExportServiceLive.pipe(Layer.provideMerge(BuildLayer), Layer.provideMerge(PluginLayer));

const RuntimeDeployLayer = RuntimeDeployServiceLive.pipe(
  Layer.provideMerge(BuildLayer),
  Layer.provideMerge(FoundationLayer),
);

const SupportLayer = SupportServiceLive.pipe(Layer.provideMerge(FoundationLayer));

const PlaytestLayer = PlaytestServiceLive.pipe(
  Layer.provideMerge(AppLayer),
  Layer.provideMerge(PluginRegistryLayer),
);

export const ServicesBuildLayer = Layer.mergeAll(
  BuildLayer,
  ExportLayer,
  PlaytestLayer,
  RuntimeDeployLayer,
  SupportLayer,
);
