export const BOTTOM_DRAWER_TABS = [
  { value: 'jobs', label: 'Jobs', shortcut: '1' },
  { value: 'logs', label: 'Logs', shortcut: '2' },
  { value: 'problems', label: 'Problems', shortcut: '3' },
  { value: 'playtest', label: 'Playtest', shortcut: '4' },
  { value: 'runtime', label: 'Runtime', shortcut: '5' },
] as const;

export type BottomDrawerTabValue = (typeof BOTTOM_DRAWER_TABS)[number]['value'];

export const DEFAULT_BOTTOM_DRAWER_TAB: BottomDrawerTabValue = 'jobs';

export function isBottomDrawerTabValue(value: string): value is BottomDrawerTabValue {
  return BOTTOM_DRAWER_TABS.some((tab) => tab.value === value);
}
