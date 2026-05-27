import type { FileFilter } from 'electron';

export const TILED_MAP_SOURCE_EXTENSIONS = ['tmx', 'tmj', 'json'] as const;
export const TILED_TILESET_SOURCE_EXTENSIONS = ['tsx', 'tsj'] as const;
export const TILED_SOURCE_EXTENSIONS = [
  ...TILED_MAP_SOURCE_EXTENSIONS,
  ...TILED_TILESET_SOURCE_EXTENSIONS,
] as const;

export const importSourceDialogFilters: FileFilter[] = [
  { name: 'Tiled source files', extensions: [...TILED_SOURCE_EXTENSIONS] },
  { name: 'Tiled maps', extensions: [...TILED_MAP_SOURCE_EXTENSIONS] },
  { name: 'Tiled tilesets', extensions: [...TILED_TILESET_SOURCE_EXTENSIONS] },
  { name: 'All files', extensions: ['*'] },
];
