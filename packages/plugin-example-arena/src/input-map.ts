import { CORE_ACTIONS } from '@tileborne/core';

/**
 * The arena mode's default input map as plain DATA (the wire/JSON shape declared
 * in the manifest `runtime.inputMaps` slot). The engine owns the `InputMap`
 * SHAPE (`@tileborne/core`); this plugin supplies only the bindings, decoded +
 * validated by `decodeInputMap` in `@tileborne/plugin-api`.
 *
 * Deliberately DIFFERENT from Battle Royale's default map to prove genre
 * neutrality: PrimaryAction (the melee swing) is bound to mouse button 0 only
 * (BR also binds Space), and the mode adds a distinct `core.Dash` action on
 * Shift that BR's default map never declares. No Reload / weapon-slot actions.
 */

export const ARENA_INPUT_MAP_CONTRIBUTION_ID = 'arena-input-map';
export const ARENA_INPUT_MAP_ID = 'arena-default-bindings';

export const buildArenaInputMapData = (): {
  readonly id: string;
  readonly actions: readonly { readonly action: string; readonly valueKind: string }[];
  readonly schemeDefaults: Readonly<Record<string, readonly unknown[]>>;
} => ({
  id: ARENA_INPUT_MAP_ID,
  actions: [
    { action: CORE_ACTIONS.Move, valueKind: 'analog2d' },
    { action: CORE_ACTIONS.Aim, valueKind: 'pointer' },
    { action: CORE_ACTIONS.PrimaryAction, valueKind: 'digital' },
    { action: CORE_ACTIONS.Dash, valueKind: 'digital' },
  ],
  schemeDefaults: {
    'keyboard-mouse': [
      {
        _tag: 'InputBinding',
        action: CORE_ACTIONS.Move,
        trigger: { _tag: 'key', code: 'KeyW' },
        axisRole: 'y-',
      },
      {
        _tag: 'InputBinding',
        action: CORE_ACTIONS.Move,
        trigger: { _tag: 'key', code: 'KeyS' },
        axisRole: 'y+',
      },
      {
        _tag: 'InputBinding',
        action: CORE_ACTIONS.Move,
        trigger: { _tag: 'key', code: 'KeyA' },
        axisRole: 'x-',
      },
      {
        _tag: 'InputBinding',
        action: CORE_ACTIONS.Move,
        trigger: { _tag: 'key', code: 'KeyD' },
        axisRole: 'x+',
      },
      { _tag: 'InputBinding', action: CORE_ACTIONS.Aim, trigger: { _tag: 'pointer' } },
      // PrimaryAction (melee swing) on the left mouse button ONLY — distinct from BR.
      {
        _tag: 'InputBinding',
        action: CORE_ACTIONS.PrimaryAction,
        trigger: { _tag: 'mouseButton', button: 0 },
      },
      // Distinct extra action BR's default map does not declare.
      {
        _tag: 'InputBinding',
        action: CORE_ACTIONS.Dash,
        trigger: { _tag: 'key', code: 'ShiftLeft' },
      },
    ],
  },
});
