import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { meadowPack } from '../manifest/__fixtures__/fixtures.js';
import { parseTilesetManifest } from '../manifest/parse.js';
import { TerrainClass } from '../schemas/index.js';
import { selectVariant } from '../variants/select.js';
import replayGolden from './__goldens__/replay/brush-sequence.json' with { type: 'json' };
import { assertGoldenMatch } from './helpers.js';
import { buildReplayGolden } from './scenarios.js';

const decodeTerrainClass = (value: string) => Schema.decodeUnknownSync(TerrainClass)(value);

describe('replay determinism', () => {
  it('matches golden brush replay sequence', () => {
    const golden = buildReplayGolden();
    assertGoldenMatch('replay/brush-sequence.json', golden, replayGolden);
    expect(golden.byteIdentical).toBe(true);
  });

  it('replays byte-identical map state across two runs', () => {
    const pack = parseTilesetManifest(meadowPack).value!;
    const filter = pack.tilesets[0]!.variantFilters[0]!;
    const brushSequence = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 2 },
      { x: 4, y: 2 },
    ];

    const run = () =>
      brushSequence.map((cell) =>
        selectVariant(filter, {
          mapSeed: 4242,
          layerId: 'terrain-brush',
          cellX: cell.x,
          cellY: cell.y,
          terrainClass: decodeTerrainClass('grass'),
        }),
      );

    const first = run();
    const second = run();

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
