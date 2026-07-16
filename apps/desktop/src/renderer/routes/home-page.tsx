import { Link, useNavigate } from '@tanstack/react-router';
import type { ProjectId } from '@tileborne/core';
import {
  Button,
  Card,
  CardHeader,
  ScrollArea,
  Separator,
  Skeleton,
  cn,
  typography,
} from '@tileborne/ui';
import {
  FolderOpenIcon,
  ImportIcon,
  LayoutGridIcon,
  PlusIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { CreateProjectDialog } from '@/components/create-project-dialog';
import { HomeEmptyState } from '@/components/home/home-empty-state';
import { OpenProjectDialog } from '@/components/home/open-project-dialog';
import { ProjectCard } from '@/components/home/project-card';
import { useImportProjectFromDirectory } from '@/hooks/mutations';
import { notifyError, notifySuccess } from '@/stores/app-notifications-store';
import { useProjectsList } from '@/hooks/queries';
import { useEditorUiStore } from '@/stores/editor-ui-store';

function HomeLoadingSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading projects">
      {Array.from({ length: 3 }, (_, cardNumber) => `home-skeleton-card-${cardNumber}`).map((cardKey) => (
        <Card key={cardKey} className="gap-3 py-3">
          <CardHeader className="gap-2 px-3 pt-0">
            <Skeleton className="aspect-video w-full rounded-md" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}

export function HomePage() {
  const navigate = useNavigate();
  const projectsQuery = useProjectsList();
  const importProject = useImportProjectFromDirectory();
  const recentProjectIds = useEditorUiStore((s) => s.recentProjectIds);
  const recentProjectMaps = useEditorUiStore((s) => s.recentProjectMaps);
  const addRecentProject = useEditorUiStore((s) => s.addRecentProject);
  const createProjectDialogOpen = useEditorUiStore((s) => s.createProjectDialogOpen);
  const setCreateProjectDialogOpen = useEditorUiStore((s) => s.setCreateProjectDialogOpen);
  const [openProjectDialogOpen, setOpenProjectDialogOpen] = useState(false);

  const projects = projectsQuery.data?.projects ?? [];
  const recentProjects = useMemo(() => {
    const projectsById = new Map(projects.map((project) => [String(project.id), project]));
    const matchedProjects: Array<(typeof projects)[number]> = [];
    for (const id of recentProjectIds) {
      const project = projectsById.get(id);
      if (project) {
        matchedProjects.push(project);
      }
    }
    return matchedProjects;
  }, [projects, recentProjectIds]);

  useEffect(() => {
    document.title = 'Tileborne';
  }, []);

  const handleImport = async () => {
    try {
      const result = await importProject.mutateAsync();
      addRecentProject(String(result.projectId));
      notifySuccess('Project imported.');
      void navigate({
        to: '/projects/$projectId',
        params: { projectId: result.projectId },
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'Import cancelled') {
        return;
      }
      notifyError(error instanceof Error ? error.message : String(error));
    }
  };

  const openProject = (projectId: ProjectId) => {
    addRecentProject(String(projectId));
    setOpenProjectDialogOpen(false);
    void navigate({
      to: '/projects/$projectId',
      params: { projectId },
    });
  };

  const hero = (
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/35 via-accent/20 to-muted shadow-xs">
        <LayoutGridIcon className="size-7 text-primary" aria-hidden />
      </div>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tileborne</h1>
        <p className={cn(typography.bodyCompact, 'mt-1 max-w-lg')}>
          Author tile maps, import asset packs, and ship playable builds from one desktop studio.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button size="lg" onClick={() => setCreateProjectDialogOpen(true)}>
          <PlusIcon />
          New game
        </Button>
        <Button
          variant="outline"
          size="lg"
          disabled={projects.length === 0}
          onClick={() => setOpenProjectDialogOpen(true)}
        >
          <FolderOpenIcon />
          Open project
        </Button>
        <Button
          variant="outline"
          size="lg"
          disabled={importProject.isPending}
          onClick={() => void handleImport()}
        >
          <ImportIcon />
          Import project
        </Button>
      </div>
    </div>
  );

  if (projectsQuery.isLoading) {
    return (
      <>
        <ScrollArea className="h-full">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 p-8">
            {hero}
            <HomeLoadingSkeleton />
          </div>
        </ScrollArea>
        <CreateProjectDialog
          open={createProjectDialogOpen}
          onOpenChange={setCreateProjectDialogOpen}
        />
      </>
    );
  }

  if (projects.length === 0) {
    return (
      <>
        <ScrollArea className="h-full">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-8">
            {hero}
            <HomeEmptyState
              createPending={false}
              importPending={importProject.isPending}
              onCreate={() => setCreateProjectDialogOpen(true)}
              onImport={() => void handleImport()}
            />
          </div>
        </ScrollArea>
        <CreateProjectDialog
          open={createProjectDialogOpen}
          onOpenChange={setCreateProjectDialogOpen}
        />
      </>
    );
  }

  return (
    <>
      <ScrollArea className="h-full">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 p-8">
          {hero}

          {recentProjects.length > 0 ? (
            <section>
              <h2 className={typography.sectionLabel}>Recent projects</h2>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {recentProjects.map((project) => (
                  <li key={project.id}>
                    <ProjectCard
                      project={project}
                      lastOpenedMapId={recentProjectMaps[String(project.id)]}
                      onSelect={() => addRecentProject(String(project.id))}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <Separator />

          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className={typography.sectionLabel}>All projects</h2>
              <Link
                to="/settings"
                className={cn(typography.caption, 'text-primary hover:underline')}
              >
                Settings
              </Link>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => (
                <li key={project.id}>
                  <ProjectCard
                    project={project}
                    lastOpenedMapId={recentProjectMaps[String(project.id)]}
                    onSelect={() => addRecentProject(String(project.id))}
                  />
                </li>
              ))}
            </ul>
          </section>
        </div>
      </ScrollArea>

      <OpenProjectDialog
        open={openProjectDialogOpen}
        onOpenChange={setOpenProjectDialogOpen}
        projects={projects}
        recentProjectMaps={recentProjectMaps}
        onSelectProject={openProject}
      />
      <CreateProjectDialog
        open={createProjectDialogOpen}
        onOpenChange={setCreateProjectDialogOpen}
      />
    </>
  );
}
