import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AssetLibraryReference,
  PlayerModelClipSet,
  PlayerModelRef,
  PlayerModelWorldSize,
  REQUIRED_PLAYER_MODEL_CLIP_KEYS,
  makeClipId,
  makePackId,
} from '@tileborne/core';
import { DEFAULT_BATTLE_ROYALE_PLAYER_MODEL_REFS } from '@tileborne/plugin-battle-royale/player-models';
import { parseTilesetManifest } from '@tileborne/sdk-tileset/manifest';
import type { TilesetPack } from '@tileborne/sdk-tileset/schemas';
import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { buildPlayerModelRenderData } from './player-model-render';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const battleRoyalePackPath = path.resolve(
  desktopRoot,
  '../../packages/plugin-battle-royale/assets/core/tileborne-asset-pack.json',
);

const PACK_ID = makePackId('550e8400-e29b-41d4-a716-446655440999');
const PLACEABLE_ID = 'placeable:hero';
const ATLAS_ASSET_ID = 'asset:hero-atlas';
const CLIP_ID = makeClipId('550e8400-e29b-41d4-a716-446655440aaa');
const OTHER_CLIP_ID = makeClipId('550e8400-e29b-41d4-a716-446655440bbb');
const clipIdAt = (index: number) => makeClipId(`550e8400-e29b-41d4-a716-44665544000${index}`);

const frame = (x: number, durationMs?: number) => ({
  assetId: ATLAS_ASSET_ID,
  tileId: `tile:${x}`,
  uv: { x, y: 0, w: 32, h: 32 },
  durationMs: durationMs === undefined ? Option.none() : Option.some(durationMs),
});

const pack: TilesetPack = {
  id: PACK_ID as string,
  assets: [{ id: ATLAS_ASSET_ID, path: 'atlases/hero.png', mime: 'image/png' }],
  placeables: [
    {
      id: PLACEABLE_ID,
      name: 'Hero',
      size: { width: 32, height: 32 },
      frames: [frame(0), frame(32)],
      clips: REQUIRED_PLAYER_MODEL_CLIP_KEYS.map((key, index) => ({
        id: index === 0 ? CLIP_ID : clipIdAt(index),
        name: key,
        frames: [frame(index * 32, 120), frame(index * 32 + 16, 120)],
        loop: key !== 'death',
        defaultDurationMs: 120,
      })),
      source: { properties: { 'tileborne.player.renderScale': 1.5 } },
    },
  ],
} as unknown as TilesetPack;

const clips = () =>
  new PlayerModelClipSet({
    idle: CLIP_ID,
    walk: clipIdAt(1),
    run: clipIdAt(2),
    shoot: clipIdAt(3),
    reload: clipIdAt(4),
    hit: clipIdAt(5),
    death: clipIdAt(6),
    dash: clipIdAt(7),
    pickup: clipIdAt(8),
  });

const model = new PlayerModelRef({
  id: 'model:hero',
  label: 'Hero',
  ref: new AssetLibraryReference({ packId: PACK_ID, kind: 'sprite', refId: PLACEABLE_ID, clipId: CLIP_ID }),
  defaultClipId: CLIP_ID,
  clips: clips(),
  anchor: { x: 0.5, y: 1 },
  hitbox: { x: 0.25, y: 0.1, width: 0.5, height: 0.85 },
});

describe('buildPlayerModelRenderData', () => {
  it('builds runtime render data with per-frame UV animation + anchor', () => {
    const built = buildPlayerModelRenderData(pack, model);
    expect(built?.modelId).toBe('model:hero');
    expect(Object.keys(built?.data.clips ?? {})).toEqual([...REQUIRED_PLAYER_MODEL_CLIP_KEYS]);
    expect(built?.data.clips.idle.frames).toHaveLength(2);
    expect(built?.data.clips.idle.frames[0]?.uv).toEqual({ x: 0, y: 0, w: 32, h: 32 });
    expect(built?.data.clips.idle.frames[1]?.uv).toEqual({ x: 16, y: 0, w: 32, h: 32 });
    expect(built?.data.clips.shoot.loop).toBe(true);
    expect(built?.data.anchor).toEqual({ x: 0.5, y: 1 });
    expect(built?.data.renderScale).toBe(1.5);
    // entity assetId + frame assetIds + atlas spec id are the same stable id.
    const atlasId = built!.atlases[0]!.renderableAssetId;
    expect(built?.data.assetId).toBe(atlasId);
    expect(Object.values(built?.data.clips ?? {}).every((clip) => clip.frames.every((f) => f.assetId === atlasId))).toBe(true);
    expect(atlasId).toContain('playermodel:');
  });

  it('prefers authored model render scale and world size over imported pack defaults', () => {
    const authored = new PlayerModelRef({
      ...model,
      renderScale: 0.75,
      worldSize: new PlayerModelWorldSize({ width: 28, height: 34 }),
    });
    const built = buildPlayerModelRenderData(pack, authored);

    expect(built?.data.renderScale).toBe(0.75);
    expect(built?.data.worldSize).toEqual({ width: 28, height: 34 });
  });

  it('builds render data for every bundled Battle Royale default model', () => {
    const parsed = parseTilesetManifest(JSON.parse(fs.readFileSync(battleRoyalePackPath, 'utf8')) as unknown);
    expect(parsed.diagnostics).toEqual([]);
    const pack = parsed.value!;

    for (const defaultModel of DEFAULT_BATTLE_ROYALE_PLAYER_MODEL_REFS) {
      const built = buildPlayerModelRenderData(pack, defaultModel);
      expect(built?.modelId).toBe(defaultModel.id);
      expect(Object.keys(built?.data.clips ?? {})).toEqual([...REQUIRED_PLAYER_MODEL_CLIP_KEYS]);
      expect(built?.atlases).toHaveLength(1);
      expect(built?.data.clips.shoot.frames).toHaveLength(6);
      expect(built?.data.clips.reload.frames).toHaveLength(6);
      expect(built?.data.anchor).toEqual({ x: 0.5, y: 0.86 });
    }
  });

  it('returns undefined when the placeable is missing from the pack', () => {
    const missing = new PlayerModelRef({
      id: 'model:nope',
      label: 'Nope',
      ref: new AssetLibraryReference({ packId: PACK_ID, kind: 'sprite', refId: 'placeable:nope' }),
      clips: clips(),
      anchor: { x: 0, y: 0 },
      hitbox: { x: 0.25, y: 0.1, width: 0.5, height: 0.85 },
    });
    expect(buildPlayerModelRenderData(pack, missing)).toBeUndefined();
  });

  it('returns undefined when the selected clip is missing from the pack', () => {
    const missingClip = new PlayerModelRef({
      ...model,
      clips: new PlayerModelClipSet({ ...clips(), shoot: OTHER_CLIP_ID }),
    });
    expect(buildPlayerModelRenderData(pack, missingClip)).toBeUndefined();
  });
});
