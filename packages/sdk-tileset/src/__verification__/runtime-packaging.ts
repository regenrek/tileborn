type ManifestRecord = Record<string, unknown>;

const tileIdsReferencedByAnimations = (
  manifest: ManifestRecord,
  referencedTileIds: Set<string>,
): Set<string> => {
  const animationIds = new Set(
    ((manifest.tiles as ManifestRecord[] | undefined) ?? [])
      .filter(
        (tile) =>
          referencedTileIds.has(String(tile.id)) && typeof tile.animationId === "string",
      )
      .map((tile) => String(tile.animationId)),
  );

  return new Set(
    ((manifest.animations as ManifestRecord[] | undefined) ?? [])
      .filter((animation) => animationIds.has(String(animation.id)))
      .flatMap((animation) =>
        ((animation.frames as ManifestRecord[] | undefined) ?? []).map((frame) =>
          String(frame.tileId),
        ),
      ),
  );
};

/** Filter a Tileborne manifest down to tiles referenced by a map layer. */
export const buildReferencedTilesetManifest = (
  manifest: ManifestRecord,
  referencedTileIdsInput: Iterable<string>,
): ManifestRecord => {
  const referencedTileIds = new Set([...referencedTileIdsInput].map(String));
  for (const tileId of tileIdsReferencedByAnimations(manifest, referencedTileIds)) {
    referencedTileIds.add(tileId);
  }

  const referencedTiles = ((manifest.tiles as ManifestRecord[] | undefined) ?? []).filter((tile) =>
    referencedTileIds.has(String(tile.id)),
  );
  const referencedTilesetIds = new Set(referencedTiles.map((tile) => String(tile.tilesetId)));
  const referencedTilesets = ((manifest.tilesets as ManifestRecord[] | undefined) ?? []).filter(
    (tileset) => referencedTilesetIds.has(String(tileset.id)),
  );
  const referencedAssetIds = new Set(
    referencedTilesets.map((tileset) => String(tileset.atlasAssetId)),
  );
  const referencedAnimationIds = new Set(
    referencedTiles.flatMap((tile) =>
      typeof tile.animationId === "string" ? [String(tile.animationId)] : [],
    ),
  );

  return {
    ...manifest,
    assets: ((manifest.assets as ManifestRecord[] | undefined) ?? []).filter((asset) =>
      referencedAssetIds.has(String(asset.id)),
    ),
    tilesets: referencedTilesets,
    tiles: referencedTiles,
    animations: ((manifest.animations as ManifestRecord[] | undefined) ?? []).filter((animation) =>
      referencedAnimationIds.has(String(animation.id)),
    ),
    collisionMasks: ((manifest.collisionMasks as ManifestRecord[] | undefined) ?? []).filter(
      (entry) => referencedTileIds.has(String(entry.tileId)),
    ),
    autotileRules: ((manifest.autotileRules as ManifestRecord[] | undefined) ?? []).filter((rule) =>
      referencedTilesetIds.has(String(rule.tilesetId)),
    ),
    variantFilters: ((manifest.variantFilters as ManifestRecord[] | undefined) ?? []).filter(
      (filter) =>
        ((filter.tileIds as unknown[] | undefined) ?? []).some((tileId) =>
          referencedTileIds.has(String(tileId)),
        ),
    ),
    terrainTransitions: (
      (manifest.terrainTransitions as ManifestRecord[] | undefined) ?? []
    ).filter((transition) => referencedTilesetIds.has(String(transition.tilesetId))),
  };
};

export const manifestSummary = (manifest: ManifestRecord) => ({
  tileCount: ((manifest.tiles as unknown[] | undefined) ?? []).length,
  tilesetCount: ((manifest.tilesets as unknown[] | undefined) ?? []).length,
  assetCount: ((manifest.assets as unknown[] | undefined) ?? []).length,
  animationCount: ((manifest.animations as unknown[] | undefined) ?? []).length,
  collisionMaskCount: ((manifest.collisionMasks as unknown[] | undefined) ?? []).length,
  autotileRuleCount: ((manifest.autotileRules as unknown[] | undefined) ?? []).length,
  variantFilterCount: ((manifest.variantFilters as unknown[] | undefined) ?? []).length,
  terrainTransitionCount: ((manifest.terrainTransitions as unknown[] | undefined) ?? []).length,
});
