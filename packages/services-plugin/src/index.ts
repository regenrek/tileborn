import { Layer } from "effect";

import { ConfigLayer } from "@tileborne/services-foundation";

import { PluginInstallerServiceLive } from "./installer/index.js";
import { PluginExecutionContextService, PluginLoaderServiceLive } from "./loader/index.js";
import { PluginRegistryServiceLive } from "./registry/index.js";

export * from "./model.js";
export * from "./registry/index.js";
export * from "./installer/index.js";
export * from "./loader/index.js";
export * from "./scaffold.js";
export * from "./manifest-version.js";
export { materializePluginManifestInput, resolvePluginManifestPath } from "./filesystem.js";

export const PluginRegistryLayer = PluginRegistryServiceLive.pipe(Layer.provideMerge(ConfigLayer));

export const PluginInstallerLayer = PluginInstallerServiceLive.pipe(Layer.provideMerge(PluginRegistryLayer));

export const PluginLoaderMainLayer = PluginLoaderServiceLive.pipe(
  Layer.provideMerge(PluginRegistryLayer),
  Layer.provideMerge(PluginExecutionContextService.main),
);

export const PluginLoaderCliLayer = PluginLoaderServiceLive.pipe(
  Layer.provideMerge(PluginRegistryLayer),
  Layer.provideMerge(PluginExecutionContextService.cli),
);

export const PluginLoaderRendererLayer = PluginLoaderServiceLive.pipe(
  Layer.provideMerge(PluginRegistryLayer),
  Layer.provideMerge(PluginExecutionContextService.renderer),
);

export const PluginServicesLayer = Layer.mergeAll(PluginInstallerLayer, PluginLoaderMainLayer);
