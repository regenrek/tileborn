import { TileborneMap } from '@tileborne/core';
import { Option, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { mapToIpcJson, normalizeMapForIpc } from './map-ipc-normalization';

const decodeMap = Schema.decodeUnknownSync(TileborneMap);

const mapWithPlacement = () =>
  decodeMap({
    id: 'map:00000000-0000-4000-8000-000000000041',
    schemaVersion: 1,
    size: { width: 8, height: 8 },
    tileSize: { width: 32, height: 32 },
    layers: [
      {
        kind: 'object',
        id: 'layer:00000000-0000-4000-8000-000000000042',
        name: 'objects',
        visible: true,
        opacity: 1,
        objectIds: ['object:00000000-0000-4000-8000-000000000043'],
      },
    ],
    objects: [
      {
        id: 'object:00000000-0000-4000-8000-000000000043',
        kind: 'placeable',
        x: 64,
        y: 96,
        width: 96,
        height: 128,
        layerId: 'layer:00000000-0000-4000-8000-000000000042',
        properties: {},
        placement: {
          packId: 'pack:00000000-0000-4000-8000-000000000047',
          placeableId: 'placeable:00000000-0000-4000-8000-000000000044',
          source: 'manual',
          assetId: 'asset:00000000-0000-4000-8000-000000000045',
          tileId: 'tile:00000000-0000-4000-8000-000000000046',
          gid: 7,
        },
      },
    ],
    properties: {},
  });

describe('map IPC normalization', () => {
  it('preserves object placement in the plain IPC JSON view', () => {
    const encoded = mapToIpcJson(mapWithPlacement());

    expect(encoded).toMatchObject({
      objects: [
        {
          placement: {
            packId: 'pack:00000000-0000-4000-8000-000000000047',
            placeableId: 'placeable:00000000-0000-4000-8000-000000000044',
            source: 'manual',
            assetId: 'asset:00000000-0000-4000-8000-000000000045',
            tileId: 'tile:00000000-0000-4000-8000-000000000046',
            gid: 7,
          },
        },
      ],
    });
  });

  it('normalizes placement payloads without losing option fields', () => {
    const normalized = normalizeMapForIpc(mapWithPlacement());
    const decoded = decodeMap(normalized);
    const placement = decoded.objects[0]?.placement;

    expect(Option.getOrUndefined(placement?.packId ?? Option.none())).toBe(
      'pack:00000000-0000-4000-8000-000000000047',
    );
    expect(placement?.placeableId).toBe('placeable:00000000-0000-4000-8000-000000000044');
    expect(Option.getOrUndefined(placement?.assetId ?? Option.none())).toBe(
      'asset:00000000-0000-4000-8000-000000000045',
    );
    expect(Option.getOrUndefined(placement?.tileId ?? Option.none())).toBe(
      'tile:00000000-0000-4000-8000-000000000046',
    );
    expect(Option.getOrUndefined(placement?.gid ?? Option.none())).toBe(7);
  });
});
