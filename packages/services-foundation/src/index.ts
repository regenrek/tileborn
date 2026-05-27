import { Layer } from "effect";

import { ConfigServiceLive } from "./config/index.js";
import { HomeServiceLive } from "./home/index.js";
import { JobServiceLive } from "./job/index.js";
import { LoggerServiceLive } from "./logger/index.js";

export * from "./config/index.js";
export * from "./home/index.js";
export * from "./internal/atomic-json.js";
export * from "./job/index.js";
export * from "./logger/index.js";

export const ConfigLayer = ConfigServiceLive.pipe(Layer.provideMerge(HomeServiceLive));
export const LoggerLayer = LoggerServiceLive.pipe(Layer.provideMerge(ConfigLayer));
export const FoundationLayer = Layer.mergeAll(LoggerLayer, JobServiceLive);
