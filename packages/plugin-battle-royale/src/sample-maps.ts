import type { TileborneMap } from '@tileborne/core';

import { generateMap } from './generate-map.js';

export interface BattleRoyaleSampleMap {
  readonly id: string;
  readonly label: string;
  readonly map: TileborneMap;
}

export const createBattleRoyaleSampleMaps = (): readonly BattleRoyaleSampleMap[] => [
  {
    id: 'crossfire-range',
    label: 'Crossfire Range',
    map: generateMap('br-sample-crossfire-range', {
      width: 36,
      height: 36,
      spawnCount: 8,
      lootDensity: 0.55,
    }),
  },
  {
    id: 'supply-grid',
    label: 'Supply Grid',
    map: generateMap('br-sample-supply-grid', {
      width: 48,
      height: 40,
      spawnCount: 12,
      lootDensity: 0.42,
    }),
  },
  {
    id: 'storm-ring',
    label: 'Storm Ring',
    map: generateMap('br-sample-storm-ring', {
      width: 64,
      height: 52,
      spawnCount: 16,
      lootDensity: 0.35,
    }),
  },
];
