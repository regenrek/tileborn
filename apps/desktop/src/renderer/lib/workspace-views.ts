import type { LucideIcon } from 'lucide-react';
import {
  FolderOpenIcon,
  Gamepad2Icon,
  MapIcon,
  PackageIcon,
  PuzzleIcon,
  SettingsIcon,
  ShapesIcon,
  UserIcon,
  WorkflowIcon,
} from 'lucide-react';

import type { WorkspaceTabKind } from '@/stores/editor-ui-store';

/** Project-scoped routed views. `map` tabs stay bespoke (dynamic mapId/label). */
export type WorkspaceViewKind = Exclude<WorkspaceTabKind, 'map'>;

/** TanStack route paths a workspace view can navigate to. */
export type WorkspaceViewRoute =
  | '/projects/$projectId'
  | '/projects/$projectId/assets'
  | '/projects/$projectId/plugins'
  | '/projects/$projectId/settings'
  | '/projects/$projectId/player-models'
  | '/projects/$projectId/entities'
  | '/projects/$projectId/game-content'
  | '/projects/$projectId/behaviors';

/**
 * Single source of truth for one project-scoped workspace view: identity
 * (tab kind), presentation (label/icon), navigation (route + path pattern),
 * and command-palette metadata. Consumed by the command palette, the
 * workspace tab bar/sync, and the sidebar Tools section — none of which may
 * re-own label, icon, or route for these views.
 */
export interface WorkspaceViewDef {
  readonly kind: WorkspaceViewKind;
  readonly label: string;
  readonly icon: LucideIcon;
  /** TanStack `to` path; all views take a `$projectId` param. */
  readonly route: WorkspaceViewRoute;
  /** Anchored matcher whose first capture group is the projectId. */
  readonly pathPattern: RegExp;
  /**
   * Command-palette command id. Absent for views whose palette command needs
   * bespoke behavior (e.g. settings, which falls back to the global route).
   */
  readonly commandId?: string;
  readonly keywords?: readonly string[];
  /** Listed in the sidebar "Tools" section. */
  readonly tool?: boolean;
}

export const WORKSPACE_VIEWS: readonly WorkspaceViewDef[] = [
  {
    kind: 'overview',
    label: 'Project overview',
    icon: FolderOpenIcon,
    route: '/projects/$projectId',
    pathPattern: /^\/projects\/([^/]+)$/,
    commandId: 'view.project-overview',
    keywords: ['project', 'overview'],
  },
  {
    kind: 'assets',
    label: 'Asset library',
    icon: PackageIcon,
    route: '/projects/$projectId/assets',
    pathPattern: /^\/projects\/([^/]+)\/assets$/,
    commandId: 'view.asset-library',
    keywords: ['assets', 'import'],
  },
  {
    kind: 'plugins',
    label: 'Plugin manager',
    icon: PuzzleIcon,
    route: '/projects/$projectId/plugins',
    pathPattern: /^\/projects\/([^/]+)\/plugins$/,
    commandId: 'view.plugin-manager',
    keywords: ['extensions', 'plugins'],
  },
  {
    kind: 'settings',
    label: 'Settings',
    icon: SettingsIcon,
    route: '/projects/$projectId/settings',
    pathPattern: /^\/projects\/([^/]+)\/settings$/,
    // No commandId: `view.settings` is bespoke (global `/settings` fallback).
  },
  {
    kind: 'entity-editor',
    label: 'Entity Editor',
    icon: ShapesIcon,
    route: '/projects/$projectId/entities',
    pathPattern: /^\/projects\/([^/]+)\/entities$/,
    commandId: 'view.entity-editor',
    keywords: ['entity', 'catalog', 'object', 'component', 'weapon', 'anchor', 'capability'],
    tool: true,
  },
  {
    kind: 'game-content',
    label: 'Gameplay content',
    icon: Gamepad2Icon,
    route: '/projects/$projectId/game-content',
    pathPattern: /^\/projects\/([^/]+)\/game-content$/,
    keywords: ['gameplay', 'content', 'weapons', 'items', 'loot'],
    tool: true,
  },
  {
    kind: 'behaviors',
    label: 'Behavior Editor',
    icon: WorkflowIcon,
    route: '/projects/$projectId/behaviors',
    pathPattern: /^\/projects\/([^/]+)\/behaviors$/,
    commandId: 'view.behavior-editor',
    keywords: ['behavior', 'events', 'when', 'if', 'do', 'logic'],
    tool: true,
  },
  {
    kind: 'player-model-editor',
    label: 'Player Model Editor',
    icon: UserIcon,
    route: '/projects/$projectId/player-models',
    pathPattern: /^\/projects\/([^/]+)\/player-models$/,
    commandId: 'view.player-model-editor',
    keywords: ['player', 'model', 'sprite', 'clips', 'hitbox', 'hand'],
    tool: true,
  },
] as const;

const byKind = new Map(WORKSPACE_VIEWS.map((view) => [view.kind, view]));
const byCommandId = new Map(
  WORKSPACE_VIEWS.filter((view) => view.commandId !== undefined).map((view) => [
    view.commandId!,
    view,
  ]),
);

export const workspaceViewForKind = (kind: WorkspaceViewKind): WorkspaceViewDef => {
  const view = byKind.get(kind);
  if (view === undefined) {
    throw new Error(`unregistered workspace view kind: ${kind}`);
  }
  return view;
};

export const workspaceViewForCommand = (commandId: string): WorkspaceViewDef | undefined =>
  byCommandId.get(commandId);

/** Views surfaced in the sidebar "Tools" section, in declaration order. */
export const WORKSPACE_TOOL_VIEWS: readonly WorkspaceViewDef[] = WORKSPACE_VIEWS.filter(
  (view) => view.tool === true,
);

/** Icon for the `map` tab kind, exported so the tab bar shares the identity. */
export const MAP_TAB_ICON: LucideIcon = MapIcon;
