import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { CORE_ACTIONS, CORE_ACTION_IDS, makeActionId } from './actions.js';
import { CONTROL_SCHEMES, controlScheme } from './control-scheme.js';
import { emptyActionState } from './action-state.js';
import { InputBinding, InputMap, KeyTrigger, MouseButtonTrigger, RawTrigger } from './input-map.js';

const MAP_DATA = {
  id: 'round-trip',
  actions: [
    { action: CORE_ACTIONS.PrimaryAction, valueKind: 'digital' },
    { action: CORE_ACTIONS.Move, valueKind: 'analog2d' },
    { action: CORE_ACTIONS.Aim, valueKind: 'pointer' },
  ],
  schemeDefaults: {
    'keyboard-mouse': [
      {
        _tag: 'InputBinding',
        action: CORE_ACTIONS.PrimaryAction,
        trigger: { _tag: 'key', code: 'Space' },
      },
      {
        _tag: 'InputBinding',
        action: CORE_ACTIONS.PrimaryAction,
        trigger: { _tag: 'mouseButton', button: 0 },
      },
      {
        _tag: 'InputBinding',
        action: CORE_ACTIONS.Move,
        trigger: { _tag: 'key', code: 'KeyD' },
        axisRole: 'x+',
      },
      { _tag: 'InputBinding', action: CORE_ACTIONS.Aim, trigger: { _tag: 'pointer' } },
    ],
  },
};

describe('action vocabulary', () => {
  it('exposes the baseline CORE_ACTIONS as open `core.`-namespaced ids', () => {
    expect(CORE_ACTIONS.PrimaryAction).toBe('core.PrimaryAction');
    expect(CORE_ACTION_IDS).toContain('core.Move');
    expect(CORE_ACTION_IDS).toContain('core.Slot5');
  });

  it('brands an arbitrary (plugin-defined) action id without engine edits', () => {
    expect(makeActionId('myMode.Grapple')).toBe('myMode.Grapple');
  });

  it('produces an all-empty ActionState', () => {
    const state = emptyActionState();
    expect(state.digital.size).toBe(0);
    expect(state.analog.size).toBe(0);
    expect(state.pointer.size).toBe(0);
  });
});

describe('RawTrigger union', () => {
  it('decodes each trigger variant by its _tag', () => {
    expect(Schema.decodeUnknownSync(RawTrigger)({ _tag: 'key', code: 'KeyW' })).toBeInstanceOf(
      KeyTrigger,
    );
    expect(Schema.decodeUnknownSync(RawTrigger)({ _tag: 'mouseButton', button: 1 })).toBeInstanceOf(
      MouseButtonTrigger,
    );
    expect(Schema.decodeUnknownSync(RawTrigger)({ _tag: 'axis', axis: 0, sign: -1 })._tag).toBe(
      'axis',
    );
    expect(Schema.decodeUnknownSync(RawTrigger)({ _tag: 'pointer' })._tag).toBe('pointer');
  });

  it('rejects an unknown trigger tag', () => {
    expect(() => Schema.decodeUnknownSync(RawTrigger)({ _tag: 'telepathy' })).toThrow();
  });
});

describe('InputMap round-trip', () => {
  it('decodes durable input-map data and re-encodes to the same shape', () => {
    const decoded = Schema.decodeUnknownSync(InputMap)(MAP_DATA);
    expect(decoded.id).toBe('round-trip');
    expect(decoded.actions).toHaveLength(3);
    const bindings = decoded.schemeDefaults[controlScheme(CONTROL_SCHEMES.KeyboardMouse)];
    expect(bindings).toBeDefined();
    expect(bindings?.[0]).toBeInstanceOf(InputBinding);

    const encoded = Schema.encodeUnknownSync(InputMap)(decoded);
    const reDecoded = Schema.decodeUnknownSync(InputMap)(encoded);
    expect(reDecoded).toEqual(decoded);
  });

  it('rejects an input map that is not the declared shape', () => {
    expect(() => Schema.decodeUnknownSync(InputMap)({ id: 5 })).toThrow();
  });
});
