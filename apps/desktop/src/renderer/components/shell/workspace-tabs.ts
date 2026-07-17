import { normalizeRouteParam } from '@/lib/route-params';
import { WORKSPACE_VIEWS, workspaceViewForKind } from '@/lib/workspace-views';
import type { WorkspaceTab, WorkspaceTabKind } from '@/stores/editor-ui-store';
import { workspaceTabId } from '@/stores/editor-ui-store';

export interface WorkspaceTabDescriptor {
  readonly kind: WorkspaceTabKind;
  readonly projectId?: string;
  readonly mapId?: string;
}

const MAP_PATH = /^\/projects\/([^/]+)\/maps\/([^/]+)$/;

/**
 * Derive a tab descriptor from a route pathname, or null if the route is not
 * tab-worthy. `map` is matched bespoke (two params); every other tab-worthy
 * route comes from the workspace-view SSOT (`workspace-views.ts`).
 */
export function describeTabForPath(pathname: string): WorkspaceTabDescriptor | null {
  const mapMatch = MAP_PATH.exec(pathname);
  const mapProjectId = mapMatch?.[1] === undefined ? undefined : normalizeRouteParam(mapMatch[1]);
  const mapId = mapMatch?.[2] === undefined ? undefined : normalizeRouteParam(mapMatch[2]);
  if (mapProjectId !== undefined && mapId !== undefined) {
    return { kind: 'map', projectId: mapProjectId, mapId };
  }
  for (const view of WORKSPACE_VIEWS) {
    const match = view.pathPattern.exec(pathname);
    const projectId = match?.[1] === undefined ? undefined : normalizeRouteParam(match[1]);
    if (projectId !== undefined) {
      return { kind: view.kind, projectId };
    }
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
  if (tab.kind === 'map') {
    return tab.mapId ?? 'Map';
  }
  return workspaceViewForKind(tab.kind).label;
}
