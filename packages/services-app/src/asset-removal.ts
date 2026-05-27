import type { PackId, ProjectId, WorkingPaletteId } from '@tileborne/core';
import { Effect } from 'effect';

import { AssetService, type AssetServiceError } from './asset/index.js';
import {
  AssetLibraryService,
  WorkingPaletteService,
  type AssetLibraryServiceError,
} from './asset-library/index.js';

export interface RemoveAssetPackResult {
  readonly removedPackId: PackId;
  readonly invalidatedAssetLibraryCacheEntries: number;
  readonly prunedWorkingPaletteItemCount: number;
  readonly affectedProjectIds: readonly ProjectId[];
  readonly affectedPaletteIds: readonly WorkingPaletteId[];
}

export const removeAssetPack = (
  packId: PackId,
): Effect.Effect<
  RemoveAssetPackResult,
  AssetServiceError | AssetLibraryServiceError,
  AssetService | AssetLibraryService | WorkingPaletteService
> =>
  Effect.gen(function* () {
    const assets = yield* AssetService;
    const assetLibrary = yield* AssetLibraryService;
    const workingPalettes = yield* WorkingPaletteService;

    const pack = yield* assets.getPack(packId);
    const invalidatedCache = yield* assetLibrary.invalidatePackCache({ packId: pack.id });
    const prunedPalettes = yield* workingPalettes.prunePackReferences({ packId: pack.id });
    yield* assets.removePack(pack.id);

    return {
      removedPackId: pack.id,
      invalidatedAssetLibraryCacheEntries: invalidatedCache.removedEntries,
      prunedWorkingPaletteItemCount: prunedPalettes.removedItemCount,
      affectedProjectIds: prunedPalettes.affectedProjectIds,
      affectedPaletteIds: prunedPalettes.affectedPaletteIds,
    };
  });
