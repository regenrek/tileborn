import { describe, expect, it } from 'vitest';
import {
  AssetLibraryReference,
  WorkingPaletteItem,
  makePackId,
  makeWorkingPaletteItemId,
  type Uuid,
} from '@tileborne/core';
import { AutotileRuleId, TerrainClass } from '@tileborne/sdk-tileset/schemas';
import { Schema } from 'effect';

import { workingPaletteItemToBrushIntent } from './working-palettes-bridge';

const uuid = (suffix: string): Uuid =>
  `62656465-0000-4000-8000-${suffix.padStart(12, '0')}` as Uuid;
const packId = makePackId(uuid('1'));

describe('workingPaletteItemToBrushIntent', () => {
  it('keeps imported autotile and terrain entries as semantic brush intents', () => {
    const ruleId = Schema.decodeUnknownSync(AutotileRuleId)(`autotile-rule:${uuid('2')}`);
    const classId = Schema.decodeUnknownSync(TerrainClass)('source=terrain.tsx:grass');

    const autotileItem = new WorkingPaletteItem({
      id: makeWorkingPaletteItemId(uuid('3')),
      label: 'Grass Edges',
      ref: new AssetLibraryReference({
        packId,
        kind: 'autotile',
        refId: ruleId,
      }),
    });
    const terrainItem = new WorkingPaletteItem({
      id: makeWorkingPaletteItemId(uuid('4')),
      label: 'Grass Terrain',
      ref: new AssetLibraryReference({
        packId,
        kind: 'terrain',
        refId: classId,
      }),
    });

    expect(workingPaletteItemToBrushIntent(autotileItem)).toEqual({ kind: 'autotile', ruleId });
    expect(workingPaletteItemToBrushIntent(terrainItem)).toEqual({ kind: 'terrain', classId });
  });
});
