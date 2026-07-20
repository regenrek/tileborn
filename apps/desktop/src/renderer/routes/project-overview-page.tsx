import { Link, useParams } from '@tanstack/react-router';
import type { ProjectId } from '@tileborne/core';
import { Button, ScrollArea } from '@tileborne/ui';
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleXIcon,
  Gamepad2Icon,
  LayoutTemplateIcon,
  MapIcon,
  Music2Icon,
  PackageIcon,
  PuzzleIcon,
} from 'lucide-react';
import { useEffect, useMemo } from 'react';

import { useMaps, usePluginContributions, useProject, useReadiness } from '@/hooks/queries';
import { resolveProjectActiveGameMode } from '@/lib/active-game-mode-selection';
import { buildCreatorReadinessChecklist } from '@/lib/creator-readiness-checklist';
import { showReadinessProblems } from '@/lib/readiness-gate';
import { useEditorUiStore } from '@/stores/editor-ui-store';

export function ProjectOverviewPage() {
  const { projectId: routeProjectId } = useParams({ from: '/editor/projects/$projectId' });
  const projectId = routeProjectId as ProjectId;
  const projectQuery = useProject(projectId);
  const mapsQuery = useMaps(projectId);
  const readinessQuery = useReadiness(projectId, undefined, 'authoring');
  const contributionsQuery = usePluginContributions();
  const addRecentProject = useEditorUiStore((s) => s.addRecentProject);
  const setCreateMapDialogOpen = useEditorUiStore((s) => s.setCreateMapDialogOpen);
  const setGenerateMapDialogOpen = useEditorUiStore((s) => s.setGenerateMapDialogOpen);
  const setShipGameDialogOpen = useEditorUiStore((s) => s.setShipGameDialogOpen);

  useEffect(() => {
    addRecentProject(projectId);
    document.title = projectQuery.data?.project.name ?? 'Project';
  }, [addRecentProject, projectId, projectQuery.data?.project.name]);

  const project = projectQuery.data?.project;
  const maps = mapsQuery.data?.maps ?? [];
  const activeMode = resolveProjectActiveGameMode(
    contributionsQuery.data?.gameModes ?? [],
    project,
  );
  const checklist = useMemo(
    () =>
      readinessQuery.data === undefined
        ? []
        : buildCreatorReadinessChecklist(
            readinessQuery.data.report,
            activeMode?.creatorChecklistFacts ?? [],
          ),
    [activeMode?.creatorChecklistFacts, readinessQuery.data],
  );

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-8">
        <div>
          <h1 className="text-xl font-semibold">{project?.name ?? 'Project'}</h1>
          <p className="text-sm text-muted-foreground">
            Engine {project?.engineVersion ?? '—'} · {maps.length} maps
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Link
            to="/projects/$projectId/game-content"
            params={{ projectId }}
            className="rounded-lg border border-border bg-card p-4 hover:bg-muted/40"
            data-testid="open-game-content"
          >
            <Gamepad2Icon className="mb-2 size-5" />
            <p className="text-sm font-medium">Gameplay content</p>
            <p className="text-xs text-muted-foreground">Weapons, pickups, items and loot</p>
          </Link>
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
            to="/projects/$projectId/audio"
            params={{ projectId }}
            className="rounded-lg border border-border bg-card p-4 hover:bg-muted/40"
            data-testid="open-audio"
          >
            <Music2Icon className="mb-2 size-5" />
            <p className="text-sm font-medium">Audio</p>
            <p className="text-xs text-muted-foreground">Music, SFX and event bindings</p>
          </Link>
          <Link
            to="/projects/$projectId/game-shell"
            params={{ projectId }}
            className="rounded-lg border border-border bg-card p-4 hover:bg-muted/40"
            data-testid="open-game-shell"
          >
            <LayoutTemplateIcon className="mb-2 size-5" />
            <p className="text-sm font-medium">Game Shell</p>
            <p className="text-xs text-muted-foreground">Menus, screens and actions</p>
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

        <section
          className="rounded-lg border border-border bg-card p-4"
          data-testid="creator-readiness-checklist"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Game creator checklist</h2>
              <p className="text-xs text-muted-foreground">
                Canonical checks for a playable, buildable game.
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={showReadinessProblems}>
              Open problems
            </Button>
          </div>
          {readinessQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">Checking game readiness…</p>
          ) : (
            <ol className="space-y-2">
              {checklist.map((step) => {
                const Icon =
                  step.status === 'complete'
                    ? CheckCircle2Icon
                    : step.status === 'warning'
                      ? AlertTriangleIcon
                      : CircleXIcon;
                return (
                  <li
                    key={step.id}
                    className="flex items-center gap-2 text-sm"
                    data-status={step.status}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    <span className="flex-1">{step.label}</span>
                    {step.diagnostics.length > 0 ? (
                      <span className="text-xs text-muted-foreground">
                        {step.diagnostics.length} issue{step.diagnostics.length === 1 ? '' : 's'}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold">Ready to share your game?</h2>
            <p className="text-xs text-muted-foreground">
              Validate, package, inspect, and launch the authored game.
            </p>
          </div>
          <Button onClick={() => setShipGameDialogOpen(true)} data-testid="overview-ship-game">
            Ship Game
          </Button>
        </section>

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
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setGenerateMapDialogOpen(true)}
                  >
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
