import { AssetLibraryReference } from '@tileborne/core';
import { useMemo } from 'react';

import { useAssetPacks, useTilesetPacks } from '@/hooks/queries';
import { buildLibraryPreviewIndex, type LibraryPreviewRef } from '@/lib/asset-library-bridge';

export interface ResolvedPlaceableVisual {
  readonly placeableId: string;
  readonly name: string;
  readonly packId: string;
  readonly packName: string;
  readonly integrityHash: string | undefined;
  readonly preview: LibraryPreviewRef | undefined;
}

/**
 * Resolves a `visual-ref.placeableId` to its owning installed pack and
 * preview geometry (same SSOT crop policy as the asset browser:
 * `buildLibraryPreviewIndex`). Returns `undefined` while packs are still
 * loading or when no installed pack exposes the placeable.
 */
export const usePlaceableVisual = (
  placeableId: string | undefined,
): ResolvedPlaceableVisual | undefined => {
  const packsQuery = useAssetPacks();
  const packs = useMemo(() => packsQuery.data?.packs ?? [], [packsQuery.data?.packs]);
  const packIds = useMemo(() => packs.map((pack) => String(pack.id)), [packs]);
  const packResults = useTilesetPacks(placeableId === undefined ? [] : packIds);

  return useMemo(() => {
    if (placeableId === undefined) {
      return undefined;
    }
    for (const [index, packId] of packIds.entries()) {
      const tilesetPack = packResults[index]?.data;
      const placeable = tilesetPack?.placeables?.find(
        (entry) => String(entry.id) === placeableId,
      );
      if (tilesetPack === undefined || placeable === undefined) {
        continue;
      }
      const pack = packs[index];
      return {
        placeableId,
        name: placeable.name,
        packId,
        packName: pack?.name ?? packId,
        integrityHash: pack?.integrityHash,
        preview: buildLibraryPreviewIndex(tilesetPack).previewForRef(
          new AssetLibraryReference({
            packId: tilesetPack.id,
            kind: 'placeable',
            refId: placeable.id,
          }),
        ),
      };
    }
    return undefined;
  }, [packIds, packResults, packs, placeableId]);
};
