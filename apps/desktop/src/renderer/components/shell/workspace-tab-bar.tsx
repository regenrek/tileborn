import { useNavigate, useRouterState } from '@tanstack/react-router';
import type { ProjectId } from '@tileborne/core';
import { cn, typography } from '@tileborne/ui';
import {
  MapIcon,
  PackageIcon,
  PuzzleIcon,
  SettingsIcon,
  FolderOpenIcon,
  CrosshairIcon,
  UserIcon,
  XIcon,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo } from 'react';

import { useMap, useProject } from '@/hooks/queries';
import { useEditorUiStore, type WorkspaceTab } from '@/stores/editor-ui-store';

import { describeTabForPath, isTabActive } from './workspace-tabs';

interface TabLabel {
  readonly icon: LucideIcon;
  readonly label: string;
}

function useTabLabel(tab: WorkspaceTab): TabLabel {
  const isMap = tab.kind === 'map';
  const needsProject =
    tab.projectId !== undefined &&
    (tab.kind === 'overview' || tab.kind === 'assets' || tab.kind === 'plugins');
  const projectQuery = useProject(needsProject || isMap ? tab.projectId : undefined);
  const mapQuery = useMap(isMap ? tab.projectId : undefined, isMap ? tab.mapId : undefined);
  const projectName = projectQuery.data?.project.name;

  switch (tab.kind) {
    case 'map': {
      const mapName = mapQuery.data?.map.id ?? tab.mapId ?? 'Map';
      return { icon: MapIcon, label: mapName };
    }
    case 'overview':
      return {
        icon: FolderOpenIcon,
        label: projectName ?? 'Project',
      };
    case 'assets':
      return {
        icon: PackageIcon,
        label: 'Asset library',
      };
    case 'plugins':
      return {
        icon: PuzzleIcon,
        label: 'Plugin manager',
      };
    case 'visual-role-editor':
      return {
        icon: CrosshairIcon,
        label: 'Visual Role Editor',
      };
    case 'player-model-editor':
      return {
        icon: UserIcon,
        label: 'Player Model Editor',
      };
    case 'settings':
      return { icon: SettingsIcon, label: 'Settings' };
  }
}

interface TabItemProps {
  readonly tab: WorkspaceTab;
  readonly active: boolean;
  readonly onActivate: () => void;
  readonly onClose: () => void;
}

function TabItem({ tab, active, onActivate, onClose }: TabItemProps) {
  const { icon: Icon, label } = useTabLabel(tab);

  const handleAuxClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button === 1) {
      event.preventDefault();
      onClose();
    }
  };

  const handleCloseKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={0}
      onClick={onActivate}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onActivate();
        }
      }}
      onAuxClick={handleAuxClick}
      data-testid="workspace-tab"
      data-tab-id={tab.id}
      data-tab-kind={tab.kind}
      data-active={active}
      className={cn(
        'group/tab relative flex h-8 max-w-[220px] shrink-0 cursor-pointer items-center gap-1.5 border-r border-border pl-2.5 pr-1 transition-colors',
        active
          ? 'bg-background text-foreground'
          : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className={cn('truncate', typography.bodyMicro, 'text-current')}>{label}</span>
      <button
        type="button"
        aria-label={`Close ${label}`}
        tabIndex={-1}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        onKeyDown={handleCloseKeyDown}
        className={cn(
          'ml-auto flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-opacity',
          active
            ? 'opacity-100 hover:bg-muted hover:text-foreground'
            : 'opacity-0 hover:bg-muted hover:text-foreground group-hover/tab:opacity-100 focus-visible:opacity-100',
        )}
        data-testid="workspace-tab-close"
      >
        <XIcon className="size-3" aria-hidden />
      </button>
      {active ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-primary"
        />
      ) : null}
    </div>
  );
}

export function WorkspaceTabBar() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const openTabs = useEditorUiStore((state) => state.openTabs);
  const closeTabAction = useEditorUiStore((state) => state.closeTab);
  const recentProjectIds = useEditorUiStore((state) => state.recentProjectIds);
  const recentProjectMaps = useEditorUiStore((state) => state.recentProjectMaps);

  const activeDescriptor = useMemo(() => describeTabForPath(pathname), [pathname]);

  const navigateToTab = useCallback(
    (tab: WorkspaceTab) => {
      switch (tab.kind) {
        case 'map':
          if (tab.projectId && tab.mapId) {
            void navigate({
              to: '/projects/$projectId/maps/$mapId',
              params: { projectId: tab.projectId, mapId: tab.mapId },
            });
          }
          return;
        case 'overview':
          if (tab.projectId) {
            void navigate({ to: '/projects/$projectId', params: { projectId: tab.projectId } });
          }
          return;
        case 'assets':
          if (tab.projectId) {
            void navigate({
              to: '/projects/$projectId/assets',
              params: { projectId: tab.projectId },
            });
          }
          return;
        case 'plugins':
          if (tab.projectId) {
            void navigate({
              to: '/projects/$projectId/plugins',
              params: { projectId: tab.projectId },
            });
          }
          return;
        case 'visual-role-editor':
          if (tab.projectId) {
            void navigate({
              to: '/projects/$projectId/visual-roles',
              params: { projectId: tab.projectId },
            });
          }
          return;
        case 'player-model-editor':
          if (tab.projectId) {
            void navigate({
              to: '/projects/$projectId/player-models',
              params: { projectId: tab.projectId },
            });
          }
          return;
        case 'settings':
          if (tab.projectId) {
            void navigate({
              to: '/projects/$projectId/settings',
              params: { projectId: tab.projectId },
            });
          } else {
            void navigate({ to: '/settings' });
          }
          return;
      }
    },
    [navigate],
  );

  const navigateToFallback = useCallback(
    (closedTab: WorkspaceTab) => {
      const projectId = closedTab.projectId ?? recentProjectIds[0];
      const mapId = projectId === undefined ? undefined : recentProjectMaps[String(projectId)];
      if (projectId && mapId) {
        void navigate({
          to: '/projects/$projectId/maps/$mapId',
          params: { projectId, mapId },
        });
        return;
      }
      if (projectId) {
        void navigate({
          to: '/projects/$projectId',
          params: { projectId: projectId as ProjectId },
        });
        return;
      }
      void navigate({ to: '/' });
    },
    [navigate, recentProjectIds, recentProjectMaps],
  );

  const handleCloseTab = useCallback(
    (tab: WorkspaceTab) => {
      const wasActive = isTabActive(tab, activeDescriptor);
      const successor = closeTabAction(tab.id);
      if (!wasActive) return;
      if (successor !== null) {
        navigateToTab(successor);
        return;
      }
      navigateToFallback(tab);
    },
    [activeDescriptor, closeTabAction, navigateToFallback, navigateToTab],
  );

  /** Cmd/Ctrl+W closes the active tab. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== 'w') return;
      const activeTab = openTabs.find((tab) => isTabActive(tab, activeDescriptor));
      if (activeTab === undefined) return;
      event.preventDefault();
      handleCloseTab(activeTab);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeDescriptor, handleCloseTab, openTabs]);

  if (openTabs.length === 0) {
    return null;
  }

  return (
    <div
      role="tablist"
      aria-label="Open workspace pages"
      data-testid="workspace-tab-bar"
      onWheel={(event) => {
        if (event.currentTarget.scrollWidth <= event.currentTarget.clientWidth) return;
        event.preventDefault();
        event.currentTarget.scrollLeft += event.deltaX || event.deltaY;
      }}
      className="scrollbar-none flex h-8 shrink-0 items-stretch overflow-x-auto overflow-y-hidden overscroll-x-contain border-b border-border bg-sidebar"
    >
      {openTabs.map((tab) => (
        <TabItem
          key={tab.id}
          tab={tab}
          active={isTabActive(tab, activeDescriptor)}
          onActivate={() => navigateToTab(tab)}
          onClose={() => handleCloseTab(tab)}
        />
      ))}
    </div>
  );
}
