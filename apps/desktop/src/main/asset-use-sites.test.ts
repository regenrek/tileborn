import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  AssetLibraryReference,
  GameObjectType,
  MapObject,
  MapObjectPlacement,
  PlayerModelClipSet,
  PlayerModelRef,
  ProjectAssetPackRef,
  ProjectManifest,
  ProjectMapRef,
  TileborneMap,
  VisualRefComponent,
  makeClipId,
  makeGameObjectTypeId,
  makeLayerId,
  makeMapId,
  makeObjectId,
  makePackId,
  makePlaceableId,
  makeProjectId,
  type Uuid,
  type FamilyTag,
} from '@tileborne/core';

import { buildAssetPackUseSites } from './asset-use-sites';

const uuid = (suffix: string) =>
  `550e8400-e29b-41d4-a716-${suffix.padStart(12, '0')}` as Uuid;
const projectId = makeProjectId(uuid('1'));
const packId = makePackId(uuid('2'));
const mapId = makeMapId(uuid('3'));
const placeableId = makePlaceableId(uuid('4'));
const objectTypeId = makeGameObjectTypeId(uuid('5'));
const objectId = makeObjectId(uuid('6'));
const layerId = makeLayerId(uuid('7'));
const clipIds = Array.from({ length: 9 }, (_, index) => makeClipId(uuid(`8${index}`)));

const project = new ProjectManifest({
  id: projectId,
  name: 'Use-site proof',
  schemaVersion: 1,
  engineVersion: '0.0.0-test',
  plugins: [],
  assetPacks: [new ProjectAssetPackRef({ id: packId, version: '1.0.0' })],
  maps: [new ProjectMapRef({ id: mapId, path: 'maps/proof.json' })],
});

const model = new PlayerModelRef({
  id: 'model:proof',
  label: 'Proof hero',
  ref: new AssetLibraryReference({ packId, kind: 'sprite', refId: placeableId }),
  defaultClipId: clipIds[0]!,
  clips: new PlayerModelClipSet({
    idle: clipIds[0]!,
    walk: clipIds[1]!,
    run: clipIds[2]!,
    shoot: clipIds[3]!,
    reload: clipIds[4]!,
    hit: clipIds[5]!,
    death: clipIds[6]!,
    dash: clipIds[7]!,
    pickup: clipIds[8]!,
  }),
  anchor: { x: 0.5, y: 1 },
  hitbox: { x: 0.2, y: 0.2, width: 0.6, height: 0.7 },
});

const objectType = new GameObjectType({
  id: objectTypeId,
  schemaVersion: 1,
  label: 'Proof crate',
  family: 'proof' as FamilyTag,
  category: Option.none(),
  layerHint: Option.none(),
  components: [
    new VisualRefComponent({
      placeableId: Option.some(placeableId),
      assetId: Option.none(),
      width: 1,
      height: 1,
      anchors: {},
    }),
  ],
  instanceDefaults: {},
});

const map = new TileborneMap({
  id: mapId,
  schemaVersion: 1,
  size: { width: 8, height: 8 },
  tileSize: { width: 32, height: 32 },
  layers: [],
  properties: { tilesetPackId: packId },
  objects: [
    new MapObject({
      id: objectId,
      kind: objectTypeId,
      x: 1,
      y: 2,
      width: Option.none(),
      height: Option.none(),
      layerId,
      properties: {},
      placement: new MapObjectPlacement({
        packId: Option.some(packId),
        placeableId,
        source: 'manual',
        assetId: Option.none(),
        tileId: Option.none(),
        gid: Option.none(),
        clipId: clipIds[0],
      }),
    }),
  ],
});

describe('buildAssetPackUseSites', () => {
  it('projects exact dependency, player-model, animation, entity, map and object consumers', () => {
    const result = buildAssetPackUseSites({
      project,
      packId,
      maps: [map],
      catalogObjectTypes: [objectType],
      playerModels: [model],
      editorIndex: { placeables: [{ id: placeableId }] },
      limit: 100,
      projectMapCount: 1,
    });

    expect(new Set(result.useSites.map((site) => site.kind))).toEqual(
      new Set([
        'project-dependency',
        'player-model',
        'animation',
        'entity',
        'map',
        'map-object',
      ]),
    );
    expect(result.useSites.find((site) => site.kind === 'entity')?.navigation).toMatchObject({
      kind: 'catalog',
      objectTypeId,
    });
    expect(result.useSites.find((site) => site.kind === 'map-object')?.navigation).toMatchObject({
      kind: 'map-object',
      mapId,
      objectId,
    });
    expect(result.truncated).toBe(false);
  });

  it('caps materialized results and marks partial map scans as truncated', () => {
    const result = buildAssetPackUseSites({
      project,
      packId,
      maps: [],
      catalogObjectTypes: [objectType],
      playerModels: [model],
      editorIndex: { placeables: [{ id: placeableId }] },
      limit: 2,
      projectMapCount: 1,
    });

    expect(result.useSites).toHaveLength(2);
    expect(result.total).toBeGreaterThan(2);
    expect(result.truncated).toBe(true);
  });
});
