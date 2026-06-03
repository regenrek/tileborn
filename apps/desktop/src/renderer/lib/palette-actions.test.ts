import { describe, expect, it } from 'vitest';

import {
  brushIntentMatchesPaletteAction,
  paletteActionBrushIntent,
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
