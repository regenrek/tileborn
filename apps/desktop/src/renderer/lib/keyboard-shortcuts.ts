/** Platform-aware modifier label for shortcut badges. */
export function modKeyLabel(): '⌘' | 'Ctrl' {
  if (typeof navigator === 'undefined') {
    return '⌘';
  }
  return /Mac|iPhone|iPod|iPad/i.test(navigator.platform) ? '⌘' : 'Ctrl';
}

/** Shortcut token list with platform modifier applied. */
export function shortcutWithMod(...keys: readonly string[]): readonly string[] {
  return [modKeyLabel(), ...keys];
}

export const SHORTCUTS = {
  commandPalette: () => shortcutWithMod('K'),
  generateMap: () => shortcutWithMod('G'),
  undo: () => shortcutWithMod('Z'),
  redo: () => shortcutWithMod('⇧', 'Z'),
  toggleBottomDrawer: () => shortcutWithMod('J'),
  bottomDrawerTab: (index: number) => shortcutWithMod(String(index)),
} as const;
