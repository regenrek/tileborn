import { Link, useParams } from '@tanstack/react-router';
import type { ProjectId } from '@tileborne/core';
import { Button, ScrollArea } from '@tileborne/ui';
import { MapIcon, PackageIcon, PuzzleIcon } from 'lucide-react';
import { useEffect } from 'react';

import { useMaps, useProject } from '@/hooks/queries';
import { useEditorUiStore } from '@/stores/editor-ui-store';

export function ProjectOverviewPage() {
  const { projectId: routeProjectId } = useParams({ from: '/editor/projects/$projectId' });
  const projectId = routeProjectId as ProjectId;
  const projectQuery = useProject(projectId);
  const mapsQuery = useMaps(projectId);
  const addRecentProject = useEditorUiStore((s) => s.addRecentProject);
  const setCreateMapDialogOpen = useEditorUiStore((s) => s.setCreateMapDialogOpen);
  const setGenerateMapDialogOpen = useEditorUiStore((s) => s.setGenerateMapDialogOpen);

  useEffect(() => {
    addRecentProject(projectId);
    document.title = projectQuery.data?.project.name ?? 'Project';
  }, [addRecentProject, projectId, projectQuery.data?.project.name]);

  const project = projectQuery.data?.project;
  const maps = mapsQuery.data?.maps ?? [];

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-8">
        <div>
          <h1 className="text-xl font-semibold">{project?.name ?? 'Project'}</h1>
          <p className="text-sm text-muted-foreground">
            Engine {project?.engineVersion ?? '—'} · {maps.length} maps
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Link
            to="/projects/$projectId/assets"
            params={{ projectId }}
            className="rounded-lg border border-border bg-card p-4 hover:bg-muted/40"
          >
            <PackageIcon className="mb-2 size-5" />
            <p className="text-sm font-medium">Asset library</p>
            <p className="text-xs text-muted-foreground">Browse and import packs</p>
          </Link>
          <Link
            to="/projects/$projectId/plugins"
            params={{ projectId }}
            className="rounded-lg border border-border bg-card p-4 hover:bg-muted/40"
          >
            <PuzzleIcon className="mb-2 size-5" />
            <p className="text-sm font-medium">Plugin manager</p>
            <p className="text-xs text-muted-foreground">Install and enable plugins</p>
          </Link>
          <div className="rounded-lg border border-border bg-card p-4">
            <MapIcon className="mb-2 size-5" />
            <p className="text-sm font-medium">Maps</p>
            <p className="text-xs text-muted-foreground">{maps.length} in project</p>
          </div>
        </div>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
              Maps
            </h2>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setGenerateMapDialogOpen(true)}>
                Generate map
              </Button>
              <Button size="sm" onClick={() => setCreateMapDialogOpen(true)}>
                Create map
              </Button>
            </div>
          </div>
          <ul className="space-y-2">
            {maps.map((map) => (
              <li key={map.id}>
                <Link
                  to="/projects/$projectId/maps/$mapId"
                  params={{ projectId, mapId: map.id }}
                  className="block rounded-lg border border-border px-4 py-3 text-sm hover:bg-muted/50"
                >
                  {map.id} · {map.width}×{map.height} · {map.objectCount} objects
                </Link>
              </li>
            ))}
            {maps.length === 0 ? (
              <li className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
                <p className="text-sm text-muted-foreground">No maps yet</p>
                <div className="mt-3 flex justify-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setGenerateMapDialogOpen(true)}>
                    Generate map
                  </Button>
                  <Button size="sm" onClick={() => setCreateMapDialogOpen(true)}>
                    Create map
                  </Button>
                </div>
              </li>
            ) : null}
          </ul>
        </section>
      </div>
    </ScrollArea>
  );
}
