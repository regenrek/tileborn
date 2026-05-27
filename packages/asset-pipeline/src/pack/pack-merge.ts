import { AssetId, PackId } from "@tileborne/core";
import { Match, Schema } from "effect";

import { PackAssetIdCollisionError } from "../errors.js";
import { AssetPackManifestAsset, type Asset } from "./pack-manifest.js";
import { PackIndex } from "./pack-index.js";

export class AssetIdConflict extends Schema.Class<AssetIdConflict>("AssetIdConflict")({
  id: AssetId,
  packs: Schema.Array(PackId),
}) {}

export class MergedCatalogEntry extends Schema.Class<MergedCatalogEntry>("MergedCatalogEntry")({
  packId: PackId,
  asset: AssetPackManifestAsset,
}) {}

export class MergedCatalog extends Schema.Class<MergedCatalog>("MergedCatalog")({
  packs: Schema.Array(PackIndex),
  assets: Schema.Array(AssetPackManifestAsset),
  assetsById: Schema.ReadonlyMap(AssetId, Schema.Array(AssetPackManifestAsset)),
  packIdsByAssetId: Schema.ReadonlyMap(AssetId, Schema.Array(PackId)),
  entriesByAssetId: Schema.ReadonlyMap(AssetId, MergedCatalogEntry),
  conflicts: Schema.Array(AssetIdConflict),
}) {}

export class PreferFirst extends Schema.TaggedClass<PreferFirst>()("PreferFirst", {}) {}
export class PreferLast extends Schema.TaggedClass<PreferLast>()("PreferLast", {}) {}
export class StrictFail extends Schema.TaggedClass<StrictFail>()("StrictFail", {}) {}

export const ConflictResolutionStrategy = Schema.Union([PreferFirst, PreferLast, StrictFail]);
export type ConflictResolutionStrategy = typeof ConflictResolutionStrategy.Type;

export const mergePacks = (packs: readonly PackIndex[]): MergedCatalog => {
  const sortedPacks = [...packs].sort((left, right) => left.packId.localeCompare(right.packId));
  const assetsById = new Map<AssetId, Asset[]>();
  const packIdsByAssetId = new Map<AssetId, PackId[]>();
  const entriesByAssetId = new Map<AssetId, MergedCatalogEntry>();

  for (const pack of sortedPacks) {
    for (const asset of pack.assets) {
      const bucket = assetsById.get(asset.id) ?? [];
      bucket.push(asset);
      assetsById.set(asset.id, bucket);
      const packIds = packIdsByAssetId.get(asset.id) ?? [];
      packIds.push(pack.packId);
      packIdsByAssetId.set(asset.id, packIds);
    }
  }

  const conflicts = [...assetsById.entries()]
    .filter(([id]) => new Set(packIdsByAssetId.get(id) ?? []).size > 1)
    .map(
      ([id]) =>
        new AssetIdConflict({
          id,
          packs: [...new Set(packIdsByAssetId.get(id) ?? [])].sort((left, right) => left.localeCompare(right)),
        }),
    )
    .sort((left, right) => left.id.localeCompare(right.id));

  const assets = sortedPacks.flatMap((pack) => pack.assets);
  for (const [id, assetsForId] of assetsById.entries()) {
    const packIds = packIdsByAssetId.get(id) ?? [];
    if (assetsForId.length === 1 && packIds.length === 1) {
      entriesByAssetId.set(id, new MergedCatalogEntry({ packId: packIds[0]!, asset: assetsForId[0]! }));
    }
  }

  return new MergedCatalog({
    packs: Object.freeze(sortedPacks),
    assets: Object.freeze(assets),
    assetsById: new Map([...assetsById.entries()].map(([id, entries]) => [id, Object.freeze([...entries])])),
    packIdsByAssetId: new Map(
      [...packIdsByAssetId.entries()].map(([id, packIds]) => [id, Object.freeze([...packIds])]),
    ),
    entriesByAssetId: new Map(entriesByAssetId),
    conflicts: Object.freeze(conflicts),
  });
};

export const resolveConflicts = (
  merged: MergedCatalog,
  strategy: ConflictResolutionStrategy,
): MergedCatalog => {
  Match.valueTags(strategy, {
    PreferFirst: () => undefined,
    PreferLast: () => undefined,
    StrictFail: () => {
      if (merged.conflicts.length > 0) {
        const first = merged.conflicts[0]!;
        throw new PackAssetIdCollisionError({
          id: first.id,
          packs: first.packs,
          message: `asset id ${first.id} appears in ${first.packs.length} packs`,
        });
      }
    },
  });

  if (merged.conflicts.length === 0) {
    return merged;
  }

  const chooseIndex = Match.valueTags(strategy, {
    PreferFirst: () => () => 0,
    PreferLast: () => (length: number) => length - 1,
    StrictFail: () => () => 0,
  });
  const assetsById = new Map<AssetId, Asset[]>();
  const packIdsByAssetId = new Map<AssetId, PackId[]>();
  const entriesByAssetId = new Map<AssetId, MergedCatalogEntry>();
  for (const [id, assets] of merged.assetsById.entries()) {
    const packIds = merged.packIdsByAssetId.get(id) ?? [];
    const selectedIndex = chooseIndex(assets.length);
    const chosen = assets[selectedIndex];
    const chosenPackId = packIds[selectedIndex];
    if (chosen !== undefined) {
      assetsById.set(id, [chosen]);
    }
    if (chosenPackId !== undefined) {
      packIdsByAssetId.set(id, [chosenPackId]);
    }
    if (chosen !== undefined && chosenPackId !== undefined) {
      entriesByAssetId.set(id, new MergedCatalogEntry({ packId: chosenPackId, asset: chosen }));
    }
  }

  return new MergedCatalog({
    packs: merged.packs,
    assets: Object.freeze([...assetsById.values()].flat()),
    assetsById: new Map([...assetsById.entries()].map(([id, assets]) => [id, Object.freeze([...assets])])),
    packIdsByAssetId: new Map(
      [...packIdsByAssetId.entries()].map(([id, packIds]) => [id, Object.freeze([...packIds])]),
    ),
    entriesByAssetId: new Map(entriesByAssetId),
    conflicts: Object.freeze([]),
  });
};
