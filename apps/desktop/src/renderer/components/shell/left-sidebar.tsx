import { useParams } from '@tanstack/react-router';
import {
  Badge,
  Button,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
  typography,
} from '@tileborne/ui';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useState } from 'react';

import { AssetsTab, AssetsTabCollapsedHint } from '@/components/sidebar/assets-tab';
import { ProjectTreeTab, ProjectTreeTabCollapsedHint } from '@/components/sidebar/project-tree-tab';
import { PluginsTab, PluginsTabCollapsedHint } from '@/components/sidebar/plugins-tab';
import { SidebarShortcutHint } from '@/components/sidebar/sidebar-shortcut-hint';
import {
  WorkingPaletteTab,
  WorkingPaletteTabCollapsedHint,
} from '@/components/sidebar/working-palette-tab';
import { useAssetPacks, useMaps, usePluginsList } from '@/hooks/queries';
import { useActiveWorkingPalette } from '@/hooks/use-working-palettes';
import { useEditorUiStore } from '@/stores/editor-ui-store';

type SidebarTab = 'project' | 'palette' | 'assets' | 'plugins';

const SIDEBAR_TABS: ReadonlyArray<{ readonly value: SidebarTab; readonly label: string }> = [
  { value: 'project', label: 'Project' },
  { value: 'palette', label: 'Working Palette' },
  { value: 'assets', label: 'Assets' },
  { value: 'plugins', label: 'Plugins' },
];

export function LeftSidebar() {
  const { projectId, mapId } = useParams({ strict: false });
  const sidebarCollapsed = useEditorUiStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useEditorUiStore((s) => s.setSidebarCollapsed);
  const [activeTab, setActiveTab] = useState<SidebarTab>('project');
  const mapsQuery = useMaps(projectId);
  const assetPacksQuery = useAssetPacks();
  const pluginsQuery = usePluginsList();
  const activePalette = useActiveWorkingPalette(projectId ?? null);

  const counts = {
    ...(mapsQuery.data === undefined ? {} : { project: mapsQuery.data.maps.length }),
    ...(activePalette === undefined ? {} : { palette: activePalette.items.length }),
    ...(assetPacksQuery.data === undefined ? {} : { assets: assetPacksQuery.data.packs.length }),
    ...(pluginsQuery.data === undefined ? {} : { plugins: pluginsQuery.data.plugins.length }),
  } satisfies Partial<Record<SidebarTab, number>>;

  const openTab = (tab: SidebarTab) => {
    setActiveTab(tab);
    setSidebarCollapsed(false);
  };

  const activeLabel = SIDEBAR_TABS.find((tab) => tab.value === activeTab)?.label ?? 'Project';

  if (sidebarCollapsed) {
    return (
      <TooltipProvider>
        <aside className="flex h-full w-full min-w-0 shrink-0 flex-col items-center gap-2 overflow-hidden border-r border-border bg-sidebar py-2">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Expand sidebar"
                  onClick={() => setSidebarCollapsed(false)}
                >
                  <ChevronRightIcon />
                </Button>
              }
            />
            <TooltipContent side="right">
              <SidebarShortcutHint label="Expand sidebar" keys={[]} />
            </TooltipContent>
          </Tooltip>
          <ProjectTreeTabCollapsedHint onClick={() => openTab('project')} />
          <WorkingPaletteTabCollapsedHint onClick={() => openTab('palette')} />
          <AssetsTabCollapsedHint onClick={() => openTab('assets')} />
          <PluginsTabCollapsedHint onClick={() => openTab('plugins')} />
        </aside>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-r border-border bg-sidebar">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-2 py-1.5">
          <span className={typography.panelTitle} data-testid="left-sidebar-title">
            {activeLabel}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Collapse sidebar"
            onClick={() => setSidebarCollapsed(true)}
          >
            <ChevronLeftIcon />
          </Button>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as SidebarTab)}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <TabsList
            variant="line"
            className="w-full shrink-0 justify-start gap-0 overflow-x-auto border-b border-border px-2"
          >
            {SIDEBAR_TABS.map((tab) => (
              <SidebarTabTrigger
                key={tab.value}
                value={tab.value}
                label={tab.label}
                count={counts[tab.value]}
              />
            ))}
          </TabsList>

          {activeTab === 'project' ? (
            <TabsContent value="project" className="mt-0 min-h-0 flex-1">
              <ProjectTreeTab projectId={projectId} />
            </TabsContent>
          ) : null}

          {activeTab === 'palette' ? (
            <TabsContent value="palette" className="mt-0 min-h-0 flex-1">
              <WorkingPaletteTab projectId={projectId} mapId={mapId} />
            </TabsContent>
          ) : null}

          {activeTab === 'assets' ? (
            <TabsContent value="assets" className="mt-0 min-h-0 flex-1">
              <AssetsTab projectId={projectId} />
            </TabsContent>
          ) : null}

          {activeTab === 'plugins' ? (
            <TabsContent value="plugins" className="mt-0 min-h-0 flex-1">
              <PluginsTab projectId={projectId} />
            </TabsContent>
          ) : null}
        </Tabs>
      </aside>
    </TooltipProvider>
  );
}

function SidebarTabTrigger({
  value,
  label,
  count,
}: {
  readonly value: SidebarTab;
  readonly label: string;
  readonly count: number | undefined;
}) {
  return (
    <TabsTrigger value={value} className="min-w-fit">
      <span>{label}</span>
      {count !== undefined && count > 0 ? (
        <Badge variant="secondary" className={cn('px-1 py-0 font-normal', typography.micro)}>
          {count}
        </Badge>
      ) : null}
    </TabsTrigger>
  );
}
