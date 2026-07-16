import { Option, Schema } from 'effect';
import { pack } from 'msgpackr';
import { describe, expect, it } from 'vitest';

import {
  BattleRoyaleMessage,
  BattleRoyaleAbility,
  DeltaSnapshot,
  DeployableSnapshot,
  DeployableUpdate,
  GameOver,
  Heartbeat,
  ObjectSnapshot,
  PlayerInput,
  PlayerJoined,
  PlayerKilled,
  PlayerLeft,
  SnapshotAck,
  ProjectileSnapshot,
  ProjectileUpdate,
  WelcomeSnapshot,
  WireError,
  decodeMessage,
  encodeMessage,
  makeDeployableId,
  makeDeployableOwnerId,
  makeObjectId,
  makePlayerId,
  makeProjectileId,
} from './battle-royale.ts';

const player = (suffix: string) => makePlayerId(`player-${suffix}`);

const sampleMessages: readonly Schema.Schema.Type<typeof BattleRoyaleMessage>[] = [
  new PlayerInput({
    tick: 12,
    seq: 3,
    dir: Option.some(2),
    shoot: true,
    reload: false,
    interact: true,
    drop: false,
    abilities: [BattleRoyaleAbility.dash, BattleRoyaleAbility.scanPulse],
    aimDeg: Option.some(90),
    swapSlot: Option.some(2),
  }),
  new Heartbeat({
    tick: 12,
  }),
  new SnapshotAck({
    tick: 12,
    receivedAtMs: 1_000,
  }),
  new WelcomeSnapshot({
    tick: 0,
    serverTimestampMs: 1000,
    seed: 'seed-1',
    players: [
      {
        id: player('1'),
        x: 10,
        y: 20,
        health: 100,
        shield: 25,
        armor: { mitigation: 0.25, durability: 80 },
        weapon: {
          weaponId: 'weapon:primary',
          slot: 1,
          ammoInMagazine: 2,
          magazineSize: 3,
          reserveAmmo: 6,
          cooldownRemainingTicks: 0,
          reloadRemainingTicks: 0,
          reloadTotalTicks: 12,
        },
        inventory: { itemIds: ['health-pack'], capacity: 5 },
        pickupPrompt: {
          itemKind: 'ammo-box',
          tier: 'common',
          distance: 1.2,
          action: 'pickup-loot',
          available: true,
        },
        pickupToast: {
          itemKind: 'ammo-box',
          tier: 'common',
          quantity: 1,
          tick: 4,
        },
        damageIndicator: {
          sourceId: 'player-2',
          angleDeg: 90,
          amount: 12,
          tick: 4,
        },
        stats: { kills: 1, deaths: 0 },
        statusEffects: [{ effectId: 'reveal', remainingTicks: 20, stacks: 1 }],
        abilityCooldowns: [{ abilityId: BattleRoyaleAbility.dash, remainingTicks: 8 }],
      },
      { id: player('2'), x: 30, y: 40, health: 80 },
    ],
    projectiles: [
      new ProjectileSnapshot({
        id: makeProjectileId('projectile-1'),
        ownerPlayerId: player('1'),
        weaponSlot: 0,
        x: 12,
        y: 24,
        vx: 1,
        vy: 0,
        rotation: 0,
        ttlMs: 300,
      }),
    ],
    deployables: [
      new DeployableSnapshot({
        id: makeDeployableId('deployable-1'),
        kind: 'trap',
        ownerId: makeDeployableOwnerId('environment'),
        x: 20,
        y: 24,
        radius: 28,
        remainingTicks: 120,
        armedTicks: 0,
        triggered: false,
      }),
    ],
    objects: [
      new ObjectSnapshot({
        id: makeObjectId('object-1'),
        x: 40,
        y: 48,
        pickup: { itemKind: 'rifle', tier: 'rare', quantity: 1, available: true },
        lootSource: { tableId: 'loot-crate', tier: 'rare', weight: 2, collected: false },
        interactable: { action: 'pickup-loot', radius: 32, enabled: true },
        breakable: { health: 100, maxHealth: 100, destroyed: false },
      }),
      new ObjectSnapshot({
        id: makeObjectId('hazard-1'),
        x: 64,
        y: 64,
        hazard: { damagePerSecond: 5, enabled: true },
      }),
    ],
    zone: { cx: 64, cy: 64, radius: 128 },
  }),
  new DeltaSnapshot({
    tick: 5,
    serverTimestampMs: 1050,
    removed: [player('3')],
    updated: [
      {
        id: player('1'),
        team: Option.some('solo'),
        x: Option.some(11),
        y: Option.none(),
        health: Option.some(95),
        shield: Option.some(0),
        armor: Option.some({ mitigation: 0.25, durability: 70 }),
        weapon: Option.some({
          weaponId: 'weapon:primary',
          slot: 2,
          ammoInMagazine: 1,
          magazineSize: 3,
          reserveAmmo: 3,
          cooldownRemainingTicks: 4,
          reloadRemainingTicks: 0,
          reloadTotalTicks: 12,
        }),
        inventory: Option.some({ itemIds: [], capacity: 5 }),
        pickupPrompt: Option.some({ action: 'pickup-loot', available: false }),
        pickupToast: Option.some({ itemKind: 'ammo-box', tier: 'common', quantity: 1, tick: 5 }),
        damageIndicator: Option.some({ sourceId: 'player-2', angleDeg: 180, amount: 8, tick: 5 }),
        stats: Option.some({ kills: 2, deaths: 0 }),
        statusEffects: Option.some([]),
        abilityCooldowns: Option.some([]),
        animation: Option.none(),
      },
    ],
    projectilesUpdated: [
      new ProjectileUpdate({
        id: makeProjectileId('projectile-1'),
        ownerPlayerId: Option.none(),
        weaponSlot: Option.none(),
        x: Option.some(14),
        y: Option.none(),
        vx: Option.none(),
        vy: Option.none(),
        rotation: Option.none(),
        ttlMs: Option.some(284),
      }),
    ],
    projectilesRemoved: [makeProjectileId('projectile-2')],
    deployablesUpdated: [
      new DeployableUpdate({
        id: makeDeployableId('deployable-1'),
        kind: Option.none(),
        ownerId: Option.some(makeDeployableOwnerId('player-1')),
        x: Option.none(),
        y: Option.none(),
        radius: Option.none(),
        remainingTicks: Option.some(100),
        armedTicks: Option.none(),
        triggered: Option.some(true),
      }),
    ],
    deployablesRemoved: [makeDeployableId('deployable-2')],
    objectsUpdated: [
      new ObjectSnapshot({
        id: makeObjectId('object-1'),
        x: 40,
        y: 48,
        pickup: { itemKind: 'rifle', tier: 'rare', quantity: 1, available: false },
        lootSource: { tableId: 'loot-crate', tier: 'rare', weight: 2, collected: true },
        interactable: { action: 'pickup-loot', radius: 32, enabled: false },
        breakable: { health: 0, maxHealth: 100, destroyed: true },
      }),
    ],
    objectsRemoved: [makeObjectId('hazard-1')],
    zone: Option.some({ cx: 64, cy: 64, radius: 120 }),
  }),
  new PlayerJoined({
    id: player('4'),
  }),
  new PlayerLeft({
    id: player('4'),
  }),
  new PlayerKilled({
    killer: player('1'),
    victim: player('2'),
    tick: 42,
  }),
  new GameOver({
    winner: player('1'),
  }),
  new WireError({
    code: 'invalid_input',
    message: 'tick out of range',
  }),
];

describe('BattleRoyaleProtocol wire codec', () => {
  for (const message of sampleMessages) {
    it(`round-trips ${message._tag}`, () => {
      expect(decodeMessage(encodeMessage(message))).toEqual(message);
    });
  }

  it('keeps DeltaSnapshot with 16 player updates under 1024 bytes', () => {
    const delta = new DeltaSnapshot({
      tick: 100,
      serverTimestampMs: 5_000,
      removed: [],
      updated: Array.from({ length: 16 }, (_, index) => ({
        id: makePlayerId(String(index)),
        team: Option.none(),
        x: Option.some(index * 2),
        y: Option.some(index * 3),
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
      })),
      projectilesUpdated: [],
      projectilesRemoved: [],
      zone: Option.none(),
    });

    const bytes = encodeMessage(delta);
    expect(bytes.byteLength).toBeLessThan(1024);
  });

  it('decodes PlayerInput frames without optional aim or swap fields', () => {
    const decoded = decodeMessage(
      pack({
        _tag: 'PlayerInput',
        tick: 12,
        seq: 3,
        dir: 2,
        shoot: true,
        reload: false,
        interact: true,
        drop: false,
        abilities: [],
      }),
    );

    expect(decoded).toBeInstanceOf(PlayerInput);
    expect(decoded).toMatchObject({
      tick: 12,
      seq: 3,
      dir: Option.some(2),
      shoot: true,
      reload: false,
      interact: true,
      drop: false,
      abilities: [],
      aimDeg: Option.none(),
      swapSlot: Option.none(),
    });
  });

  it('round-trips shoot-only PlayerInput without movement direction', () => {
    const input = new PlayerInput({
      tick: 13,
      seq: 4,
      dir: Option.none(),
      shoot: true,
      reload: false,
      interact: false,
      drop: false,
      abilities: [],
      aimDeg: Option.none(),
      swapSlot: Option.none(),
    });

    const decoded = decodeMessage(encodeMessage(input));

    expect(decoded).toEqual(input);
    expect(decoded).toMatchObject({
      dir: Option.none(),
      shoot: true,
      reload: false,
      interact: false,
    });
  });

  it('round-trips a per-player modelId on PlayerSnapshot', () => {
    const welcome = new WelcomeSnapshot({
      tick: 7,
      serverTimestampMs: 7,
      seed: 'seed',
      players: [
        { id: player('1'), x: 10, y: 20, health: 100, modelId: 'model:hero' },
        { id: player('2'), x: 30, y: 40, health: 100 },
      ],
      projectiles: [],
      zone: { cx: 0, cy: 0, radius: 100 },
    });
    const decoded = decodeMessage(encodeMessage(welcome)) as WelcomeSnapshot;
    expect(decoded.players[0]?.modelId).toBe('model:hero');
    expect(decoded.players[1]?.modelId).toBeUndefined();
  });

  it('decodes legacy snapshot frames by defaulting server timestamp from tick', () => {
    const welcome = decodeMessage(
      pack({
        _tag: 'WelcomeSnapshot',
        tick: 42,
        seed: 'seed-1',
        players: [],
        projectiles: [],
        zone: { cx: 0, cy: 0, radius: 100 },
      }),
    );
    const delta = decodeMessage(
      pack({
        _tag: 'DeltaSnapshot',
        tick: 43,
        removed: [],
        updated: [],
        projectilesUpdated: [],
        projectilesRemoved: [],
      }),
    );

    expect(welcome).toMatchObject({ _tag: 'WelcomeSnapshot', serverTimestampMs: 42 });
    expect(delta).toMatchObject({ _tag: 'DeltaSnapshot', serverTimestampMs: 43 });
  });
});
