import { Layer } from 'effect';

import { FoundationLayer } from '@tileborne/services-foundation';

import { AssetServiceLive } from './asset/index.js';
import { AssetLibraryServiceLive, WorkingPaletteServiceLive } from './asset-library/index.js';
import { MapServiceLive } from './map/index.js';
import { ProjectServiceLive } from './project/index.js';

export * from './asset/index.js';
export * from './asset-removal.js';
export * from './asset-library/index.js';
export * from './map/index.js';
export * from './project/index.js';

const AssetBackedAssetLibraryServiceLive = AssetLibraryServiceLive.pipe(
  Layer.provideMerge(AssetServiceLive),
);
const AssetBackedWorkingPaletteServiceLive = WorkingPaletteServiceLive.pipe(
  Layer.provideMerge(AssetServiceLive),
);
const AssetBackedMapServiceLive = MapServiceLive.pipe(
  Layer.provideMerge(AssetServiceLive),
  Layer.provideMerge(AssetBackedWorkingPaletteServiceLive),
);

export const ServicesAppLayer = Layer.mergeAll(
  ProjectServiceLive,
  AssetServiceLive,
  AssetBackedMapServiceLive,
  AssetBackedAssetLibraryServiceLive,
  AssetBackedWorkingPaletteServiceLive,
).pipe(Layer.provideMerge(FoundationLayer));

/** CLI and desktop entry layer alias. */
export const AppServicesLayer = ServicesAppLayer;
