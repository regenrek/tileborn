import {
  BundledAssetIdSchema,
  type BundledAssetId,
  type BundledAssetSpec,
} from "@tileborne/runtime";
import { Schema } from "effect";

import { PLUGIN_ID } from "../constants.js";

const PLAYER_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAAb0lEQVR42mNgGAxATkPjPzZMNUP9FvRgxWRbRshgXBYRbTixBmOziGaGE7SE1GAhObioYTheX9DUArxJUUSEPDlkSwhZgMsgvHLEWkCVYBq1gCopCRsePPmALkUFzQs7uhTXdKlw6FJl0qXSpxYAAN21YA78JZyoAAAAAElFTkSuQmCC";

const PROJECTILE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAABgAAAAICAYAAADjoT9jAAAAkklEQVR42r3RsQrCMBDG8dBaWqtoldYigotSXDoVxKWLi5OLSxdBXJz7ZJl8Jh/B9fxHgnQW0oMfWe7ug4tSfZXowoOPAQKEiDBEjBHGmGCKBDPMkSLDAnlXNyC2g6Z5iTU22KFEhQNqHHHCGRc0uOKOh8hLvi+UtOntRxcrbO3Cvbyf8hcTYLkPcH6i3j7ZVX0ASHRJ2m7mbvoAAAAASUVORK5CYII=";

const dataUrl = (base64: string): string => `data:image/png;base64,${base64}`;

const bundledAssetId = (assetKey: string): BundledAssetId =>
  Schema.decodeUnknownSync(BundledAssetIdSchema)(`${PLUGIN_ID}:${assetKey}`);

export const PLAYER_TEXTURE_ASSET_ID = bundledAssetId("default-pet");
export const PROJECTILE_TEXTURE_ASSET_ID = bundledAssetId("projectile-bolt");

export const createBattleRoyaleBundledAssets = (): readonly BundledAssetSpec[] => [
  {
    assetId: PLAYER_TEXTURE_ASSET_ID,
    path: dataUrl(PLAYER_PNG_BASE64),
    mime: "image/png",
    width: 24,
    height: 24,
  },
  {
    assetId: PROJECTILE_TEXTURE_ASSET_ID,
    path: dataUrl(PROJECTILE_PNG_BASE64),
    mime: "image/png",
    width: 24,
    height: 8,
  },
];
