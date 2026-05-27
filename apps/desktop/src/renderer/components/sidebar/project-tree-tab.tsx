import { Link, useParams } from '@tanstack/react-router';
import {
  Badge,
  Button,
  Kbd,
  ScrollArea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
  typography,
} from '@tileborne/ui';
import { FolderTreeIcon, MapIcon, PlusIcon, SettingsIcon } from 'lucide-react';

import { SidebarPluginContributions } from '@/components/sidebar/plugin-contribution-zone';
import { SidebarEmptyState } from '@/components/sidebar/sidebar-empty-state';
import { SidebarListSkeleton } from '@/components/sidebar/sidebar-list-skeleton';
import { useMaps, useProject } from '@/hooks/queries';
import { useEditorUiStore } from '@/stores/editor-ui-store';

interface ProjectTreeTabProps {
  readonly projectId: string | undefined;
}

export function ProjectTreeTab({ projectId }: ProjectTreeTabProps) {
  const { mapId } = useParams({ strict: false });
  const projectQuery = useProject(projectId);
  const mapsQuery = useMaps(projectId);
  const setGenerateMapDialogOpen = useEditorUiStore((s) => s.setGenerateMapDialogOpen);
  const setCreateMapDialogOpen = useEditorUiStore((s) => s.setCreateMapDialogOpen);
  const recentProjectMaps = useEditorUiStore((s) => s.recentProjectMaps);

  const maps = mapsQuery.data?.maps ?? [];
  const isLoading = projectQuery.isLoading || mapsQuery.isLoading;
  const currentMap = maps.find((map) => map.id === mapId);
  const recentMapId = projectId === undefined ? undefined : recentProjectMaps[projectId];

  if (projectId === undefined) {
    return (
      <ScrollArea className="h-full min-h-0">
        <div className="px-2 py-2">
          <SidebarEmptyState
            icon={FolderTreeIcon}
            title="No project open"
            description="Open a project to organize maps, settings, and the current map structure."
          />
        </div>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className="h-full min-h-0">
      <div className="space-y-3 py-2">
        {isLoading ? (
          <SidebarListSkeleton rows={5} />
        ) : (
          <>
            <div
              className="flex flex-col gap-2 rounded-md border border-border bg-card p-2"
              data-testid="project-sidebar-summary"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className={cn('truncate', typography.caption, 'font-medium text-foreground')}>
                    {projectQuery.data?.project.name ?? 'Project'}
                  </p>
                  <p className={cn('break-all', typography.rowMeta)}>{projectId}</p>
                </div>
                <Badge
                  variant="secondary"
                  className={cn('px-1.5 py-0 font-normal', typography.rowMeta)}
                >
                  {maps.length} map{maps.length === 1 ? '' : 's'}
                </Badge>
              </div>
              <div className="flex flex-col gap-1">
                <p className={typography.sectionLabelMicro}>Current map</p>
                <p className={typography.bodyCompact}>
                  {currentMap
                    ? `${currentMap.id} · ${currentMap.width}×${currentMap.height}`
                    : 'No map selected'}
                </p>
                {recentMapId !== undefined && recentMapId !== currentMap?.id ? (
                  <p className={typography.rowMeta}>Recent map: {recentMapId}</p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  to="/projects/$projectId"
                  params={{ projectId }}
                  className={cn(
                    'inline-flex items-center',
                    typography.caption,
                    'text-primary hover:underline',
                  )}
                >
                  Overview
                </Link>
                <Link
                  to="/projects/$projectId/settings"
                  params={{ projectId }}
                  className={cn(
                    'inline-flex items-center gap-1',
                    typography.caption,
                    'text-primary hover:underline',
                  )}
                >
                  <SettingsIcon className="size-3" aria-hidden />
                  Settings
                </Link>
              </div>
            </div>

            <SidebarPluginContributions zone="project" title="Plugin project panels" />

            <div className="space-y-1" data-testid="sidebar-map-list">
              <div className="flex items-center justify-between gap-2 px-1">
                <p className={typography.panelTitle}>Maps and scenes</p>
              </div>
              {maps.map((map) => (
                <Link
                  key={map.id}
                  to="/projects/$projectId/maps/$mapId"
                  params={{ projectId: projectId!, mapId: map.id }}
                  className="block truncate rounded-md px-2 py-1.5 text-caption text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {map.id} ({map.width}×{map.height})
                </Link>
              ))}
            </div>

            {maps.length === 0 ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <SidebarEmptyState
                      icon={MapIcon}
                      title="No maps yet"
                      description="Generate a procedural map or create an empty one."
                      actionLabel="Generate map"
                      actionDisabled={!projectId}
                      onAction={() => setGenerateMapDialogOpen(true)}
                      secondaryAction={
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!projectId}
                          data-testid="sidebar-create-map"
                          onClick={() => setCreateMapDialogOpen(true)}
                        >
                          <PlusIcon />
                          Create map
                        </Button>
                      }
                    />
                  }
                />
                <TooltipContent>
                  <span className="flex items-center gap-2">
                    Generate map
                    <Kbd variant="ghost">⌘G</Kbd>
                  </span>
                </TooltipContent>
              </Tooltip>
            ) : (
              <div className="flex flex-wrap gap-2 px-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!projectId}
                  data-testid="sidebar-create-map"
                  onClick={() => setCreateMapDialogOpen(true)}
                >
                  <PlusIcon />
                  Create map
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!projectId}
                  onClick={() => setGenerateMapDialogOpen(true)}
                >
                  Generate map
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </ScrollArea>
  );
}

export function ProjectTreeTabCollapsedHint({ onClick }: { readonly onClick?: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="Project tree" onClick={onClick}>
            <FolderTreeIcon className="size-4 text-muted-foreground" aria-hidden />
          </Button>
        }
      />
      <TooltipContent side="right">Project maps</TooltipContent>
    </Tooltip>
  );
}
