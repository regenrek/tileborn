import {
  coreActionId,
  CORE_ACTIONS,
  type ActionState,
  type DigitalActionState,
} from '@tileborne/core';
import { BattleRoyaleAbility } from '@tileborne/ipc-contracts/protocols/battle-royale';
import { decodeInputMap, findUndeclaredBoundActions } from '@tileborne/plugin-api';
import { Result } from 'effect';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  BR_INPUT_MAP_CONTRIBUTION_ID,
  BR_INPUT_MAP_ID,
  battleRoyaleDefaultInputMap,
  battleRoyalePlaytestHeldBooleanInputFields,
  battleRoyalePlaytestInputEdgeFields,
  resolveBattleRoyaleInputIntent,
} from './input-map.js';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

const readManifestInputMapData = (): unknown => {
  const manifestPath = path.join(packageRoot, '../tileborne-plugin.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    contributes?: {
      runtime?: { inputMaps?: readonly { readonly id: string; readonly data: unknown }[] };
    };
  };
  const contribution = manifest.contributes?.runtime?.inputMaps?.find(
    (entry) => entry.id === BR_INPUT_MAP_CONTRIBUTION_ID,
  );
  if (!contribution) {
    throw new Error('battle-royale manifest is missing the input-map contribution');
  }
  return contribution.data;
};

const pressed: DigitalActionState = { pressed: true, justPressed: true, justReleased: false };

const actionState = (overrides: {
  digital?: ReadonlyArray<readonly [string, DigitalActionState]>;
  analog?: ReadonlyArray<readonly [string, { x: number; y: number }]>;
  pointer?: ReadonlyArray<readonly [string, { x: number; y: number }]>;
}): ActionState => ({
  digital: new Map(
    (overrides.digital ?? []).map(([id, value]) => [coreActionId(id as never), value]),
  ),
  analog: new Map(
    (overrides.analog ?? []).map(([id, value]) => [coreActionId(id as never), value]),
  ),
  pointer: new Map(
    (overrides.pointer ?? []).map(([id, value]) => [coreActionId(id as never), value]),
  ),
});

describe('battle royale input-map contribution', () => {
  it('decodes the manifest inputMaps slot data against the @tileborne/core InputMap schema', () => {
    const decoded = decodeInputMap(BR_INPUT_MAP_CONTRIBUTION_ID, readManifestInputMapData());
    expect(Result.isSuccess(decoded)).toBe(true);
    if (Result.isSuccess(decoded)) {
      expect(decoded.success.id).toBe(BR_INPUT_MAP_ID);
      // Every bound action carries a value-kind declaration.
      expect(findUndeclaredBoundActions(decoded.success)).toEqual([]);
    }
  });

  it('keeps the code-built default map in sync with the manifest (both decode equal)', () => {
    const fromManifest = decodeInputMap(BR_INPUT_MAP_CONTRIBUTION_ID, readManifestInputMapData());
    expect(Result.isSuccess(fromManifest)).toBe(true);
    if (Result.isSuccess(fromManifest)) {
      expect(battleRoyaleDefaultInputMap()).toEqual(fromManifest.success);
    }
  });

  it('binds PrimaryAction to BOTH Space and mouse-0 in the keyboard-mouse scheme', () => {
    const map = battleRoyaleDefaultInputMap();
    const bindings = map.schemeDefaults['keyboard-mouse' as keyof typeof map.schemeDefaults] ?? [];
    const primary = bindings.filter((binding) => binding.action === CORE_ACTIONS.PrimaryAction);
    expect(primary.some((b) => b.trigger._tag === 'key' && b.trigger.code === 'Space')).toBe(true);
    expect(primary.some((b) => b.trigger._tag === 'mouseButton' && b.trigger.button === 0)).toBe(
      true,
    );
  });
});

describe('resolveBattleRoyaleInputIntent (action→intent adapter)', () => {
  it('maps PrimaryAction.pressed → shoot, regardless of which trigger pressed it', () => {
    const intent = resolveBattleRoyaleInputIntent(
      actionState({ digital: [[CORE_ACTIONS.PrimaryAction, pressed]] }),
    );
    expect(intent.shoot).toBe(true);
    expect(intent.dir).toBeUndefined();
  });

  it('maps the Move vector to the 8-way direction and aim pointer to aimDeg', () => {
    const intent = resolveBattleRoyaleInputIntent(
      actionState({
        analog: [[CORE_ACTIONS.Move, { x: 1, y: 0 }]],
        pointer: [[CORE_ACTIONS.Aim, { x: 100, y: 50 }]],
      }),
      { aimOrigin: { x: 50, y: 50 } },
    );
    expect(intent.dir).toBe(0); // east
    expect(intent.aimDeg).toBe(0); // pointer due-east of the origin
  });

  it('maps a just-pressed slot selector to its swap slot', () => {
    const intent = resolveBattleRoyaleInputIntent(
      actionState({ digital: [[CORE_ACTIONS.Slot3, pressed]] }),
    );
    expect(intent.swapSlot).toBe(3);
  });

  it('maps one-shot BR actions to drop and ability ids', () => {
    const intent = resolveBattleRoyaleInputIntent(
      actionState({
        digital: [
          ['battle-royale.DropItem', pressed],
          [CORE_ACTIONS.Dash, pressed],
          [CORE_ACTIONS.SecondaryAction, pressed],
          ['battle-royale.ScanPulse', pressed],
          ['battle-royale.PlaceTrap', pressed],
          ['battle-royale.DeployDecoy', pressed],
        ],
      }),
    );
    expect(intent.drop).toBe(true);
    expect(intent.abilities).toEqual([
      BattleRoyaleAbility.dash,
      BattleRoyaleAbility.shieldBurst,
      BattleRoyaleAbility.scanPulse,
      BattleRoyaleAbility.trap,
      BattleRoyaleAbility.decoy,
    ]);
  });

  it('maps Reload and Interact into explicit runtime action flags', () => {
    const intent = resolveBattleRoyaleInputIntent(
      actionState({
        digital: [
          [CORE_ACTIONS.Reload, pressed],
          [CORE_ACTIONS.Interact, pressed],
        ],
      }),
    );
    expect(intent.reload).toBe(true);
    expect(intent.interact).toBe(true);
  });

  it('declares BR edge-like intent fields for generic host transport buffering', () => {
    expect(battleRoyalePlaytestInputEdgeFields).toEqual([
      'shoot',
      'reload',
      'interact',
      'drop',
      'abilities',
      'swapSlot',
    ]);
    expect(battleRoyalePlaytestHeldBooleanInputFields).toEqual(['shoot']);
  });

  it('reports idle (dir undefined, no shoot) when nothing is pressed', () => {
    const intent = resolveBattleRoyaleInputIntent(
      actionState({ analog: [[CORE_ACTIONS.Move, { x: 0, y: 0 }]] }),
    );
    expect(intent.dir).toBeUndefined();
    expect(intent.shoot).toBe(false);
    expect(intent.reload).toBe(false);
    expect(intent.interact).toBe(false);
    expect(intent.drop).toBe(false);
    expect(intent.abilities).toEqual([]);
    expect(intent.swapSlot).toBeUndefined();
  });
});
