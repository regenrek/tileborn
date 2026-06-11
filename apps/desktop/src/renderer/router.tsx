import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  useParams,
} from '@tanstack/react-router';
import { useEffect } from 'react';

import { CommandPalette } from '@/components/shell/command-palette';
import { AppShell } from '@/components/shell/app-shell';
import { ThemeProvider } from '@/components/theme-provider';
import { useEventInvalidations } from '@/hooks/use-event-invalidations';
import { normalizeRouteParam } from '@/lib/route-params';
import { AssetLibraryPage } from '@/routes/asset-library-page';
import { EntityEditorPage } from '@/routes/entity-editor-page';
import { HomePage } from '@/routes/home-page';
import { MapEditorPage } from '@/routes/map-editor-page';
import { PlayerModelEditorPage } from '@/routes/player-model-editor-page';
import { PluginManagerPage } from '@/routes/plugin-manager-page';
import { ProjectOverviewPage } from '@/routes/project-overview-page';
import { SettingsPage } from '@/routes/settings-page';
import { useEditorUiStore } from '@/stores/editor-ui-store';

function GlobalCommandPalette() {
  const { projectId, mapId } = useParams({ strict: false });
  const commandPaletteOpen = useEditorUiStore((s) => s.commandPaletteOpen);
  const setCommandPaletteOpen = useEditorUiStore((s) => s.setCommandPaletteOpen);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setCommandPaletteOpen]);

  return (
    <CommandPalette
      open={commandPaletteOpen}
      onOpenChange={setCommandPaletteOpen}
      projectId={projectId}
      mapId={mapId}
    />
  );
}

function RootProviders() {
  useEventInvalidations();
  return (
    <ThemeProvider>
      <div className="h-full min-h-0 overflow-hidden">
        <Outlet />
      </div>
      <GlobalCommandPalette />
    </ThemeProvider>
  );
}

const rootRoute = createRootRoute({
  component: RootProviders,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
});

const editorRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'editor',
  component: AppShell,
});

const projectParams = {
  parse: (raw: { readonly projectId: string }) => ({
    projectId: normalizeRouteParam(raw.projectId),
  }),
  stringify: (parsed: { readonly projectId: string }) => ({
    projectId: normalizeRouteParam(parsed.projectId),
  }),
};

const projectMapParams = {
  parse: (raw: { readonly projectId: string; readonly mapId: string }) => ({
    projectId: normalizeRouteParam(raw.projectId),
    mapId: normalizeRouteParam(raw.mapId),
  }),
  stringify: (parsed: { readonly projectId: string; readonly mapId: string }) => ({
    projectId: normalizeRouteParam(parsed.projectId),
    mapId: normalizeRouteParam(parsed.mapId),
  }),
};

const projectOverviewRoute = createRoute({
  getParentRoute: () => editorRoute,
  path: '/projects/$projectId',
  params: projectParams,
  component: ProjectOverviewPage,
});

const mapEditorRoute = createRoute({
  getParentRoute: () => editorRoute,
  path: '/projects/$projectId/maps/$mapId',
  params: projectMapParams,
  component: MapEditorPage,
});

const assetLibraryRoute = createRoute({
  getParentRoute: () => editorRoute,
  path: '/projects/$projectId/assets',
  params: projectParams,
  component: AssetLibraryPage,
});

const pluginManagerRoute = createRoute({
  getParentRoute: () => editorRoute,
  path: '/projects/$projectId/plugins',
  params: projectParams,
  component: PluginManagerPage,
});

const playerModelEditorRoute = createRoute({
  getParentRoute: () => editorRoute,
  path: '/projects/$projectId/player-models',
  params: projectParams,
  component: PlayerModelEditorPage,
});

const entityEditorRoute = createRoute({
  getParentRoute: () => editorRoute,
  path: '/projects/$projectId/entities',
  params: projectParams,
  component: EntityEditorPage,
});

const projectSettingsRoute = createRoute({
  getParentRoute: () => editorRoute,
  path: '/projects/$projectId/settings',
  params: projectParams,
  component: SettingsPage,
});

/** Redirect bare /projects/:id/maps to project overview until a map is chosen. */
const mapsIndexRoute = createRoute({
  getParentRoute: () => editorRoute,
  path: '/projects/$projectId/maps',
  params: projectParams,
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/projects/$projectId',
      params: { projectId: params.projectId },
    });
  },
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  settingsRoute,
  editorRoute.addChildren([
    projectOverviewRoute,
    mapEditorRoute,
    assetLibraryRoute,
    pluginManagerRoute,
    playerModelEditorRoute,
    entityEditorRoute,
    projectSettingsRoute,
    mapsIndexRoute,
  ]),
]);

/** file:// loads (packaged Electron) need hash history; http dev server uses the default. */
const history =
  typeof window !== 'undefined' && window.location.protocol === 'file:'
    ? createHashHistory()
    : undefined;

export const router = createRouter({
  routeTree,
  pathParamsAllowedCharacters: [':'],
  ...(history === undefined ? {} : { history }),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
