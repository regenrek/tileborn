import { Link } from '@tanstack/react-router';
import type { ProjectId } from '@tileborne/core';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  typography,
} from '@tileborne/ui';

import { ProjectMapPreviewThumb } from '@/components/home/project-map-preview-thumb';
import type { ProjectsListResponse } from '@/lib/bridge-types';

type ProjectSummary = ProjectsListResponse['projects'][number];

interface ProjectCardProps {
  readonly project: ProjectSummary;
  readonly lastOpenedMapId?: string | undefined;
  readonly onOpen?: (() => void) | undefined;
  readonly onSelect?: (() => void) | undefined;
  readonly compact?: boolean | undefined;
}

export function ProjectCard({
  project,
  lastOpenedMapId,
  onOpen,
  onSelect,
  compact = false,
}: ProjectCardProps) {
  const body = (
    <>
      {!compact ? (
        <ProjectMapPreviewThumb projectId={String(project.id)} mapId={lastOpenedMapId} />
      ) : null}
      <CardHeader className={cn(compact ? 'gap-0.5 px-3 py-0' : 'gap-1 px-0 pt-0')}>
        <CardTitle className={compact ? 'text-sm' : undefined}>{project.name}</CardTitle>
        <CardDescription className={typography.bodyCompact}>
          {project.mapCount} maps · {project.assetPackCount} packs · {project.pluginCount} plugins
        </CardDescription>
      </CardHeader>
    </>
  );

  const className = cn(
    'transition-colors hover:bg-muted/40',
    compact ? 'flex-row items-center gap-3 py-3' : 'gap-3 py-3',
  );

  if (onOpen) {
    return (
      <button type="button" className="w-full text-left" onClick={onOpen}>
        <Card className={className}>{body}</Card>
      </button>
    );
  }

  return (
    <Link
      to="/projects/$projectId"
      params={{ projectId: project.id as ProjectId }}
      className="block"
      onClick={onSelect}
    >
      <Card className={className}>{body}</Card>
    </Link>
  );
}
