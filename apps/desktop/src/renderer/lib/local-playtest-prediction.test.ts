import { describe, expect, it } from 'vitest';
import type { RenderableEntity } from '@tileborne/runtime';

import {
  applyLocalPredictionToEntities,
  LocalPlaytestPredictionController,
} from './local-playtest-prediction';

const localEntity = (x = 0, y = 0): RenderableEntity => ({
  id: 'br:player:player-1',
  assetId: 'player',
  x,
  y,
  rotation: 0,
});

describe('LocalPlaytestPredictionController', () => {
  it('does not fill pending prediction history for a released stationary input over 120 frames', () => {
    const controller = new LocalPlaytestPredictionController();
    controller.recordInput({ sequence: 1, dir: 0 });
    applyLocalPredictionToEntities(
      [localEntity()],
      { entity: localEntity(), acknowledgedInputSequence: -1 },
      controller,
      0,
    );

    controller.recordInput({ sequence: 2, dir: undefined });
    for (let frame = 1; frame <= 140; frame += 1) {
      expect(() =>
        applyLocalPredictionToEntities(
          [localEntity()],
          { entity: localEntity(), acknowledgedInputSequence: 2 },
          controller,
          frame * 16,
        ),
      ).not.toThrow();
    }

    expect(
      applyLocalPredictionToEntities(
        [localEntity()],
        { entity: localEntity(), acknowledgedInputSequence: 2 },
        controller,
        141 * 16,
      ),
    ).toEqual([localEntity()]);
  });

  it('keeps unacknowledged local motion until the authoritative snapshot carries its sequence', () => {
    const controller = new LocalPlaytestPredictionController();
    controller.recordInput({ sequence: 7, dir: 0 });

    applyLocalPredictionToEntities(
      [localEntity()],
      { entity: localEntity(), acknowledgedInputSequence: -1 },
      controller,
      0,
    );
    const predicted = applyLocalPredictionToEntities(
      [localEntity()],
      { entity: localEntity(), acknowledgedInputSequence: -1 },
      controller,
      50,
    );

    expect(predicted[0]?.x).toBeGreaterThan(0);

    const reconciled = applyLocalPredictionToEntities(
      [localEntity(6, 0)],
      { entity: localEntity(6, 0), acknowledgedInputSequence: 7 },
      controller,
      66,
    );

    expect(reconciled[0]?.x).toBeGreaterThan(6);
  });

  it('replays unacknowledged motion when a stale-authority snapshot moves', () => {
    const controller = new LocalPlaytestPredictionController();
    controller.recordInput({ sequence: 7, dir: 0 });

    applyLocalPredictionToEntities(
      [localEntity()],
      { entity: localEntity(), acknowledgedInputSequence: -1 },
      controller,
      0,
    );
    let beforeStaleUpdate = [localEntity()];
    for (let frame = 1; frame <= 140; frame += 1) {
      beforeStaleUpdate = applyLocalPredictionToEntities(
        [localEntity()],
        { entity: localEntity(), acknowledgedInputSequence: -1 },
        controller,
        frame * 16,
      );
    }
    const afterStaleUpdate = applyLocalPredictionToEntities(
      [localEntity(2, 0)],
      { entity: localEntity(2, 0), acknowledgedInputSequence: -1 },
      controller,
      141 * 16,
    );

    expect(beforeStaleUpdate[0]?.x).toBeGreaterThan(0);
    expect(afterStaleUpdate[0]?.x).toBeGreaterThan(2);

    controller.recordInput({ sequence: 8, dir: 2 });
    let afterDirectionChange = afterStaleUpdate;
    for (let frame = 142; frame <= 151; frame += 1) {
      afterDirectionChange = applyLocalPredictionToEntities(
        [localEntity(3, 1)],
        { entity: localEntity(3, 1), acknowledgedInputSequence: -1 },
        controller,
        frame * 16,
      );
    }
    expect(afterDirectionChange[0]?.x).toBeGreaterThan(3);
    expect(afterDirectionChange[0]?.y).toBeGreaterThan(1);

    controller.recordInput({ sequence: 9, dir: undefined });
    const released = applyLocalPredictionToEntities(
      [localEntity(4, 3)],
      { entity: localEntity(4, 3), acknowledgedInputSequence: 7 },
      controller,
      152 * 16,
    );
    expect(released[0]?.x).toBeCloseTo(4);
    expect(released[0]?.y).toBeGreaterThan(3);

    const reconciledRelease = applyLocalPredictionToEntities(
      [localEntity(4, 22.2)],
      { entity: localEntity(4, 22.2), acknowledgedInputSequence: 9 },
      controller,
      153 * 16,
    );
    expect(reconciledRelease).toEqual([localEntity(4, 22.2)]);
  });
});
