import { Layer } from "effect";

import { ServicesBuildLayer } from "@tileborne/services-build";
import { ConfigLayer, LoggerServiceLive } from "@tileborne/services-foundation";
import { PluginInstallerLayer } from "@tileborne/services-plugin";

import { CatalogServiceLive } from "./catalog/index.js";

const LoggerStack = LoggerServiceLive.pipe(Layer.provideMerge(ConfigLayer));

/**
 * Desktop main-process service graph (single ManagedRuntime). The editor
 * catalog app service (ADR-0025) layers on top of `ServicesBuildLayer`, which
 * already exposes the `PluginLoaderService`/`PluginRegistryService`/`ProjectService`
 * it needs.
 */
export const AppLayer = CatalogServiceLive.pipe(
  Layer.provideMerge(ServicesBuildLayer),
  Layer.provideMerge(PluginInstallerLayer),
  Layer.provideMerge(LoggerStack),
);
