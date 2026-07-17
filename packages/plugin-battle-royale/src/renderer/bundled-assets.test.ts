import { BundledAssetIdSchema } from '@tileborne/runtime';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  createBattleRoyaleBundledAssets,
  DECOY_TEXTURE_ASSET_ID,
  IMPACT_BURST_TEXTURE_ASSET_ID,
  LOOT_CRATE_TEXTURE_ASSET_ID,
  PLAYER_TEXTURE_ASSET_ID,
  PROJECTILE_TEXTURE_ASSET_ID,
  SCAN_PULSE_TEXTURE_ASSET_ID,
  SHADOW_TEXTURE_ASSET_ID,
  SHIELD_TEXTURE_ASSET_ID,
  TRAP_TEXTURE_ASSET_ID,
  UI_PIXEL_TEXTURE_ASSET_ID,
  WEAPON_RIFLE_TEXTURE_ASSET_ID,
} from './bundled-assets.js';
import { requiredBattleRoyaleRenderableAssetIds } from './battle-royale-projector.js';

describe('createBattleRoyaleBundledAssets', () => {
  // Regression guard for the ADR-0014 blocker (old task t-v8y1): the bundled
  // entity textures used to be built as a synthetic `AssetPackManifestAsset`
  // with `{ disableChecks: true }`, which throws under Effect 4.0.0-beta.70
  // because field-level brand/pattern checks are no longer bypassed. They now
  // ride the canonical BundledAssetId path, so construction must never throw.
  it('constructs the player and projectile specs without throwing', () => {
    expect(() => createBattleRoyaleBundledAssets()).not.toThrow();
    expect(createBattleRoyaleBundledAssets()).toHaveLength(11);
  });

  it('uses BundledAssetIds that pass the brand schema (not asset:<uuid>)', () => {
    for (const asset of createBattleRoyaleBundledAssets()) {
      expect(() => Schema.decodeUnknownSync(BundledAssetIdSchema)(asset.assetId)).not.toThrow();
    }
    // The synthetic asset-pack id shape that previously crashed must still be
    // rejected, proving these ids are genuinely on the bundled-asset path.
    expect(() =>
      Schema.decodeUnknownSync(BundledAssetIdSchema)('asset:00000000-0000-0000-0000-000000000000'),
    ).toThrow();
  });

  it('exposes data-URL PNG textures keyed by the exported asset ids', () => {
    const assets = createBattleRoyaleBundledAssets();
    const player = assets.find((asset) => asset.assetId === PLAYER_TEXTURE_ASSET_ID);
    const projectile = assets.find((asset) => asset.assetId === PROJECTILE_TEXTURE_ASSET_ID);
    expect(player?.assetId).toBe(PLAYER_TEXTURE_ASSET_ID);
    expect(projectile?.assetId).toBe(PROJECTILE_TEXTURE_ASSET_ID);
    expect(projectile).toMatchObject({ width: 48, height: 48 });
    expect(assets.map((asset) => asset.assetId)).toEqual([
      PLAYER_TEXTURE_ASSET_ID,
      PROJECTILE_TEXTURE_ASSET_ID,
      SHIELD_TEXTURE_ASSET_ID,
      SCAN_PULSE_TEXTURE_ASSET_ID,
      DECOY_TEXTURE_ASSET_ID,
      TRAP_TEXTURE_ASSET_ID,
      LOOT_CRATE_TEXTURE_ASSET_ID,
      WEAPON_RIFLE_TEXTURE_ASSET_ID,
      IMPACT_BURST_TEXTURE_ASSET_ID,
      SHADOW_TEXTURE_ASSET_ID,
      UI_PIXEL_TEXTURE_ASSET_ID,
    ]);
    for (const asset of assets) {
      expect(asset.mime).toBe('image/png');
      expect(asset.path.startsWith('data:image/png;base64,')).toBe(true);
    }
  });

  it('uses distinct production fallback textures instead of old 24px aliases', () => {
    const assets = createBattleRoyaleBundledAssets().filter(
      (asset) => asset.assetId !== UI_PIXEL_TEXTURE_ASSET_ID,
    );
    const byId = new Map(assets.map((asset) => [asset.assetId, asset]));

    expect(new Set(assets.map((asset) => asset.path)).size).toBe(assets.length);
    for (const asset of assets) {
      expect(asset.width).toBeGreaterThanOrEqual(48);
      expect(asset.height).toBeGreaterThanOrEqual(48);
    }
    expect(byId.get(WEAPON_RIFLE_TEXTURE_ASSET_ID)?.path).not.toBe(
      byId.get(PROJECTILE_TEXTURE_ASSET_ID)?.path,
    );
    expect(byId.get(IMPACT_BURST_TEXTURE_ASSET_ID)?.path).not.toBe(
      byId.get(SCAN_PULSE_TEXTURE_ASSET_ID)?.path,
    );
    expect(byId.get(SHADOW_TEXTURE_ASSET_ID)?.path).not.toBe(
      byId.get(SHIELD_TEXTURE_ASSET_ID)?.path,
    );
  });

  it('covers every asset the BR projector can emit before playtest starts', () => {
    const registered = new Set(
      createBattleRoyaleBundledAssets().map((asset) => String(asset.assetId)),
    );

    expect(
      requiredBattleRoyaleRenderableAssetIds().filter((assetId) => !registered.has(assetId)),
    ).toEqual([]);
  });
});
