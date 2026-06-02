import type { FileFilter } from 'electron';

export const TILED_MAP_SOURCE_EXTENSIONS = ['tmx', 'tmj', 'json'] as const;
export const TILED_TILESET_SOURCE_EXTENSIONS = ['tsx', 'tsj'] as const;
export const TILED_SOURCE_EXTENSIONS = [
  ...TILED_MAP_SOURCE_EXTENSIONS,
  ...TILED_TILESET_SOURCE_EXTENSIONS,
] as const;

export const SPRITE_SHEET_IMAGE_EXTENSIONS = ['png', 'webp'] as const;

export const importSourceDialogFilters: FileFilter[] = [
  { name: 'Tiled source files', extensions: [...TILED_SOURCE_EXTENSIONS] },
  { name: 'Tiled maps', extensions: [...TILED_MAP_SOURCE_EXTENSIONS] },
  { name: 'Tiled tilesets', extensions: [...TILED_TILESET_SOURCE_EXTENSIONS] },
  { name: 'All files', extensions: ['*'] },
];

/** Filters for the Sprite/Animation Studio single-image picker (PNG/WebP sheets). */
export const spriteSheetImageDialogFilters: FileFilter[] = [
  { name: 'Sprite sheet images', extensions: [...SPRITE_SHEET_IMAGE_EXTENSIONS] },
  { name: 'All files', extensions: ['*'] },
];
