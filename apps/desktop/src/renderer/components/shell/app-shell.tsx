import { Outlet, useParams } from '@tanstack/react-router';
import type { ProjectId } from '@tileborne/core';
import {
  Button,
  Kbd,
  KbdGroup,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  cn,
  typography,
  usePanelRef,
} from '@tileborne/ui';
import { PanelBottomOpenIcon } from 'lucide-react';
import { useCallback, useEffect } from 'react';

import { AppNotifications } from '@/components/app-notifications';
import { AssetImportDialog } from '@/components/asset-import-dialog';
import { SpriteAnimationStudio } from '@/components/sprite-studio/sprite-animation-studio';
import { CreateMapDialog } from '@/components/create-map-dialog';
import { DuplicatePackDialog } from '@/components/duplicate-pack-dialog';
import { GenerateMapDialog } from '@/components/generate-map-dialog';
import { PluginInstallDialog } from '@/components/plugin-manager/plugin-install-dialog';
import { ShipGameDialog } from '@/components/ship-game-dialog';
import { BottomDrawer } from '@/components/shell/bottom-drawer';
import { LeftSidebar } from '@/components/shell/left-sidebar';
import { RightInspector } from '@/components/shell/right-inspector';
import { TopBar } from '@/components/shell/top-bar';
import { useWorkspaceTabSync } from '@/components/shell/use-workspace-tab-sync';
import { WorkspaceTabBar } from '@/components/shell/workspace-tab-bar';
import { modKeyLabel } from '@/lib/keyboard-shortcuts';
import { useEditorUiStore } from '@/stores/editor-ui-store';
import { useReadinessProblemsOwner } from '@/hooks/use-readiness-problems-owner';

const SIDEBAR_COLLAPSED_SIZE = '48px';
const INSPECTOR_COLLAPSED_SIZE = '48px';

export function AppShell() {
  useWorkspaceTabSync();
  useReadinessProblemsOwner();
  const { projectId, mapId } = useParams({ strict: false });
  const bottomDrawerOpen = useEditorUiStore((s) => s.bottomDrawerOpen);
  const setBottomDrawerOpen = useEditorUiStore((s) => s.setBottomDrawerOpen);
  const sidebarCollapsed = useEditorUiStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useEditorUiStore((s) => s.setSidebarCollapsed);
  const inspectorCollapsed = useEditorUiStore((s) => s.inspectorCollapsed);
  const setInspectorCollapsed = useEditorUiStore((s) => s.setInspectorCollapsed);
  const setGenerateMapDialogOpen = useEditorUiStore((s) => s.setGenerateMapDialogOpen);
  const setCreateMapDialogOpen = useEditorUiStore((s) => s.setCreateMapDialogOpen);
  const setPluginInstallDialogOpen = useEditorUiStore((s) => s.setPluginInstallDialogOpen);
  const setAssetImportDialogOpen = useEditorUiStore((s) => s.setAssetImportDialogOpen);
  const generateMapDialogOpen = useEditorUiStore((s) => s.generateMapDialogOpen);
  const createMapDialogOpen = useEditorUiStore((s) => s.createMapDialogOpen);
  const pluginInstallDialogOpen = useEditorUiStore((s) => s.pluginInstallDialogOpen);
  const assetImportDialogOpen = useEditorUiStore((s) => s.assetImportDialogOpen);
  const spriteEditorOpen = useEditorUiStore((s) => s.spriteEditorOpen);
  const setSpriteEditorOpen = useEditorUiStore((s) => s.setSpriteEditorOpen);
  const shipGameDialogOpen = useEditorUiStore((s) => s.shipGameDialogOpen);
  const setShipGameDialogOpen = useEditorUiStore((s) => s.setShipGameDialogOpen);

  const sidebarPanelRef = usePanelRef();
  const inspectorPanelRef = usePanelRef();

  useEffect(() => {
    const panel = sidebarPanelRef.current;
    if (!panel) return;
    if (sidebarCollapsed && !panel.isCollapsed()) {
      panel.collapse();
    } else if (!sidebarCollapsed && panel.isCollapsed()) {
      panel.expand();
    }
  }, [sidebarCollapsed, sidebarPanelRef]);

  useEffect(() => {
    const panel = inspectorPanelRef.current;
    if (!panel) return;
    if (inspectorCollapsed && !panel.isCollapsed()) {
      panel.collapse();
    } else if (!inspectorCollapsed && panel.isCollapsed()) {
      panel.expand();
    }
  }, [inspectorCollapsed, inspectorPanelRef]);

  const handleSidebarResize = useCallback(() => {
    const panel = sidebarPanelRef.current;
    if (!panel) return;
    const collapsed = panel.isCollapsed();
    if (collapsed !== sidebarCollapsed) {
      setSidebarCollapsed(collapsed);
    }
  }, [sidebarCollapsed, setSidebarCollapsed, sidebarPanelRef]);

  const handleInspectorResize = useCallback(() => {
    const panel = inspectorPanelRef.current;
    if (!panel) return;
    const collapsed = panel.isCollapsed();
    if (collapsed !== inspectorCollapsed) {
      setInspectorCollapsed(collapsed);
    }
  }, [inspectorCollapsed, setInspectorCollapsed, inspectorPanelRef]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.altKey) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'g' && !event.shiftKey) {
        event.preventDefault();
        if (projectId) {
          setGenerateMapDialogOpen(true);
        }
        return;
      }
      if (key === 'j' && !event.shiftKey) {
        event.preventDefault();
        setBottomDrawerOpen(!bottomDrawerOpen);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [bottomDrawerOpen, projectId, setBottomDrawerOpen, setGenerateMapDialogOpen]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <TopBar projectId={projectId} mapId={mapId} />

      <ResizablePanelGroup
        id="tileborne-shell-vertical"
        orientation="vertical"
        className="min-h-0 flex-1"
      >
        <ResizablePanel
          id="tileborne-shell-main"
          defaultSize={bottomDrawerOpen ? '78%' : '100%'}
          minSize={360}
        >
          <ResizablePanelGroup
            id="tileborne-shell-horizontal"
            orientation="horizontal"
            className="h-full"
            defaultLayout={{ sidebar: 440, viewport: 720, inspector: 320 }}
          >
            <ResizablePanel
              id="sidebar"
              panelRef={sidebarPanelRef}
              collapsible
              collapsedSize={SIDEBAR_COLLAPSED_SIZE}
              defaultSize="440px"
              minSize="280px"
              maxSize="560px"
              onResize={handleSidebarResize}
              className="overflow-hidden"
            >
              <LeftSidebar />
            </ResizablePanel>
            <ResizableHandle
              withHandle={!sidebarCollapsed}
              className={cn(sidebarCollapsed && 'pointer-events-none opacity-0')}
            />
            <ResizablePanel id="viewport" minSize="480px">
              <div className="flex h-full min-w-0 flex-col bg-background">
                <WorkspaceTabBar />
                <main className="min-h-0 flex-1 overflow-auto">
                  <Outlet />
                </main>
              </div>
            </ResizablePanel>
            <ResizableHandle
              withHandle={!inspectorCollapsed}
              className={cn(inspectorCollapsed && 'pointer-events-none opacity-0')}
            />
            <ResizablePanel
              id="inspector"
              panelRef={inspectorPanelRef}
              collapsible
              collapsedSize={INSPECTOR_COLLAPSED_SIZE}
              defaultSize="320px"
              minSize="280px"
              maxSize="480px"
              onResize={handleInspectorResize}
            >
              <RightInspector />
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>

        {bottomDrawerOpen ? (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel
              id="tileborne-shell-drawer"
              defaultSize="220px"
              minSize="120px"
              maxSize="360px"
            >
              <BottomDrawer />
            </ResizablePanel>
          </>
        ) : null}
      </ResizablePanelGroup>

      {bottomDrawerOpen ? null : (
        <div
          className="flex h-7 shrink-0 items-center justify-end gap-2 border-t border-border bg-sidebar px-2"
          data-testid="bottom-drawer-status"
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 gap-1.5 px-2"
            aria-label="Open bottom panel"
            onClick={() => setBottomDrawerOpen(true)}
            data-testid="bottom-drawer-open"
          >
            <PanelBottomOpenIcon aria-hidden className="size-3.5" />
            <span className={cn(typography.inlineHint, 'text-foreground/80')}>Show panel</span>
            <KbdGroup aria-hidden>
              <Kbd>{modKeyLabel()}</Kbd>
              <Kbd>J</Kbd>
            </KbdGroup>
          </Button>
        </div>
      )}

      <GenerateMapDialog
        open={generateMapDialogOpen}
        onOpenChange={setGenerateMapDialogOpen}
        projectId={projectId}
      />
      <CreateMapDialog
        open={createMapDialogOpen}
        onOpenChange={setCreateMapDialogOpen}
        projectId={projectId as ProjectId | undefined}
      />
      <PluginInstallDialog
        open={pluginInstallDialogOpen}
        onOpenChange={setPluginInstallDialogOpen}
      />
      <AssetImportDialog
        open={assetImportDialogOpen}
        onOpenChange={setAssetImportDialogOpen}
        projectId={projectId}
      />
      <SpriteAnimationStudio open={spriteEditorOpen} onOpenChange={setSpriteEditorOpen} />
      <ShipGameDialog
        open={shipGameDialogOpen}
        onOpenChange={setShipGameDialogOpen}
        projectId={projectId as ProjectId | undefined}
      />
      <DuplicatePackDialog />

      <AppNotifications />
    </div>
  );
}
