import type {
  AssetLibraryReference,
  WorkingPalette,
  WorkingPaletteItem,
} from '@tileborne/core';
import type {
  AutotileRuleIdType,
  ClipIdType,
  PlaceableIdType,
  TerrainClassType,
  TileIdType,
} from '@tileborne/sdk-tileset/schemas';

import type { BrushIntent } from '@/stores/editor-ui-store';

export type {
  WorkingPalette,
  WorkingPaletteItem,
};

export interface WorkingPaletteItemDraft {
  readonly ref: AssetLibraryReference;
  readonly label?: string | undefined;
}

/**
 * Stable identity key for a palette item so we can deduplicate when adding
 * groups or individual entries.
 */
export const assetLibraryReferenceKey = (ref: AssetLibraryReference): string =>
  `${ref.kind}:${ref.packId}:${ref.refId}:${ref.tileId ?? ''}`;

export const workingPaletteItemKey = (item: WorkingPaletteItem): string =>
  assetLibraryReferenceKey(item.ref);

export const workingPaletteItemToBrushIntent = (item: WorkingPaletteItem): BrushIntent => {
  switch (item.ref.kind) {
    case 'tile':
      return { kind: 'tile', packId: item.ref.packId, tileId: (item.ref.tileId ?? item.ref.refId) as TileIdType };
    case 'autotile':
      return { kind: 'autotile', packId: item.ref.packId, ruleId: item.ref.refId as AutotileRuleIdType };
    case 'terrain':
      return { kind: 'terrain', packId: item.ref.packId, classId: item.ref.refId as TerrainClassType };
    case 'placeable':
      return { kind: 'placeable', packId: item.ref.packId, placeableId: item.ref.refId as PlaceableIdType };
    case 'sprite':
      return {
        kind: 'placeable',
        packId: item.ref.packId,
        placeableId: item.ref.refId as PlaceableIdType,
        ...(item.ref.clipId === undefined ? {} : { clipId: item.ref.clipId as ClipIdType }),
      };
  }
};

export const brushIntentMatchesItem = (
  intent: BrushIntent,
  item: WorkingPaletteItem,
): boolean => {
  switch (item.ref.kind) {
    case 'tile':
      return (
        intent.kind === 'tile' &&
        (intent.packId === undefined || intent.packId === item.ref.packId) &&
        intent.tileId === ((item.ref.tileId ?? item.ref.refId) as TileIdType)
      );
    case 'autotile':
      return (
        intent.kind === 'autotile' &&
        (intent.packId === undefined || intent.packId === item.ref.packId) &&
        intent.ruleId === item.ref.refId
      );
    case 'terrain':
      return (
        intent.kind === 'terrain' &&
        (intent.packId === undefined || intent.packId === item.ref.packId) &&
        intent.classId === item.ref.refId
      );
    case 'placeable':
    case 'sprite':
      return (
        intent.kind === 'placeable' &&
        (intent.packId === undefined || intent.packId === item.ref.packId) &&
        intent.placeableId === item.ref.refId
      );
  }
};
