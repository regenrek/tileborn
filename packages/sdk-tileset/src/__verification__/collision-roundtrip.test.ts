import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { parseTilesetManifest } from '../manifest/parse.js';
import { writeTilesetManifest } from '../manifest/write.js';
import { parseTmjSync } from '../tiled/tmj-parse.js';
import collisionGolden from './__goldens__/collision-roundtrip/geometry.json' with { type: 'json' };
import {
  crossFormatTmj,
  VERIFICATION_PACK_SEED,
  VERIFICATION_PROJECT_ROOT,
} from './fixtures/cross-format.js';
import { assertGoldenMatch } from './helpers.js';
import { buildCollisionRoundtripGolden } from './scenarios.js';

describe('collision roundtrip', () => {
  it('matches golden Tiled → SDK → manifest collision geometry', () => {
    const golden = buildCollisionRoundtripGolden();
    assertGoldenMatch('collision-roundtrip/geometry.json', golden, collisionGolden);
  });

  it('preserves polygon edge count through manifest roundtrip', () => {
    const pack = parseTmjSync(crossFormatTmj, {
      packIdSeed: VERIFICATION_PACK_SEED,
      projectRoot: VERIFICATION_PROJECT_ROOT,
      sourcePath: `${VERIFICATION_PROJECT_ROOT}/maps/collision.tmj`,
    }).value!.pack;

    const importedMask = pack.tilesets
      .flatMap((tileset) => tileset.tiles)
      .flatMap((tile) =>
        Option.match(tile.collisionMask, {
          onNone: () => [],
          onSome: (mask) => [mask],
        }),
      )[0];

    const manifestJson = writeTilesetManifest(pack);
    const roundtrip = parseTilesetManifest(manifestJson).value!;
    const roundtripMask = roundtrip.tilesets
      .flatMap((tileset) => tileset.tiles)
      .flatMap((tile) =>
        Option.match(tile.collisionMask, {
          onNone: () => [],
          onSome: (mask) => [mask],
        }),
      )[0];

    expect(importedMask?._tag).toBe('polygon');
    expect(roundtripMask?._tag).toBe('polygon');
    if (importedMask?._tag === 'polygon' && roundtripMask?._tag === 'polygon') {
      expect(roundtripMask.edges.length).toBe(importedMask.edges.length);
    }
  });
});
