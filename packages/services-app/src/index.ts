import { Layer } from 'effect';

import { FoundationLayer } from '@tileborne/services-foundation';

import { AssetServiceLive } from './asset/index.js';
import { AssetLibraryServiceLive, WorkingPaletteServiceLive } from './asset-library/index.js';
import { ProjectBehaviorServiceLive } from './behavior/index.js';
import { MapServiceLive } from './map/index.js';
import { ProjectServiceLive } from './project/index.js';

export * from './asset/index.js';
export * from './asset-removal.js';
export * from './asset-library/index.js';
export * from './behavior/index.js';
export * from './map/index.js';
export * from './project/index.js';
export * from './validation/project-corpus.js';

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

/** Application services before a runtime chooses its Foundation owner. */
export const ServicesAppCoreLayer = Layer.mergeAll(
  ProjectServiceLive,
  ProjectBehaviorServiceLive,
  AssetServiceLive,
  AssetBackedMapServiceLive,
  AssetBackedAssetLibraryServiceLive,
  AssetBackedWorkingPaletteServiceLive,
);

export const ServicesAppLayer = ServicesAppCoreLayer.pipe(Layer.provideMerge(FoundationLayer));

/** CLI and desktop entry layer alias. */
export const AppServicesLayer = ServicesAppLayer;
