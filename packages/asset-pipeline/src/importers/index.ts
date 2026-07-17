export * from './audio-importer.js';
export * from './image-importer.js';
export * from './importer.js';
export * from './tileset-importer.js';

import { audioImporter } from './audio-importer.js';
import { imageImporter } from './image-importer.js';
import type { AssetImporter } from './importer.js';
import { tilesetImporter } from './tileset-importer.js';

export const defaultImporters: readonly AssetImporter[] = [
  imageImporter,
  tilesetImporter,
  audioImporter,
];
