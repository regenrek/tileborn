import {
  BundledAssetIdSchema,
  type BundledAssetId,
  type BundledAssetSpec,
} from "@tileborne/runtime";
import { Schema } from "effect";

import { ARENA_PLUGIN_ID } from "../constants.js";

const svgDataUrl = (svg: string): string =>
  `data:image/svg+xml,${encodeURIComponent(svg)}`;

const bundledAssetId = (assetKey: string): BundledAssetId =>
  Schema.decodeUnknownSync(BundledAssetIdSchema)(`${ARENA_PLUGIN_ID}:${assetKey}`);

export const ARENA_PLAYER_TEXTURE_ASSET_ID = bundledAssetId("player");
export const ARENA_DUMMY_TEXTURE_ASSET_ID = bundledAssetId("dummy");
export const ARENA_HEALTH_BAR_TEXTURE_ASSET_ID = bundledAssetId("health-bar");

export const createArenaBundledAssets = (): readonly BundledAssetSpec[] => [
  {
    assetId: ARENA_PLAYER_TEXTURE_ASSET_ID,
    path: svgDataUrl(
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="9" fill="#38bdf8"/><circle cx="12" cy="12" r="4" fill="#0f172a"/></svg>',
    ),
    mime: "image/svg+xml",
    width: 24,
    height: 24,
  },
  {
    assetId: ARENA_DUMMY_TEXTURE_ASSET_ID,
    path: svgDataUrl(
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect x="5" y="5" width="14" height="14" rx="2" fill="#f97316"/><path d="M8 8l8 8M16 8l-8 8" stroke="#7c2d12" stroke-width="2"/></svg>',
    ),
    mime: "image/svg+xml",
    width: 24,
    height: 24,
  },
  {
    assetId: ARENA_HEALTH_BAR_TEXTURE_ASSET_ID,
    path: svgDataUrl(
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="3"><rect width="16" height="3" fill="#22c55e"/></svg>',
    ),
    mime: "image/svg+xml",
    width: 16,
    height: 3,
  },
];
