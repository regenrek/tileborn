import { Layer } from "effect";

import { ServicesBuildLayer } from "@tileborne/services-build";
import { ConfigLayer, LoggerServiceLive } from "@tileborne/services-foundation";
import { PluginInstallerLayer } from "@tileborne/services-plugin";

const LoggerStack = LoggerServiceLive.pipe(Layer.provideMerge(ConfigLayer));

/** Desktop main-process service graph (single ManagedRuntime). */
export const AppLayer = ServicesBuildLayer.pipe(
  Layer.provideMerge(PluginInstallerLayer),
  Layer.provideMerge(LoggerStack),
);
