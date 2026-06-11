import type { LucideIcon } from 'lucide-react';
import {
  EraserIcon,
  FolderOpenIcon,
  Grid3x3Icon,
  HammerIcon,
  HandIcon,
  HelpCircleIcon,
  LayersIcon,
  MapIcon,
  MousePointer2Icon,
  PackageIcon,
  PaintbrushIcon,
  PlayIcon,
  PuzzleIcon,
  Redo2Icon,
  SettingsIcon,
  SquareDashedIcon,
  Undo2Icon,
  WrenchIcon,
} from 'lucide-react';

import { TOOL_LABELS, toolShortcut } from '@/lib/editor-tool-labels';
import { SHORTCUTS } from '@/lib/keyboard-shortcuts';
import { WORKSPACE_VIEWS } from '@/lib/workspace-views';
import type { EditorTool } from '@/stores/editor-ui-store';

export type ShellCommandGroupId =
  | 'recent'
  | 'file'
  | 'edit'
  | 'view'
  | 'map'
  | 'plugins'
  | 'help';

export const SHELL_COMMAND_GROUP_ORDER: readonly ShellCommandGroupId[] = [
  'recent',
  'file',
  'edit',
  'view',
  'map',
  'plugins',
  'help',
] as const;

export const SHELL_COMMAND_GROUP_LABELS: Record<ShellCommandGroupId, string> = {
  recent: 'Recent',
  file: 'File',
  edit: 'Edit',
  view: 'View',
  map: 'Map',
  plugins: 'Plugins',
  help: 'Help',
};

export interface ShellCommandDef {
  readonly id: string;
  readonly label: string;
  readonly group: ShellCommandGroupId;
  readonly icon?: LucideIcon;
  readonly keywords?: readonly string[];
  readonly shortcut?: () => readonly string[];
  readonly requiresProject?: boolean;
  readonly requiresMap?: boolean;
}

const TOOL_ICONS: Record<EditorTool, LucideIcon> = {
  select: MousePointer2Icon,
  pan: HandIcon,
  tileBrush: PaintbrushIcon,
  rectangleFill: SquareDashedIcon,
  eraser: EraserIcon,
  objectPlace: PackageIcon,
  objectMove: WrenchIcon,
  collisionPaint: LayersIcon,
  regionMark: MapIcon,
};

const COMMAND_TOOL_IDS: readonly EditorTool[] = [
  'select',
  'pan',
  'tileBrush',
  'rectangleFill',
  'eraser',
  'objectMove',
  'collisionPaint',
  'regionMark',
] as const;

const toolCommands: ShellCommandDef[] = COMMAND_TOOL_IDS.map((tool) => ({
  id: `tool.${tool}`,
  label: TOOL_LABELS[tool],
  group: 'edit',
  icon: TOOL_ICONS[tool],
  keywords: ['tool', tool],
  shortcut: () => [toolShortcut(tool)],
  requiresMap: true,
}));

/**
 * View commands generated from the workspace-view SSOT (`workspace-views.ts`).
 * Label/icon/keywords are owned there; the palette executes them by navigating
 * to the view's registered route.
 */
const workspaceViewCommands: ShellCommandDef[] = WORKSPACE_VIEWS.filter(
  (view) => view.commandId !== undefined,
).map((view) => ({
  id: view.commandId!,
  label: view.label,
  group: 'view',
  icon: view.icon,
  requiresProject: true,
  ...(view.keywords === undefined ? {} : { keywords: view.keywords }),
}));

export const SHELL_COMMANDS: readonly ShellCommandDef[] = [
  {
    id: 'file.create-project',
    label: 'Create project',
    group: 'file',
    icon: FolderOpenIcon,
    keywords: ['new', 'project'],
  },
  {
    id: 'file.import-asset-pack',
    label: 'Import asset pack',
    group: 'file',
    icon: PackageIcon,
    keywords: ['asset', 'import', 'tileset', 'pack'],
  },
  {
    id: 'file.open-sprite-studio',
    label: 'Open Sprite / Animation Studio',
    group: 'file',
    icon: PackageIcon,
    keywords: ['sprite', 'animation', 'sheet', 'slice', 'clip', 'import', 'aseprite'],
  },
  {
    id: 'edit.undo',
    label: 'Undo',
    group: 'edit',
    icon: Undo2Icon,
    shortcut: SHORTCUTS.undo,
    requiresMap: true,
  },
  {
    id: 'edit.redo',
    label: 'Redo',
    group: 'edit',
    icon: Redo2Icon,
    shortcut: SHORTCUTS.redo,
    requiresMap: true,
  },
  ...toolCommands,
  {
    id: 'view.home',
    label: 'Home',
    group: 'view',
    icon: FolderOpenIcon,
    keywords: ['dashboard', 'projects'],
  },
  {
    id: 'view.settings',
    label: 'Settings',
    group: 'view',
    icon: SettingsIcon,
    keywords: ['preferences', 'theme'],
  },
  ...workspaceViewCommands,
  {
    id: 'view.toggle-grid',
    label: 'Toggle grid',
    group: 'view',
    icon: Grid3x3Icon,
    requiresMap: true,
    keywords: ['grid', 'overlay'],
  },
  {
    id: 'view.toggle-collision-overlay',
    label: 'Toggle collision overlay',
    group: 'view',
    icon: LayersIcon,
    requiresMap: true,
    keywords: ['collision', 'overlay'],
  },
  {
    id: 'view.toggle-bottom-drawer',
    label: 'Toggle bottom drawer',
    group: 'view',
    icon: LayersIcon,
    shortcut: SHORTCUTS.toggleBottomDrawer,
    keywords: ['drawer', 'panel', 'jobs', 'logs', 'cmd+j', 'ctrl+j'],
  },
  {
    id: 'map.generate',
    label: 'Generate map',
    group: 'map',
    icon: MapIcon,
    shortcut: SHORTCUTS.generateMap,
    requiresProject: true,
    keywords: ['procedural', 'create'],
  },
  {
    id: 'map.start-build',
    label: 'Start build',
    group: 'map',
    icon: HammerIcon,
    requiresProject: true,
    keywords: ['build', 'compile'],
  },
  {
    id: 'map.start-playtest',
    label: 'Start playtest',
    group: 'map',
    icon: PlayIcon,
    requiresProject: true,
    requiresMap: true,
    keywords: ['play', 'test', 'run'],
  },
  {
    id: 'plugins.install-battle-royale',
    label: 'Install battle-royale plugin',
    group: 'plugins',
    icon: PuzzleIcon,
    keywords: ['plugin', 'install', 'battle royale'],
  },
  {
    id: 'help.command-palette',
    label: 'Open command palette',
    group: 'help',
    icon: HelpCircleIcon,
    shortcut: SHORTCUTS.commandPalette,
    keywords: ['search', 'commands'],
  },
] as const;

export function shellCommandSearchValue(def: ShellCommandDef): string {
  return [def.label, ...(def.keywords ?? [])].join(' ');
}

export function pluginCommandId(pluginId: string, contributionId: string): string {
  return `plugin:${pluginId}:${contributionId}`;
}

export function recentProjectCommandId(projectId: string): string {
  return `recent-project:${projectId}`;
}
