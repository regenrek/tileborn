import type { AssetLibraryGroup, AssetLibraryReference } from '@tileborne/core';

/** What the picker hands back when the user chooses a sprite. */
export interface SpritePickerSelection {
  readonly placeableId: string;
  readonly name: string;
  readonly packId: string;
  readonly width: number;
  readonly height: number;
  readonly clips: readonly { readonly id: string; readonly name: string }[];
}

export interface SpritePickerEntry extends SpritePickerSelection {
  readonly packName: string;
  readonly integrityHash: string | undefined;
  readonly ref: AssetLibraryReference;
}

export const SPRITE_PICKER_PAGE_SIZE_PER_KIND = 48;
export const SPRITE_PICKER_DOM_LIMIT = SPRITE_PICKER_PAGE_SIZE_PER_KIND * 2;

const finitePositive = (value: string | undefined): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const parseClips = (
  value: string | undefined,
): readonly { readonly id: string; readonly name: string }[] => {
  if (value === undefined) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.flatMap((entry) => {
      if (typeof entry !== 'object' || entry === null) {
        return [];
      }
      const candidate = entry as { readonly id?: unknown; readonly name?: unknown };
      return typeof candidate.id === 'string' && typeof candidate.name === 'string'
        ? [{ id: candidate.id, name: candidate.name }]
        : [];
    });
  } catch {
    return [];
  }
};

export const spritePickerEntryFromGroup = (
  group: AssetLibraryGroup,
  packName: string,
  integrityHash: string | undefined,
): SpritePickerEntry | undefined => {
  if (group.primaryRef === undefined) {
    return undefined;
  }
  return {
    placeableId: String(group.primaryRef.refId),
    name: group.label,
    packId: String(group.packId),
    packName,
    integrityHash,
    width: finitePositive(group.metadata.width),
    height: finitePositive(group.metadata.height),
    clips: parseClips(group.metadata.clipsJson),
    ref: group.primaryRef,
  };
};
