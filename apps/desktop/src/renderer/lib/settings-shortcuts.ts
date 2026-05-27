import { BOTTOM_DRAWER_TABS } from '@/components/bottom-drawer/constants';
import { SHORTCUTS } from '@/lib/keyboard-shortcuts';
import { SHELL_COMMANDS } from '@/lib/shell-command-registry';

export interface SettingsShortcutEntry {
  readonly label: string;
  readonly keys: readonly string[];
}

export function collectSettingsShortcuts(): readonly SettingsShortcutEntry[] {
  const shellEntries: SettingsShortcutEntry[] = [];
  for (const command of SHELL_COMMANDS) {
    if (command.shortcut !== undefined) {
      shellEntries.push({
        label: command.label,
        keys: command.shortcut(),
      });
    }
  }

  const drawerEntries = BOTTOM_DRAWER_TABS.map((tab) => ({
    label: `Bottom drawer: ${tab.label}`,
    keys: SHORTCUTS.bottomDrawerTab(Number(tab.shortcut)),
  }));

  return [...shellEntries, ...drawerEntries];
}
