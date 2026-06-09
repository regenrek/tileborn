import { Link, useNavigate } from '@tanstack/react-router';
import type { ProjectId } from '@tileborne/core';
import type { ReactElement } from 'react';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Separator,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
  statusSurface,
  typography,
} from '@tileborne/ui';
import {
  ArchiveIcon,
  ChevronDownIcon,
  CommandIcon,
  FolderInputIcon,
  HammerIcon,
  HomeIcon,
  MapIcon,
  MenuIcon,
  PlayIcon,
  RocketIcon,
  SettingsIcon,
  SquareIcon,
  UsersIcon,
} from 'lucide-react';

import { PlaytestHostDialog, PlaytestJoinDialog } from '@/components/playtest-multiplayer-dialogs';
import {
  useExportProjectArchive,
  useImportProjectFromDirectory,
  useStartBuild,
} from '@/hooks/mutations';
import { notifyError, notifyInfo, notifySuccess } from '@/stores/app-notifications-store';
import { useMap, useProject } from '@/hooks/queries';
import { usePlaytestControls } from '@/hooks/use-playtest-controls';
import { useVisualModelDiagnostics } from '@/hooks/use-visual-model-diagnostics';
import { useEditorUiStore } from '@/stores/editor-ui-store';
import { usePlaytestMultiplayerStore } from '@/stores/playtest-multiplayer-store';

interface TopBarProps {
  projectId?: string | undefined;
  mapId?: string | undefined;
}

function TruncatedLabelTooltip({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function AppMenu({
  importPending,
  onHome,
  onSettings,
  onImportProject,
}: {
  readonly importPending: boolean;
  readonly onHome: () => void;
  readonly onSettings: () => void;
  readonly onImportProject: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="Application menu">
            <MenuIcon />
          </Button>
        }
      />
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={onHome}>
            <HomeIcon />
            Home
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onSettings}>
            <SettingsIcon />
            Settings
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem disabled={importPending} onClick={onImportProject}>
            <FolderInputIcon />
            Import project…
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProjectBreadcrumbs({
  projectId,
  projectName,
}: {
  readonly projectId: string | undefined;
  readonly projectName: string;
}) {
  return (
    <Breadcrumb className="min-w-0 flex-1 overflow-hidden">
      <BreadcrumbList className="flex-nowrap gap-1 sm:gap-1.5">
        <BreadcrumbItem className="max-w-[min(20rem,80%)]">
          {projectId ? (
            <TruncatedLabelTooltip label={projectName}>
              <BreadcrumbLink
                render={
                  <Link
                    to="/projects/$projectId"
                    params={{ projectId }}
                    className="block min-w-0 max-w-full"
                  />
                }
              >
                {projectName}
              </BreadcrumbLink>
            </TruncatedLabelTooltip>
          ) : (
            <BreadcrumbPage className="text-muted-foreground">{projectName}</BreadcrumbPage>
          )}
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function HostingStatus({
  roomId,
  onStopHosting,
}: {
  readonly roomId: string | undefined;
  readonly onStopHosting: () => void;
}) {
  return (
    <div className="hidden items-center gap-1 sm:flex">
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5',
          typography.bodyMicro,
          statusSurface.success,
        )}
        data-testid="playtest-local-host-pill"
      >
        <UsersIcon className="size-3" />
        Hosting {roomId ?? 'local match'}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={onStopHosting}
        data-testid="playtest-stop-hosting"
      >
        <SquareIcon />
        Stop hosting
      </Button>
    </div>
  );
}

function PlaytestMenu({
  mapId,
  projectId,
  isStartingPlaytest,
  flowPhase,
  onSinglePlayer,
  onHost,
  onJoin,
}: {
  readonly mapId: string | undefined;
  readonly projectId: string | undefined;
  readonly isStartingPlaytest: boolean;
  readonly flowPhase: string;
  readonly onSinglePlayer: () => void;
  readonly onHost: () => void;
  readonly onJoin: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            disabled={!mapId || !projectId || isStartingPlaytest}
            aria-label="Playtest menu"
            data-testid="playtest-menu-trigger"
          >
            <PlayIcon />
            <span className="hidden md:inline">Playtest</span>
            <ChevronDownIcon className="hidden size-3 opacity-70 md:inline" />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={!mapId || !projectId || isStartingPlaytest}
            onClick={onSinglePlayer}
            data-testid="playtest-menu-single"
          >
            <PlayIcon />
            Single (local-only)
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!mapId || !projectId || flowPhase === 'starting-host'}
            onClick={onHost}
            data-testid="playtest-menu-host"
          >
            <UsersIcon />
            Host (multiplayer local)
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!mapId || !projectId}
            onClick={onJoin}
            data-testid="playtest-menu-join"
          >
            <UsersIcon />
            Join (multiplayer local)
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BuildMenu({
  projectId,
  buildPending,
  exportPending,
  onStartBuild,
  onExport,
}: {
  readonly projectId: string | undefined;
  readonly buildPending: boolean;
  readonly exportPending: boolean;
  readonly onStartBuild: () => void;
  readonly onExport: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="default" size="sm" disabled={!projectId} aria-label="Build">
            <RocketIcon />
            <span className="hidden md:inline">Build</span>
            <ChevronDownIcon className="hidden size-3 opacity-70 md:inline" />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem disabled={!projectId || buildPending} onClick={onStartBuild}>
            <HammerIcon />
            Start build
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!projectId || exportPending} onClick={onExport}>
            <ArchiveIcon />
            Export project…
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TopBar({ projectId, mapId }: TopBarProps) {
  const navigate = useNavigate();
  const setCommandPaletteOpen = useEditorUiStore((s) => s.setCommandPaletteOpen);
  const setGenerateMapDialogOpen = useEditorUiStore((s) => s.setGenerateMapDialogOpen);
  const localHostSession = useEditorUiStore((s) => s.localHostSession);
  const hostModalOpen = useEditorUiStore((s) => s.playtestHostModalOpen);
  const joinModalOpen = useEditorUiStore((s) => s.playtestJoinModalOpen);
  const setPlaytestHostModalOpen = useEditorUiStore((s) => s.setPlaytestHostModalOpen);
  const setPlaytestJoinModalOpen = useEditorUiStore((s) => s.setPlaytestJoinModalOpen);
  const projectQuery = useProject(projectId);
  const mapQuery = useMap(projectId, mapId);
  const startBuild = useStartBuild();
  const importProject = useImportProjectFromDirectory();
  const exportProject = useExportProjectArchive();
  const { start: startPlaytest, isStarting: isStartingPlaytest } = usePlaytestControls();
  const visualModelDiagnostics = useVisualModelDiagnostics(projectId, mapId);
  const hostLocalMatch = usePlaytestMultiplayerStore((state) => state.hostLocalMatch);
  const joinFromInput = usePlaytestMultiplayerStore((state) => state.joinFromInput);
  const joinHostAsPlayer = usePlaytestMultiplayerStore((state) => state.joinHostAsPlayer);
  const openSecondClient = usePlaytestMultiplayerStore((state) => state.openSecondClient);
  const stopHosting = usePlaytestMultiplayerStore((state) => state.stopHosting);
  const copyText = usePlaytestMultiplayerStore((state) => state.copyText);
  const roomReady = usePlaytestMultiplayerStore((state) => state.roomReady);
  const flowPhase = usePlaytestMultiplayerStore((state) => state.flowPhase);

  const projectName = projectQuery.data?.project.name ?? 'No project';
  const mapWidth = mapQuery.data?.map.size.width ?? 64;
  const mapHeight = mapQuery.data?.map.size.height ?? 64;
  const isHosting = localHostSession !== null;
  const openSettings = () => {
    if (projectId) {
      void navigate({ to: '/projects/$projectId/settings', params: { projectId } });
      return;
    }
    void navigate({ to: '/settings' });
  };
  const importCurrentProject = () => {
    void importProject.mutateAsync().then(
      (result) => {
        notifySuccess('Project imported.');
        void navigate({
          to: '/projects/$projectId',
          params: { projectId: result.projectId },
        });
      },
      (error) => {
        if (error instanceof Error && error.message === 'Import cancelled') {
          return;
        }
        notifyError(error instanceof Error ? error.message : String(error));
      },
    );
  };
  const exportCurrentProject = () => {
    if (!projectId) {
      return;
    }
    void exportProject.mutateAsync({ projectId: projectId as ProjectId }).then(
      (result) => {
        notifySuccess(`Exported to ${result.archivePath}`);
      },
      (error) => {
        if (error instanceof Error && error.message === 'Export cancelled') {
          return;
        }
        notifyError(error instanceof Error ? error.message : String(error));
      },
    );
  };
  const canStartPlaytest = (): boolean => {
    const blockingDiagnostics = visualModelDiagnostics.filter(
      (diagnostic) => diagnostic.severity === 'error',
    );
    if (blockingDiagnostics.length > 0) {
      notifyError(
        `Fix ${blockingDiagnostics.length} visual/model issue${blockingDiagnostics.length === 1 ? '' : 's'} before playtest.`,
      );
      return false;
    }
    const warnings = visualModelDiagnostics.filter(
      (diagnostic) => diagnostic.severity === 'warning',
    );
    if (warnings.length > 0) {
      notifyInfo(
        `Playtest has ${warnings.length} visual/model warning${warnings.length === 1 ? '' : 's'}.`,
      );
    }
    return true;
  };

  return (
    <TooltipProvider>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-sidebar px-3 shadow-sm sm:gap-2.5 sm:px-4">
        <AppMenu
          importPending={importProject.isPending}
          onHome={() => void navigate({ to: '/' })}
          onSettings={openSettings}
          onImportProject={importCurrentProject}
        />

        <Separator orientation="vertical" className="mx-0.5 hidden h-5 sm:mx-1 sm:block" />

        <ProjectBreadcrumbs projectId={projectId} projectName={projectName} />

        <div className="flex shrink-0 items-center gap-1">
          {isHosting ? (
            <HostingStatus
              roomId={localHostSession.roomId}
              onStopHosting={() => void stopHosting()}
            />
          ) : null}

          <Button
            variant="outline"
            size="sm"
            disabled={!projectId}
            onClick={() => setGenerateMapDialogOpen(true)}
          >
            <MapIcon />
            <span className="hidden md:inline">Generate Map</span>
          </Button>

          <Button variant="outline" size="sm" onClick={() => setCommandPaletteOpen(true)}>
            <CommandIcon />
            <span className="hidden md:inline">Command</span>
          </Button>

          <PlaytestMenu
            mapId={mapId}
            projectId={projectId}
            isStartingPlaytest={isStartingPlaytest}
            flowPhase={flowPhase}
            onSinglePlayer={() => {
              if (projectId && mapId && canStartPlaytest()) {
                void startPlaytest(projectId, mapId);
              }
            }}
            onHost={() => {
              if (projectId && mapId && canStartPlaytest()) {
                void hostLocalMatch(projectId, mapId);
              }
            }}
            onJoin={() => setPlaytestJoinModalOpen(true)}
          />

          <BuildMenu
            projectId={projectId}
            buildPending={startBuild.isPending}
            exportPending={exportProject.isPending}
            onStartBuild={() => {
              if (projectId) {
                void startBuild.mutateAsync({ projectId: projectId as ProjectId });
              }
            }}
            onExport={exportCurrentProject}
          />

          <Button variant="ghost" size="icon-sm" aria-label="Settings" onClick={openSettings}>
            <SettingsIcon />
          </Button>
        </div>
      </header>

      <PlaytestHostDialog
        open={hostModalOpen}
        onOpenChange={setPlaytestHostModalOpen}
        room={roomReady}
        isStarting={flowPhase === 'starting-host'}
        onCopy={copyText}
        onOpenSecondClient={() => {
          if (projectId && mapId) {
            void openSecondClient(projectId, mapId);
          }
        }}
        onJoinAsHost={() => {
          if (mapId) {
            void joinHostAsPlayer(mapId, mapWidth, mapHeight);
          }
        }}
        onStopHosting={() => void stopHosting()}
      />

      <PlaytestJoinDialog
        open={joinModalOpen}
        onOpenChange={setPlaytestJoinModalOpen}
        fallbackBaseUrl={localHostSession?.baseUrl}
        onJoin={(input) => {
          if (mapId) {
            void joinFromInput(input, mapId, mapWidth, mapHeight, localHostSession?.baseUrl);
          }
        }}
      />
    </TooltipProvider>
  );
}
