import type { ContentHash } from "@tileborne/core";
import { makePackId } from "@tileborne/core";

import type { BundledManifest } from "../../types.js";

export const SMOKE_PLUGIN_ID = "@tileborne-plugins/smoke-fixture";
export const SMOKE_ASSET_PACK_ID = makePackId("550e8400-e29b-41d4-a716-446655440099");
export const SMOKE_RUNTIME_VERSION = "0.0.0-smoke";
export const SMOKE_BUILD_ID =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as ContentHash;
export const SMOKE_SEED = 42_424_242;

export const smokeBundledManifest = (): BundledManifest => ({
  schemaVersion: 1,
  buildId: SMOKE_BUILD_ID,
  plugin: {
    id: SMOKE_PLUGIN_ID,
    version: "0.1.0-smoke",
    files: [{ path: "plugin/runtime.js", hash: SMOKE_BUILD_ID, size: 24 }],
  },
  assetPacks: [
    {
      id: SMOKE_ASSET_PACK_ID,
      version: "1.0.0-smoke",
      files: [{ path: "assets/tiles/terrain.png", hash: SMOKE_BUILD_ID, size: 8 }],
    },
  ],
  maps: [],
  runtimeVersion: SMOKE_RUNTIME_VERSION,
  protocolVersion: 1,
  workerFiles: [{ path: "worker.js", hash: SMOKE_BUILD_ID, size: 1024 }],
  createdAt: "2026-01-01T00:00:00.000Z",
});
