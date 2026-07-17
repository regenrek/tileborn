import { BattleRoyaleProtocol } from '@tileborne/ipc-contracts';
import { REQUIRED_PLAYER_MODEL_CLIP_KEYS, type PlayerModelClipKey } from '@tileborne/core';

import { BR_OVERLAY_SLOTS } from '../constants.js';
import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  createBattleRoyaleProjector,
  createBattleRoyaleRenderManifest,
  decodeClientFrameView,
  encodeClientInputFrame,
  encodeSnapshotAckFrame,
  PLAYER_TEXTURE_ASSET_ID,
  requiredBattleRoyaleRenderableAssetIds,
  type BattleRoyaleProjectorConfig,
  type PlayerModelClipRenderData,
  type PlayerModelRenderData,
  type SpriteVisualRenderData,
  type WeaponVisualRenderData,
} from './battle-royale-projector.js';
import { PROJECTILE_TEXTURE_ASSET_ID } from './bundled-assets.js';
import { BATTLE_ROYALE_VISUAL_ORACLE, projectVisualSize } from './visual-oracle.js';

const playerAnimation = (
  clipKey: PlayerModelClipKey = 'idle',
  modelId = 'model:hero',
): BattleRoyaleProtocol.PlayerAnimationState => ({
  modelId,
  clipKey,
  facingDeg: clipKey === 'shoot' ? 90 : 0,
  moving: clipKey === 'run',
});

const clip = (
  x: number,
  size: { readonly width: number; readonly height: number } = { width: 32, height: 32 },
): PlayerModelClipRenderData => ({
  frames: [
    {
      assetId: 'playermodel:hero-atlas',
      uv: { x, y: 0, w: size.width, h: size.height },
      durationMs: 100,
    },
    {
      assetId: 'playermodel:hero-atlas',
      uv: { x: x + size.width, y: 0, w: size.width, h: size.height },
      durationMs: 100,
    },
  ],
  loop: true,
  defaultDurationMs: 100,
});

const modelRenderData = (
  frameSize: { readonly width: number; readonly height: number } = { width: 32, height: 32 },
): PlayerModelRenderData => ({
  assetId: 'playermodel:hero-atlas',
  clips: Object.fromEntries(
    REQUIRED_PLAYER_MODEL_CLIP_KEYS.map((key, index) => [
      key,
      clip(index * frameSize.width * 2, frameSize),
    ]),
  ) as Record<PlayerModelClipKey, PlayerModelClipRenderData>,
  anchor: { x: 0.5, y: 1 },
});

const catalog = (model = modelRenderData()): ReadonlyMap<string, PlayerModelRenderData> =>
  new Map([['model:hero', model]]);

const VISUAL_WEAPON_ASSET_ID = 'visualrole:test:weapon';
const VISUAL_PROJECTILE_ASSET_ID = 'visualrole:test:projectile';
const VISUAL_PICKUP_ASSET_ID = 'visualrole:test:pickup';
const VISUAL_MUZZLE_ASSET_ID = 'visualrole:test:muzzle';
const VISUAL_IMPACT_ASSET_ID = 'visualrole:test:impact';
const VISUAL_SHIELD_ASSET_ID = 'visualrole:test:shield';
const VISUAL_SHADOW_ASSET_ID = 'visualrole:test:shadow';
const VISUAL_HAZARD_ASSET_ID = 'visualrole:test:hazard';

const spriteVisual = (visualKey: string, assetId: string): SpriteVisualRenderData => ({
  visualId: `sprite-visual:${visualKey}`,
  assetId,
  frames: [{ assetId, uv: { x: 0, y: 0, w: 24, h: 24 }, durationMs: 100 }],
  loop: false,
  anchor: { x: 0.5, y: 0.5 },
});

const TEST_WEAPON_ID = 'weapon:00000000-0000-4000-8000-000000000001';

const weaponEquippedVisual = (): SpriteVisualRenderData => ({
  ...spriteVisual('equipped', VISUAL_WEAPON_ASSET_ID),
  anchor: { x: 0.25, y: 0.5 },
  anchors: {
    grip: { point: { x: 0.25, y: 0.5 } },
    muzzle: { point: { x: 0.75, y: 0.5 } },
  },
});

const weaponVisuals = (
  equipped: SpriteVisualRenderData = weaponEquippedVisual(),
): ReadonlyMap<string, WeaponVisualRenderData> =>
  new Map([
    [
      TEST_WEAPON_ID,
      {
        weaponId: TEST_WEAPON_ID,
        equipped,
        projectile: spriteVisual('projectile', VISUAL_PROJECTILE_ASSET_ID),
        muzzleFlash: spriteVisual('muzzle-flash', VISUAL_MUZZLE_ASSET_ID),
        impactVfx: spriteVisual('impact-vfx', VISUAL_IMPACT_ASSET_ID),
        pickup: spriteVisual('pickup', VISUAL_PICKUP_ASSET_ID),
      },
    ],
  ]);

const overlays = (): ReadonlyMap<string, SpriteVisualRenderData> =>
  new Map([
    [BR_OVERLAY_SLOTS.shield, spriteVisual(BR_OVERLAY_SLOTS.shield, VISUAL_SHIELD_ASSET_ID)],
    [BR_OVERLAY_SLOTS.shadow, spriteVisual(BR_OVERLAY_SLOTS.shadow, VISUAL_SHADOW_ASSET_ID)],
    [BR_OVERLAY_SLOTS.hazard, spriteVisual(BR_OVERLAY_SLOTS.hazard, VISUAL_HAZARD_ASSET_ID)],
  ]);

const projectorConfig = (model = modelRenderData()): BattleRoyaleProjectorConfig => ({
  catalog: catalog(model),
  overlays: overlays(),
  weapons: weaponVisuals(),
  defaultWeaponId: TEST_WEAPON_ID,
});

const expectedPlayerScale = (
  frameSize: { readonly width: number; readonly height: number },
  renderScale = 1,
) => ({
  scaleX:
    (BATTLE_ROYALE_VISUAL_ORACLE.render.playerWorldFootprint.width * renderScale) / frameSize.width,
  scaleY:
    (BATTLE_ROYALE_VISUAL_ORACLE.render.playerWorldFootprint.height * renderScale) /
    frameSize.height,
});

describe('BattleRoyaleProjector', () => {
  it('projects merged full states deterministically without internal mutation', () => {
    const projector = createBattleRoyaleProjector(projectorConfig());
    const playerId = BattleRoyaleProtocol.makePlayerId('player-1');
    const projectileId = BattleRoyaleProtocol.makeProjectileId('projectile-1');
    const welcome = new BattleRoyaleProtocol.WelcomeSnapshot({
      tick: 1,
      serverTimestampMs: 1000,
      seed: 1,
      players: [
        {
          id: playerId,
          x: 10,
          y: 20,
          health: 100,
          modelId: 'model:hero',
          animation: playerAnimation(),
        },
      ],
      projectiles: [
        new BattleRoyaleProtocol.ProjectileSnapshot({
          id: projectileId,
          ownerPlayerId: playerId,
          weaponSlot: 0,
          x: 12,
          y: 22,
          vx: 1,
          vy: 0,
          rotation: 0.5,
          ttlMs: 1_000,
        }),
      ],
      zone: { cx: 32, cy: 32, radius: 64 },
    });
    const delta = new BattleRoyaleProtocol.DeltaSnapshot({
      tick: 2,
      serverTimestampMs: 1050,
      removed: [],
      updated: [
        {
          id: playerId,
          team: Option.none(),
          x: Option.some(11),
          y: Option.none(),
          health: Option.none(),
          shield: Option.none(),
          armor: Option.none(),
          weapon: Option.none(),
          inventory: Option.none(),
          pickupPrompt: Option.none(),
          pickupToast: Option.none(),
          damageIndicator: Option.none(),
          stats: Option.none(),
          statusEffects: Option.none(),
          abilityCooldowns: Option.none(),
          animation: Option.none(),
        },
      ],
      projectilesUpdated: [
        new BattleRoyaleProtocol.ProjectileUpdate({
          id: projectileId,
          ownerPlayerId: Option.none(),
          weaponSlot: Option.none(),
          x: Option.some(13),
          y: Option.none(),
          vx: Option.none(),
          vy: Option.none(),
          rotation: Option.some(0.75),
          ttlMs: Option.none(),
        }),
      ],
      projectilesRemoved: [],
      zone: Option.none(),
    });

    const firstFullState = projector.mergeFrame?.(undefined, welcome);
    const nextFullState = projector.mergeFrame?.(firstFullState, delta);
    const entities = projector.project(nextFullState);

    expect(entities).toEqual(projector.project(nextFullState));
    expect(entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'br:zone:safe-area',
          x: 32,
          y: 32,
          layerIndex: 4,
        }),
        expect.objectContaining({
          id: 'br:player:player-1',
          x: 11,
          y: 20,
          layerIndex: 10,
        }),
        expect.objectContaining({
          id: 'br:health-fill:player-1',
          tint: 0x22c55e,
          layerIndex: 31,
        }),
        expect.objectContaining({
          id: 'br:projectile-trail:projectile-1',
          opacity: 0.45,
          layerIndex: 19,
        }),
        expect.objectContaining({
          id: 'br:projectile:projectile-1',
          x: 13,
          y: 22,
          rotation: 0.75,
          anchor: { x: 0.5, y: 0.5 },
          layerIndex: 20,
        }),
      ]),
    );
  });

  it('resolves a per-player modelId to a renderable model with animation', () => {
    const projector = createBattleRoyaleProjector(projectorConfig());
    const playerId = BattleRoyaleProtocol.makePlayerId('player-1');
    const welcome = new BattleRoyaleProtocol.WelcomeSnapshot({
      tick: 1,
      serverTimestampMs: 1000,
      seed: 1,
      players: [
        {
          id: playerId,
          x: 10,
          y: 20,
          health: 100,
          modelId: 'model:hero',
          animation: playerAnimation('shoot'),
        },
      ],
      projectiles: [],
      zone: { cx: 32, cy: 32, radius: 64 },
    });
    const full = projector.mergeFrame?.(undefined, welcome);
    const entities = projector.project(full);
    const entity = entities.find((entry) => entry.id === 'br:player:player-1');
    const weapon = entities.find((entry) => entry.id === 'br:weapon:player-1');
    const muzzle = entities.find((entry) => entry.id === 'br:muzzle:player-1');
    expect(entity?.assetId).toBe('playermodel:hero-atlas');
    expect(entity?.anchor).toEqual({ x: 0.5, y: 1 });
    expect(entity?.rotation).toBeUndefined();
    expect(weapon?.rotation).toBeCloseTo(Math.PI / 2);
    expect(weapon?.anchor).toEqual({ x: 0.25, y: 0.5 });
    expect(muzzle?.x).toBeCloseTo(10);
    expect(muzzle?.y).toBeCloseTo(37.64);
    expect(muzzle?.rotation).toBeCloseTo(Math.PI / 2);
    expect(entity).toEqual(expect.objectContaining(expectedPlayerScale({ width: 32, height: 32 })));
    expect(entity?.animation?.clipId).toBe('model:hero:shoot');
    expect(entity?.animation?.frames).toHaveLength(2);
    expect(entity?.animation?.loop).toBe(true);
  });

  it('applies authored weapon grip and muzzle transforms from weapon-entity metadata', () => {
    const projector = createBattleRoyaleProjector({
      catalog: catalog(),
      weapons: weaponVisuals({
        ...spriteVisual('equipped', VISUAL_WEAPON_ASSET_ID),
        anchors: {
          grip: { point: { x: 0.25, y: 0.5 }, rotationDeg: 30, zOffset: 2 },
          muzzle: { point: { x: 0.75, y: 0.5 }, rotationDeg: 15, zOffset: 3 },
        },
      }),
      defaultWeaponId: TEST_WEAPON_ID,
    });
    const playerId = BattleRoyaleProtocol.makePlayerId('player-1');
    const welcome = new BattleRoyaleProtocol.WelcomeSnapshot({
      tick: 1,
      serverTimestampMs: 1000,
      seed: 1,
      players: [
        {
          id: playerId,
          x: 40,
          y: 50,
          health: 100,
          modelId: 'model:hero',
          animation: {
            ...playerAnimation('shoot'),
            aimDeg: 0,
          },
        },
      ],
      projectiles: [],
      zone: { cx: 32, cy: 32, radius: 64 },
    });

    const full = projector.mergeFrame?.(undefined, welcome);
    const entities = projector.project(full);
    const weapon = entities.find((entry) => entry.id === 'br:weapon:player-1');
    const muzzle = entities.find((entry) => entry.id === 'br:muzzle:player-1');

    expect(weapon?.rotation).toBeCloseTo(Math.PI / 6);
    expect(weapon?.layerIndex).toBe(20);
    expect(muzzle?.x).toBeCloseTo(56.482);
    expect(muzzle?.y).toBeCloseTo(54.32);
    expect(muzzle?.rotation).toBeCloseTo(Math.PI / 4);
    expect(muzzle?.layerIndex).toBe(25);
  });

  it('normalizes large source-frame player models to the oracle footprint', () => {
    const frameSize = BATTLE_ROYALE_VISUAL_ORACLE.reference.playerSourceStressFrame;
    const projector = createBattleRoyaleProjector(projectorConfig(modelRenderData(frameSize)));
    const playerId = BattleRoyaleProtocol.makePlayerId('player-1');
    const welcome = new BattleRoyaleProtocol.WelcomeSnapshot({
      tick: 1,
      serverTimestampMs: 1000,
      seed: 1,
      players: [
        {
          id: playerId,
          x: 10,
          y: 20,
          health: 100,
          modelId: 'model:hero',
          animation: playerAnimation('idle'),
        },
      ],
      projectiles: [],
      zone: { cx: 32, cy: 32, radius: 64 },
    });

    const full = projector.mergeFrame?.(undefined, welcome);
    const entity = projector.project(full).find((entry) => entry.id === 'br:player:player-1');
    const projected = projectVisualSize(
      BATTLE_ROYALE_VISUAL_ORACLE.render.playerWorldFootprint,
      BATTLE_ROYALE_VISUAL_ORACLE.render.fixedZoom,
    );

    expect(entity).toEqual(expect.objectContaining(expectedPlayerScale(frameSize)));
    expect(projected).toEqual({ width: 144, height: 144 });
  });

  it('applies authored player-model render scale after footprint normalization', () => {
    const frameSize = { width: 32, height: 32 };
    const model = { ...modelRenderData(frameSize), renderScale: 1.5 };
    const projector = createBattleRoyaleProjector(projectorConfig(model));
    const playerId = BattleRoyaleProtocol.makePlayerId('player-1');
    const welcome = new BattleRoyaleProtocol.WelcomeSnapshot({
      tick: 1,
      serverTimestampMs: 1000,
      seed: 1,
      players: [
        {
          id: playerId,
          x: 10,
          y: 20,
          health: 100,
          modelId: 'model:hero',
          animation: playerAnimation('idle'),
        },
      ],
      projectiles: [],
      zone: { cx: 32, cy: 32, radius: 64 },
    });

    const full = projector.mergeFrame?.(undefined, welcome);
    const entity = projector.project(full).find((entry) => entry.id === 'br:player:player-1');

    expect(entity).toEqual(expect.objectContaining(expectedPlayerScale(frameSize, 1.5)));
  });

  it('omits player entities when runtime model data is missing', () => {
    const projector = createBattleRoyaleProjector({ catalog: new Map() });
    const playerId = BattleRoyaleProtocol.makePlayerId('player-1');
    const welcome = new BattleRoyaleProtocol.WelcomeSnapshot({
      tick: 1,
      serverTimestampMs: 1000,
      seed: 1,
      players: [{ id: playerId, x: 0, y: 0, health: 100 }],
      projectiles: [],
      zone: { cx: 0, cy: 0, radius: 64 },
    });
    const full = projector.mergeFrame?.(undefined, welcome);
    expect(projector.project(full).filter((entity) => entity.id.includes('player-1'))).toEqual([]);
  });

  it('does not invent a player model when the snapshot omits animation state', () => {
    const projector = createBattleRoyaleProjector(projectorConfig());
    const playerId = BattleRoyaleProtocol.makePlayerId('player-1');
    const welcome = new BattleRoyaleProtocol.WelcomeSnapshot({
      tick: 1,
      serverTimestampMs: 1000,
      seed: 1,
      players: [{ id: playerId, x: 0, y: 0, health: 100 }],
      projectiles: [],
      zone: { cx: 0, cy: 0, radius: 64 },
    });
    const full = projector.mergeFrame?.(undefined, welcome);
    expect(projector.project(full).filter((entity) => entity.id.includes('player-1'))).toEqual([]);
  });

  it('uses the runtime animation clip key instead of a default clip', () => {
    const projector = createBattleRoyaleProjector(projectorConfig());
    const playerId = BattleRoyaleProtocol.makePlayerId('player-1');
    const welcome = new BattleRoyaleProtocol.WelcomeSnapshot({
      tick: 1,
      serverTimestampMs: 1000,
      seed: 1,
      players: [
        {
          id: playerId,
          x: 0,
          y: 0,
          health: 100,
          modelId: 'model:hero',
          animation: playerAnimation('reload'),
        },
      ],
      projectiles: [],
      zone: { cx: 0, cy: 0, radius: 64 },
    });
    const full = projector.mergeFrame?.(undefined, welcome);
    const entity = projector.project(full).find((entry) => entry.id === 'br:player:player-1');
    expect(entity?.assetId).toBe('playermodel:hero-atlas');
    expect(entity?.animation?.clipId).toBe('model:hero:reload');
    expect(entity?.animation?.frames).toHaveLength(2);
  });

  it('exposes the plugin-owned render manifest', () => {
    const projector = createBattleRoyaleProjector();

    expect(projector.getRenderManifest?.()).toEqual({
      fixedZoom: 4,
      hudInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    expect(createBattleRoyaleRenderManifest()).toEqual(projector.getRenderManifest?.());
  });

  it('uses namespaced plugin-bundled asset ids', () => {
    expect(PLAYER_TEXTURE_ASSET_ID).toBe('@tileborne-plugins/battle-royale:default-pet');
    expect(PROJECTILE_TEXTURE_ASSET_ID).toBe('@tileborne-plugins/battle-royale:projectile-bolt');
    expect(requiredBattleRoyaleRenderableAssetIds()).not.toContain(PROJECTILE_TEXTURE_ASSET_ID);
  });

  it('projects three players and two projectiles into renderable entities', () => {
    const projector = createBattleRoyaleProjector(projectorConfig());
    const players = ['player-1', 'player-2', 'player-3'].map(BattleRoyaleProtocol.makePlayerId);
    const welcome = new BattleRoyaleProtocol.WelcomeSnapshot({
      tick: 10,
      serverTimestampMs: 2_000,
      seed: 1,
      players: players.map((id, index) => ({
        id,
        x: index * 10,
        y: index * 20,
        health: 100,
        modelId: 'model:hero',
        animation: playerAnimation(index === 0 ? 'idle' : 'run'),
      })),
      projectiles: [
        new BattleRoyaleProtocol.ProjectileSnapshot({
          id: BattleRoyaleProtocol.makeProjectileId('projectile-1'),
          ownerPlayerId: players[0]!,
          weaponSlot: 1,
          x: 1,
          y: 2,
          vx: 1,
          vy: 0,
          rotation: 0,
          ttlMs: 100,
        }),
        new BattleRoyaleProtocol.ProjectileSnapshot({
          id: BattleRoyaleProtocol.makeProjectileId('projectile-2'),
          ownerPlayerId: players[1]!,
          weaponSlot: 2,
          x: 3,
          y: 4,
          vx: 0,
          vy: 1,
          rotation: 1,
          ttlMs: 100,
        }),
      ],
      zone: { cx: 0, cy: 0, radius: 100 },
    });

    const fullState = projector.mergeFrame?.(undefined, welcome);
    const entities = projector.project(fullState);

    expect(entities.filter((entity) => entity.id.startsWith('br:zone:'))).toHaveLength(1);
    expect(entities.filter((entity) => entity.id.startsWith('br:player:'))).toHaveLength(3);
    expect(entities.filter((entity) => entity.id.startsWith('br:projectile:'))).toHaveLength(2);
    expect(entities.filter((entity) => entity.id.startsWith('br:projectile-trail:'))).toHaveLength(
      2,
    );
    expect(entities.filter((entity) => entity.id.startsWith('br:health-back:'))).toHaveLength(3);
    expect(entities.filter((entity) => entity.id.startsWith('br:health-fill:'))).toHaveLength(3);
    expect(entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'br:zone:safe-area',
          tint: 0x38bdf8,
          opacity: 0.16,
          layerIndex: 4,
        }),
        expect.objectContaining({ id: 'br:player:player-1', assetId: 'playermodel:hero-atlas' }),
        expect.objectContaining({
          id: 'br:health-fill:player-1',
          assetId: expect.stringContaining('ui-pixel'),
          tint: 0x22c55e,
          layerIndex: 31,
        }),
        expect.objectContaining({
          id: 'br:projectile-trail:projectile-1',
          assetId: VISUAL_PROJECTILE_ASSET_ID,
          scaleX: 0.9,
          scaleY: 0.55,
          opacity: 0.45,
          layerIndex: 19,
        }),
        expect.objectContaining({
          id: 'br:projectile:projectile-1',
          assetId: VISUAL_PROJECTILE_ASSET_ID,
          anchor: { x: 0.5, y: 0.5 },
        }),
      ]),
    );
  });

  it('removes players from merged full state when delta marks them removed', () => {
    const projector = createBattleRoyaleProjector(projectorConfig());
    const player1 = BattleRoyaleProtocol.makePlayerId('player-1');
    const player2 = BattleRoyaleProtocol.makePlayerId('player-2');
    const welcome = new BattleRoyaleProtocol.WelcomeSnapshot({
      tick: 1,
      serverTimestampMs: 100,
      seed: 1,
      players: [
        {
          id: player1,
          x: 0,
          y: 0,
          health: 100,
          modelId: 'model:hero',
          animation: playerAnimation(),
        },
        {
          id: player2,
          x: 10,
          y: 10,
          health: 100,
          modelId: 'model:hero',
          animation: playerAnimation(),
        },
      ],
      projectiles: [],
      zone: { cx: 0, cy: 0, radius: 100 },
    });
    const delta = new BattleRoyaleProtocol.DeltaSnapshot({
      tick: 2,
      serverTimestampMs: 150,
      removed: [player2],
      updated: [],
      projectilesUpdated: [],
      projectilesRemoved: [],
      zone: Option.none(),
    });

    const fullState = projector.mergeFrame?.(undefined, welcome);
    const nextState = projector.mergeFrame?.(fullState, delta);

    expect(
      projector
        .project(nextState)
        .filter((entity) => entity.id.startsWith('br:player:'))
        .map((entity) => entity.id),
    ).toEqual(['br:player:player-1']);
  });

  it('projects first-class combat overlays for shields, status, muzzle flash, and low health', () => {
    const projector = createBattleRoyaleProjector(projectorConfig());
    const playerId = BattleRoyaleProtocol.makePlayerId('player-1');
    const welcome = new BattleRoyaleProtocol.WelcomeSnapshot({
      tick: 1,
      serverTimestampMs: 100,
      seed: 1,
      players: [
        {
          id: playerId,
          x: 40,
          y: 50,
          health: 20,
          shield: 35,
          statusEffects: [
            {
              effectId: 'burn',
              remainingTicks: 5,
              stacks: 2,
            },
          ],
          modelId: 'model:hero',
          animation: {
            ...playerAnimation('shoot'),
            aimDeg: 0,
          },
        },
      ],
      projectiles: [],
      zone: { cx: 10, cy: 20, radius: 48 },
    });

    const fullState = projector.mergeFrame?.(undefined, welcome);
    const entities = projector.project(fullState);

    const status = entities.find((entity) => entity.id === 'br:status:player-1:burn');
    const healthFill = entities.find((entity) => entity.id === 'br:health-fill:player-1');
    expect(entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'br:zone:safe-area',
          x: 10,
          y: 20,
          scale: 4,
        }),
        expect.objectContaining({
          id: 'br:shield:player-1',
          layerIndex: 11,
        }),
        expect.objectContaining({
          id: 'br:health-fill:player-1',
          tint: 0xef4444,
        }),
        expect.objectContaining({
          id: 'br:muzzle:player-1',
          x: 57.64,
          y: 50,
          tint: 0xfacc15,
          layerIndex: 22,
        }),
      ]),
    );
    expect(status).toEqual(expect.objectContaining({ tint: 0xa78bfa, layerIndex: 9 }));
    expect(status?.opacity).toBeCloseTo(0.65);
    expect(healthFill?.scaleX).toBeCloseTo(4.8);
  });

  it('projects player shadow and equipped weapon without raw id nameplate text', () => {
    const projector = createBattleRoyaleProjector(projectorConfig());
    const playerId = BattleRoyaleProtocol.makePlayerId('player-1');
    const welcome = new BattleRoyaleProtocol.WelcomeSnapshot({
      tick: 1,
      serverTimestampMs: 100,
      seed: 1,
      players: [
        {
          id: playerId,
          x: 40,
          y: 50,
          health: 100,
          modelId: 'model:hero',
          animation: {
            ...playerAnimation('idle'),
            facingDeg: 0,
            aimDeg: 90,
          },
        },
      ],
      projectiles: [],
      zone: { cx: 10, cy: 20, radius: 48 },
    });

    const fullState = projector.mergeFrame?.(undefined, welcome);
    const entities = projector.project(fullState);

    expect(entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'br:shadow:player-1',
          assetId: VISUAL_SHADOW_ASSET_ID,
          x: 40,
          y: 58,
          scaleX: 1.15,
          scaleY: 0.42,
          layerIndex: 6,
        }),
        expect.objectContaining({
          id: 'br:weapon:player-1',
          assetId: VISUAL_WEAPON_ASSET_ID,
          x: 40,
          y: 59,
          rotation: Math.PI / 2,
          layerIndex: 18,
        }),
      ]),
    );
    expect(entities.find((entity) => entity.id === 'br:nameplate:player-1')).toBeUndefined();
    expect(entities.find((entity) => entity.text?.value === 'player-1')).toBeUndefined();
  });

  it('derives short-lived impact effects when server delta removes projectiles', () => {
    const projector = createBattleRoyaleProjector(projectorConfig());
    const playerId = BattleRoyaleProtocol.makePlayerId('player-1');
    const projectileId = BattleRoyaleProtocol.makeProjectileId('projectile-1');
    const welcome = new BattleRoyaleProtocol.WelcomeSnapshot({
      tick: 1,
      serverTimestampMs: 100,
      seed: 1,
      players: [],
      projectiles: [
        new BattleRoyaleProtocol.ProjectileSnapshot({
          id: projectileId,
          ownerPlayerId: playerId,
          weaponSlot: 1,
          x: 70,
          y: 80,
          vx: 1,
          vy: 0,
          rotation: 0.25,
          ttlMs: 100,
        }),
      ],
      zone: { cx: 0, cy: 0, radius: 100 },
    });
    const removed = new BattleRoyaleProtocol.DeltaSnapshot({
      tick: 2,
      serverTimestampMs: 150,
      removed: [],
      updated: [],
      projectilesUpdated: [],
      projectilesRemoved: [projectileId],
      zone: Option.none(),
    });
    const later = new BattleRoyaleProtocol.DeltaSnapshot({
      tick: 8,
      serverTimestampMs: 450,
      removed: [],
      updated: [],
      projectilesUpdated: [],
      projectilesRemoved: [],
      zone: Option.none(),
    });

    const first = projector.mergeFrame?.(undefined, welcome);
    const impactState = projector.mergeFrame?.(first, removed);
    const impactEntities = projector.project(impactState);

    expect(
      impactEntities.find((entity) => entity.id === 'br:projectile:projectile-1'),
    ).toBeUndefined();
    expect(impactEntities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'br:impact:projectile-1:2',
          assetId: VISUAL_IMPACT_ASSET_ID,
          x: 70,
          y: 80,
          rotation: 0.25,
          layerIndex: 21,
        }),
      ]),
    );

    const expiredState = projector.mergeFrame?.(impactState, later);
    expect(
      projector.project(expiredState).find((entity) => entity.id.startsWith('br:impact:')),
    ).toBeUndefined();
  });

  it('merges zone updates from delta frames', () => {
    const projector = createBattleRoyaleProjector(projectorConfig());
    const welcome = new BattleRoyaleProtocol.WelcomeSnapshot({
      tick: 1,
      serverTimestampMs: 100,
      seed: 1,
      players: [],
      projectiles: [],
      zone: { cx: 0, cy: 0, radius: 120 },
    });
    const delta = new BattleRoyaleProtocol.DeltaSnapshot({
      tick: 2,
      serverTimestampMs: 150,
      removed: [],
      updated: [],
      projectilesUpdated: [],
      projectilesRemoved: [],
      zone: Option.some({ cx: 32, cy: 40, radius: 36 }),
    });

    const fullState = projector.mergeFrame?.(undefined, welcome);
    const nextState = projector.mergeFrame?.(fullState, delta);
    const zone = projector.project(nextState).find((entity) => entity.id === 'br:zone:safe-area');

    expect(zone).toEqual(
      expect.objectContaining({
        x: 32,
        y: 40,
        scale: 3,
      }),
    );
  });

  it("renders a dropped weapon pickup with THAT weapon's pickup companion visual", () => {
    const SECOND_WEAPON_ID = 'weapon:00000000-0000-4000-8000-000000000002';
    const SECOND_PICKUP_ASSET_ID = 'visualrole:test:second-pickup';
    const weapons = new Map([
      ...weaponVisuals(),
      [
        SECOND_WEAPON_ID,
        {
          weaponId: SECOND_WEAPON_ID,
          equipped: weaponEquippedVisual(),
          pickup: spriteVisual('pickup', SECOND_PICKUP_ASSET_ID),
        },
      ],
    ]);
    const projector = createBattleRoyaleProjector({ ...projectorConfig(), weapons });
    const welcome = new BattleRoyaleProtocol.WelcomeSnapshot({
      tick: 1,
      serverTimestampMs: 100,
      seed: 1,
      players: [],
      projectiles: [],
      objects: [
        new BattleRoyaleProtocol.ObjectSnapshot({
          id: BattleRoyaleProtocol.makeObjectId('drop-1'),
          x: 10,
          y: 12,
          pickup: { itemKind: SECOND_WEAPON_ID, tier: 'epic', quantity: 1, available: true },
        }),
        new BattleRoyaleProtocol.ObjectSnapshot({
          id: BattleRoyaleProtocol.makeObjectId('drop-2'),
          x: 20,
          y: 22,
          pickup: { itemKind: 'health-pack', tier: 'common', quantity: 1, available: true },
        }),
      ],
      zone: { cx: 0, cy: 0, radius: 100 },
    });

    const entities = projector.project(projector.mergeFrame?.(undefined, welcome));

    expect(entities).toEqual(
      expect.arrayContaining([
        // A weapon drop joins by itemKind === weaponId -> its OWN pickup companion.
        expect.objectContaining({ id: 'br:pickup:drop-1', assetId: SECOND_PICKUP_ASSET_ID }),
        // Generic loot keeps the default weapon's pickup companion.
        expect.objectContaining({ id: 'br:pickup:drop-2', assetId: VISUAL_PICKUP_ASSET_ID }),
      ]),
    );
  });

  it('projects and delta-merges pickups, loot crates, hazards, and interactables', () => {
    const projector = createBattleRoyaleProjector(projectorConfig());
    const crateId = BattleRoyaleProtocol.makeObjectId('crate-1');
    const hazardId = BattleRoyaleProtocol.makeObjectId('hazard-1');
    const welcome = new BattleRoyaleProtocol.WelcomeSnapshot({
      tick: 1,
      serverTimestampMs: 100,
      seed: 1,
      players: [],
      projectiles: [],
      objects: [
        new BattleRoyaleProtocol.ObjectSnapshot({
          id: crateId,
          x: 40,
          y: 48,
          pickup: { itemKind: 'rifle', tier: 'rare', quantity: 1, available: true },
          lootSource: { tableId: 'loot-crate-a', tier: 'rare', weight: 2, collected: false },
          interactable: { action: 'pickup-loot', radius: 24, enabled: true },
          breakable: { health: 50, maxHealth: 100, destroyed: false },
        }),
        new BattleRoyaleProtocol.ObjectSnapshot({
          id: hazardId,
          x: 64,
          y: 64,
          hazard: { damagePerSecond: 6, enabled: true },
        }),
      ],
      zone: { cx: 0, cy: 0, radius: 100 },
    });

    const fullState = projector.mergeFrame?.(undefined, welcome);
    const entities = projector.project(fullState);

    expect(entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'br:crate:crate-1',
          assetId: VISUAL_PICKUP_ASSET_ID,
          tint: 0x38bdf8,
          layerIndex: 7,
        }),
        expect.objectContaining({
          id: 'br:pickup:crate-1',
          tint: 0x38bdf8,
          layerIndex: 13,
        }),
        expect.objectContaining({
          id: 'br:interactable:crate-1',
          scaleX: 8,
          layerIndex: 14,
        }),
        expect.objectContaining({
          id: 'br:crate-health-fill:crate-1',
          scaleX: 10,
          tint: 0xfacc15,
        }),
        expect.objectContaining({
          id: 'br:hazard:hazard-1',
          scale: 2,
          tint: 0xef4444,
          layerIndex: 3,
        }),
      ]),
    );

    const delta = new BattleRoyaleProtocol.DeltaSnapshot({
      tick: 2,
      serverTimestampMs: 150,
      removed: [],
      updated: [],
      projectilesUpdated: [],
      projectilesRemoved: [],
      objectsUpdated: [
        new BattleRoyaleProtocol.ObjectSnapshot({
          id: crateId,
          x: 40,
          y: 48,
          pickup: { itemKind: 'rifle', tier: 'rare', quantity: 1, available: false },
          lootSource: { tableId: 'loot-crate-a', tier: 'rare', weight: 2, collected: true },
          interactable: { action: 'pickup-loot', radius: 24, enabled: false },
          breakable: { health: 0, maxHealth: 100, destroyed: true },
        }),
      ],
      objectsRemoved: [hazardId],
      zone: Option.none(),
    });

    const nextState = projector.mergeFrame?.(fullState, delta);
    const nextEntities = projector.project(nextState);

    expect(nextEntities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'br:crate:crate-1',
          opacity: 0.45,
          tint: 0x64748b,
        }),
      ]),
    );
    expect(nextEntities.find((entity) => entity.id === 'br:pickup:crate-1')).toBeUndefined();
    expect(nextEntities.find((entity) => entity.id === 'br:interactable:crate-1')).toBeUndefined();
    expect(nextEntities.find((entity) => entity.id === 'br:hazard:hazard-1')).toBeUndefined();
  });

  it('returns server timestamp from welcome and delta frames', () => {
    const projector = createBattleRoyaleProjector();
    const welcome = new BattleRoyaleProtocol.WelcomeSnapshot({
      tick: 1,
      serverTimestampMs: 123,
      seed: 1,
      players: [],
      projectiles: [],
      zone: { cx: 0, cy: 0, radius: 100 },
    });
    const delta = new BattleRoyaleProtocol.DeltaSnapshot({
      tick: 2,
      serverTimestampMs: 173,
      removed: [],
      updated: [],
      projectilesUpdated: [],
      projectilesRemoved: [],
      zone: Option.none(),
    });

    expect(projector.getFrameTimestamp?.(welcome)).toBe(123);
    expect(projector.getFrameTimestamp?.(delta)).toBe(173);
  });

  it('round-trips reload and interact client action flags', () => {
    const bytes = encodeClientInputFrame({
      tick: 10,
      seq: 2,
      dir: 0,
      shoot: false,
      reload: true,
      interact: true,
      drop: true,
      abilities: [BattleRoyaleProtocol.BattleRoyaleAbility.dash],
      aimDeg: 90,
      swapSlot: 2,
    });

    expect(decodeClientFrameView(bytes)).toEqual({
      kind: 'input',
      tick: 10,
      seq: 2,
      dir: 0,
      shoot: false,
      reload: true,
      interact: true,
      drop: true,
      abilities: [BattleRoyaleProtocol.BattleRoyaleAbility.dash],
      aimDeg: 90,
      swapSlot: 2,
    });
  });

  it('keeps idle client action flags explicit', () => {
    const bytes = encodeClientInputFrame({
      tick: 11,
      seq: 3,
      shoot: false,
      reload: false,
      interact: false,
      drop: false,
      abilities: [],
    });

    expect(decodeClientFrameView(bytes)).toEqual({
      kind: 'input',
      tick: 11,
      seq: 3,
      shoot: false,
      reload: false,
      interact: false,
      drop: false,
      abilities: [],
    });
  });

  it('round-trips snapshot ack frames', () => {
    const bytes = encodeSnapshotAckFrame(24, 1_234);

    expect(decodeClientFrameView(bytes)).toEqual({
      kind: 'ack',
      tick: 24,
      receivedAtMs: 1_234,
    });
  });
});
