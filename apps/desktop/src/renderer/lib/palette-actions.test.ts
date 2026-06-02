import { describe, expect, it } from 'vitest';

import {
  brushIntentMatchesPaletteAction,
  paletteActionBrushIntent,
  resolvePaletteActions,
  type PaletteActionContribution,
  type PaletteActionIcon,
  type PaletteActionItem,
} from '@/lib/palette-actions';

const StubIcon: PaletteActionIcon = () => null;

const action = (overrides: Partial<PaletteActionItem> = {}): PaletteActionItem => ({
  id: 'action-1',
  objectKind: 'marker',
  label: 'Marker',
  icon: StubIcon,
  placement: 'sticky',
  ...overrides,
});

describe('resolvePaletteActions', () => {
  const battleRoyale: PaletteActionContribution = {
    pluginId: 'plugin-a',
    items: [action({ id: 'a-1', objectKind: 'spawn' })],
  };
  // A second, hypothetical game-mode plugin proving the mechanism is generic:
  // the resolver never mentions any plugin by name.
  const rpg: PaletteActionContribution = {
    pluginId: 'plugin-rpg',
    items: [action({ id: 'rpg-1', objectKind: 'rpg-spawn', label: 'Hero start' })],
  };

  it('returns only the items of enabled plugins', () => {
    expect(resolvePaletteActions(['plugin-a'], [battleRoyale, rpg])).toEqual(battleRoyale.items);
    expect(resolvePaletteActions(['plugin-rpg'], [battleRoyale, rpg])).toEqual(rpg.items);
  });

  it('returns nothing when no contributing plugin is enabled', () => {
    expect(resolvePaletteActions(['other'], [battleRoyale, rpg])).toEqual([]);
    expect(resolvePaletteActions([], [battleRoyale, rpg])).toEqual([]);
  });
});

describe('paletteActionBrushIntent', () => {
  it('builds a plugin-object brush carrying the abstract objectKind + presentation', () => {
    const intent = paletteActionBrushIntent(action({ objectKind: 'spawn', label: 'Spawn point' }));
    expect(intent).toEqual({
      kind: 'plugin-object',
      objectKind: 'spawn',
      label: 'Spawn point',
      icon: StubIcon,
    });
  });

  it('matches the contributing item by objectKind regardless of label', () => {
    const item = action({ objectKind: 'spawn', label: 'Spawn point' });
    const intent = paletteActionBrushIntent({ ...item, label: 'Player start' });
    expect(brushIntentMatchesPaletteAction(intent, item)).toBe(true);
    expect(brushIntentMatchesPaletteAction(intent, action({ objectKind: 'loot' }))).toBe(false);
    expect(brushIntentMatchesPaletteAction({ kind: 'eraser' }, item)).toBe(false);
  });
});
