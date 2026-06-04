import type { LibraryPreviewIndex, LibraryPreviewRef } from '@tileborne/sdk-tileset/renderer';
import type { AssetLibraryReference, AssetLibraryGroup, AssetLibraryGroupKind } from '@tileborne/core';

import type { WorkingPaletteItemDraft } from '@/lib/working-palettes-bridge';

export {
  buildLibraryPreviewIndex,
  type LibraryPreviewIndex,
  type LibraryPreviewRef,
} from '@tileborne/sdk-tileset/renderer';

export type LibraryTabKind = Extract<
  AssetLibraryGroupKind,
  'tileset' | 'terrain' | 'autotile' | 'placeable'
>;

/**
 * Convert a sourceful identifier (`namespace:source=foo/Bar Tiles.tmx`) into a
 * compact human label. Mirrors the convention used by the existing tileset
 * palette so the asset library reads consistently across the app.
 */
const titleCaseWord = (word: string): string => {
  if (/^[A-Z0-9]+$/.test(word)) {
    return word;
  }
  return `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`;
};

export const humanizeIdentifier = (
  value: string,
  options: { readonly dropTerrainSuffix?: boolean } = {},
): string => {
  const namespaced = value.includes(':') ? value.split(':').slice(1).join(':') : value;
  const sourceTail =
    namespaced
      .replace(/^source=/i, '')
      .replaceAll('\\', '/')
      .split('/')
      .filter(Boolean)
      .at(-1) ?? namespaced;
  const normalized = sourceTail
    .replace(/\.(?:tmx|tsx|png|json)$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const withoutTerrainSuffix =
    options.dropTerrainSuffix && normalized.split(' ').length > 1
      ? normalized.replace(/\s+terrain$/i, '')
      : normalized;
  const displayName = withoutTerrainSuffix.split(' ').filter(Boolean).map(titleCaseWord).join(' ');
  return displayName.length > 0 ? displayName : value;
};

export const libraryGroupToPaletteDrafts = (
  group: AssetLibraryGroup,
): readonly WorkingPaletteItemDraft[] => {
  if (group.primaryRef !== undefined) {
    return [{ ref: group.primaryRef, label: group.label }];
  }
  return group.previewRefs.map((ref) => ({ ref, label: group.label }));
};

export const libraryGroupPrimaryPreview = (
  group: AssetLibraryGroup,
  previewIndex: LibraryPreviewIndex | undefined,
): LibraryPreviewRef | undefined => {
  if (previewIndex === undefined) {
    return undefined;
  }
  const primary = group.primaryRef ?? group.previewRefs[0];
  return primary === undefined ? undefined : previewIndex.previewForRef(primary);
};

export const libraryGroupPreviews = (
  group: AssetLibraryGroup,
  previewIndex: LibraryPreviewIndex | undefined,
  options: { readonly limit?: number | undefined } = {},
): readonly LibraryPreviewRef[] =>
  previewIndex === undefined
    ? []
    : previewIndex.previewsForRefs(
        options.limit === undefined ? group.previewRefs : group.previewRefs.slice(0, options.limit),
      );

export const libraryGroupPreviewRefs = (
  group: AssetLibraryGroup,
  previewIndex: LibraryPreviewIndex | undefined,
  options: { readonly limit?: number | undefined } = {},
): readonly AssetLibraryReference[] =>
  previewIndex === undefined
    ? options.limit === undefined
      ? group.previewRefs
      : group.previewRefs.slice(0, options.limit)
    : previewIndex.refsForGroup(group, options);
