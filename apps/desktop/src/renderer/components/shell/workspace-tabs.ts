import type { WorkspaceTab, WorkspaceTabKind } from '@/stores/editor-ui-store';
import { workspaceTabId } from '@/stores/editor-ui-store';
import { normalizeRouteParam } from '@/lib/route-params';

export interface WorkspaceTabDescriptor {
  readonly kind: WorkspaceTabKind;
  readonly projectId?: string;
  readonly mapId?: string;
}

const MAP_PATH = /^\/projects\/([^/]+)\/maps\/([^/]+)$/;
const ASSETS_PATH = /^\/projects\/([^/]+)\/assets$/;
const PLUGINS_PATH = /^\/projects\/([^/]+)\/plugins$/;
const PROJECT_SETTINGS_PATH = /^\/projects\/([^/]+)\/settings$/;
const OVERVIEW_PATH = /^\/projects\/([^/]+)$/;

/** Derive a tab descriptor from a route pathname, or null if the route is not tab-worthy. */
export function describeTabForPath(pathname: string): WorkspaceTabDescriptor | null {
  const mapMatch = MAP_PATH.exec(pathname);
  const mapProjectId = mapMatch?.[1] === undefined ? undefined : normalizeRouteParam(mapMatch[1]);
  const mapId = mapMatch?.[2] === undefined ? undefined : normalizeRouteParam(mapMatch[2]);
  if (mapProjectId !== undefined && mapId !== undefined) {
    return { kind: 'map', projectId: mapProjectId, mapId };
  }
  const assetsMatch = ASSETS_PATH.exec(pathname);
  const assetsProjectId =
    assetsMatch?.[1] === undefined ? undefined : normalizeRouteParam(assetsMatch[1]);
  if (assetsProjectId !== undefined) {
    return { kind: 'assets', projectId: assetsProjectId };
  }
  const pluginsMatch = PLUGINS_PATH.exec(pathname);
  const pluginsProjectId =
    pluginsMatch?.[1] === undefined ? undefined : normalizeRouteParam(pluginsMatch[1]);
  if (pluginsProjectId !== undefined) {
    return { kind: 'plugins', projectId: pluginsProjectId };
  }
  const projectSettingsMatch = PROJECT_SETTINGS_PATH.exec(pathname);
  const settingsProjectId =
    projectSettingsMatch?.[1] === undefined
      ? undefined
      : normalizeRouteParam(projectSettingsMatch[1]);
  if (settingsProjectId !== undefined) {
    return { kind: 'settings', projectId: settingsProjectId };
  }
  const overviewMatch = OVERVIEW_PATH.exec(pathname);
  const overviewProjectId =
    overviewMatch?.[1] === undefined ? undefined : normalizeRouteParam(overviewMatch[1]);
  if (overviewProjectId !== undefined) {
    return { kind: 'overview', projectId: overviewProjectId };
  }
  if (pathname === '/settings') {
    return { kind: 'settings' };
  }
  return null;
}

export function tabFromDescriptor(descriptor: WorkspaceTabDescriptor): WorkspaceTab {
  return {
    id: workspaceTabId(descriptor),
    kind: descriptor.kind,
    ...(descriptor.projectId === undefined ? {} : { projectId: descriptor.projectId }),
    ...(descriptor.mapId === undefined ? {} : { mapId: descriptor.mapId }),
  };
}

export function isTabActive(tab: WorkspaceTab, descriptor: WorkspaceTabDescriptor | null): boolean {
  if (descriptor === null) return false;
  return tab.id === workspaceTabId(descriptor);
}

/** Default human label fallback when no live data (project/map name) is available. */
export function defaultTabLabel(tab: WorkspaceTab): string {
  switch (tab.kind) {
    case 'map':
      return tab.mapId ?? 'Map';
    case 'overview':
      return 'Project';
    case 'assets':
      return 'Asset library';
    case 'plugins':
      return 'Plugin manager';
    case 'settings':
      return 'Settings';
  }
}
