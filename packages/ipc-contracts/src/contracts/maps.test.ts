import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeMapId, makePackId, makeProjectId } from '@tileborne/core';

import {
  MapsContracts,
  MapsImportTiledContract,
  MapsSetMapTilesetPackContract,
} from './maps.ts';

const UUID = '550e8400-e29b-41d4-a716-446655440000';
const projectId = makeProjectId(UUID);
const mapId = makeMapId(UUID);
const packId = makePackId(UUID);

const roundTrip = <A, I>(schema: Schema.Top, value: I) => {
  const codec = schema as Schema.Codec<A, I, never, never>;
  const decoded = Schema.decodeUnknownSync(codec)(value);
  expect(Schema.encodeSync(codec)(decoded)).toEqual(value);
};

describe('map IPC contracts', () => {
  it('includes setMapTilesetPack in the built map registry', () => {
    expect(MapsContracts).toContain(MapsSetMapTilesetPackContract);
  });

  it('round-trips map tileset pack sync request and response', () => {
    const summary = {
      id: mapId,
      path: `maps/${mapId}.json`,
      width: 4,
      height: 4,
      layerCount: 3,
      objectCount: 0,
    };

    roundTrip(MapsSetMapTilesetPackContract.request, { projectId, mapId, packId });
    roundTrip(MapsSetMapTilesetPackContract.response, { map: summary });
  });

  it('validates Tiled import profiles at the IPC boundary', () => {
    const accepted = ['standard', 'standard-plus-hints', 'assistive-infer', { kind: 'plugin', id: 'my-plugin' }] as const;
    for (const profile of accepted) {
      roundTrip(MapsImportTiledContract.request, {
        projectId,
        file: '/project/maps/test.tmj',
        profile,
      });
    }

    const rejected: readonly unknown[] = ['random', 'plugin:', 'plugin:bad path', { kind: 'plugin', id: 'bad path' }, 123];
    for (const profile of rejected) {
      expect(() =>
        Schema.decodeUnknownSync(MapsImportTiledContract.request)({
          projectId,
          file: '/project/maps/test.tmj',
          profile,
        }),
      ).toThrow();
    }
  });
});
