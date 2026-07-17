import type { ProjectId } from '@tileborne/core';
import {
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  ScrollArea,
  typography,
} from '@tileborne/ui';
import { SearchIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import { ProjectCard } from '@/components/home/project-card';
import type { ProjectsListResponse } from '@/lib/bridge-types';

type ProjectSummary = ProjectsListResponse['projects'][number];

interface OpenProjectDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly projects: readonly ProjectSummary[];
  readonly recentProjectMaps: Readonly<Record<string, string>>;
  readonly onSelectProject: (projectId: ProjectId) => void;
}

export function OpenProjectDialog({
  open,
  onOpenChange,
  projects,
  recentProjectMaps,
  onSelectProject,
}: OpenProjectDialogProps) {
  const [query, setQuery] = useState('');

  const filteredProjects = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (normalized.length === 0) {
      return projects;
    }
    return projects.filter((project) => project.name.toLowerCase().includes(normalized));
  }, [projects, query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Open project</DialogTitle>
          <DialogDescription>
            Choose a project from your Tileborne home directory.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects…"
            className="pl-8"
            aria-label="Search projects"
          />
        </div>
        <ScrollArea className="max-h-80">
          <ul className="space-y-2 pr-3">
            {filteredProjects.map((project) => (
              <li key={project.id}>
                <ProjectCard
                  compact
                  project={project}
                  lastOpenedMapId={recentProjectMaps[String(project.id)]}
                  onOpen={() => onSelectProject(project.id as ProjectId)}
                />
              </li>
            ))}
            {filteredProjects.length === 0 ? (
              <li className={cn(typography.bodyCompact, 'py-8 text-center')}>
                No projects match your search.
              </li>
            ) : null}
          </ul>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
