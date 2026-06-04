import { BundledAssetIdSchema } from "@tileborne/runtime";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  createBattleRoyaleBundledAssets,
  PLAYER_TEXTURE_ASSET_ID,
  PROJECTILE_TEXTURE_ASSET_ID,
} from "./bundled-assets.js";

describe("createBattleRoyaleBundledAssets", () => {
  // Regression guard for the ADR-0014 blocker (old task t-v8y1): the bundled
  // entity textures used to be built as a synthetic `AssetPackManifestAsset`
  // with `{ disableChecks: true }`, which throws under Effect 4.0.0-beta.70
  // because field-level brand/pattern checks are no longer bypassed. They now
  // ride the canonical BundledAssetId path, so construction must never throw.
  it("constructs the player and projectile specs without throwing", () => {
    expect(() => createBattleRoyaleBundledAssets()).not.toThrow();
    expect(createBattleRoyaleBundledAssets()).toHaveLength(2);
  });

  it("uses BundledAssetIds that pass the brand schema (not asset:<uuid>)", () => {
    for (const asset of createBattleRoyaleBundledAssets()) {
      expect(() => Schema.decodeUnknownSync(BundledAssetIdSchema)(asset.assetId)).not.toThrow();
    }
    // The synthetic asset-pack id shape that previously crashed must still be
    // rejected, proving these ids are genuinely on the bundled-asset path.
    expect(() =>
      Schema.decodeUnknownSync(BundledAssetIdSchema)("asset:00000000-0000-0000-0000-000000000000"),
    ).toThrow();
  });

  it("exposes data-URL PNG textures keyed by the exported asset ids", () => {
    const [player, projectile] = createBattleRoyaleBundledAssets();
    expect(player?.assetId).toBe(PLAYER_TEXTURE_ASSET_ID);
    expect(projectile?.assetId).toBe(PROJECTILE_TEXTURE_ASSET_ID);
    expect(projectile).toMatchObject({ width: 24, height: 8 });
    for (const asset of createBattleRoyaleBundledAssets()) {
      expect(asset.mime).toBe("image/png");
      expect(asset.path.startsWith("data:image/png;base64,")).toBe(true);
    }
  });
});
