import { useParams } from '@tanstack/react-router';
import { useMemo, useRef, useState } from 'react';
import { Button, Input, Kbd, cn, typography } from '@tileborne/ui';
import { FolderOpenIcon, SearchIcon } from 'lucide-react';

import { BundledPluginsSection } from '@/components/plugin-manager/bundled-plugins-section';
import { PluginCard } from '@/components/plugin-manager/plugin-card';
import { PluginDetailsPane } from '@/components/plugin-manager/plugin-details-pane';
import { PluginGridSkeleton } from '@/components/plugin-manager/plugin-grid-skeleton';
import { PluginManagerEmptyState } from '@/components/plugin-manager/plugin-manager-empty-state';
import { CloseableWorkspacePage } from '@/components/shell/closeable-workspace-page';
import { useDisablePlugin, useEnablePlugin, useInstallBattleRoyalePlugin } from '@/hooks/mutations';
import { useFocusSearchShortcut } from '@/hooks/use-focus-search-shortcut';
import { usePluginManifest, usePluginsList } from '@/hooks/queries';
import type { PluginsListResponse } from '@/lib/bridge-types';
import { notifyError, notifySuccess } from '@/stores/app-notifications-store';
import { useEditorUiStore } from '@/stores/editor-ui-store';

export function PluginManagerPage() {
  useParams({ from: '/editor/projects/$projectId/plugins' });
  const pluginsQuery = usePluginsList();
  const installBattleRoyale = useInstallBattleRoyalePlugin();
  const enablePlugin = useEnablePlugin();
  const disablePlugin = useDisablePlugin();
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const setPluginInstallDialogOpen = useEditorUiStore((s) => s.setPluginInstallDialogOpen);
  useFocusSearchShortcut(searchInputRef);

  const plugins = pluginsQuery.data?.plugins ?? [];
  const installPending = installBattleRoyale.isPending;
  const togglePending = enablePlugin.isPending || disablePlugin.isPending;

  const filteredPlugins = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (query.length === 0) {
      return plugins;
    }
    return plugins.filter(
      (plugin) =>
        plugin.id.toLowerCase().includes(query) ||
        plugin.version.toLowerCase().includes(query) ||
        plugin.rootPath.toLowerCase().includes(query),
    );
  }, [plugins, searchQuery]);

  const selectedId =
    selectedPluginId !== null && filteredPlugins.some((plugin) => plugin.id === selectedPluginId)
      ? selectedPluginId
      : (filteredPlugins[0]?.id ?? null);

  const installBundled = () => {
    void installBattleRoyale
      .mutateAsync()
      .then(() => notifySuccess('Battle Royale plugin installed'))
      .catch((error) => notifyError(error instanceof Error ? error.message : String(error)));
  };

  return (
    <CloseableWorkspacePage
      title="Plugin manager"
      description="Install Tileborne plugins to extend the editor, runtime, and exporters."
      actions={
        <Button
          data-testid="plugin-manager-open-install-dialog"
          disabled={installPending}
          onClick={() => setPluginInstallDialogOpen(true)}
        >
          <FolderOpenIcon />
          Install from path…
        </Button>
      }
    >
      <BundledPluginsSection />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search plugins by id, version, or path…"
            className="pl-8"
            aria-label="Search plugins"
          />
        </div>
        <p className={cn(typography.bodyMicro, 'flex items-center gap-1.5')}>
          Filter
          <Kbd>/</Kbd>
        </p>
      </div>

      <div className="flex min-h-0 flex-1 gap-6">
        <div className="min-w-0 flex-1">
          {pluginsQuery.isLoading ? (
            <PluginGridSkeleton />
          ) : plugins.length === 0 ? (
            <PluginManagerEmptyState
              installPending={installPending}
              onInstallBundled={installBundled}
              onInstallFromPath={() => setPluginInstallDialogOpen(true)}
            />
          ) : filteredPlugins.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
              <p className={cn(typography.caption, 'font-medium')}>No matching plugins</p>
              <p className={cn('mt-1', typography.bodyCompact)}>
                Try a different search term or clear the filter.
              </p>
            </div>
          ) : (
            <div
              className="grid grid-cols-1 gap-3 md:grid-cols-2"
              data-testid="plugin-manager-grid"
            >
              {filteredPlugins.map((plugin) => (
                <PluginCardWithManifestStatus
                  key={plugin.id}
                  plugin={plugin}
                  selected={selectedId === plugin.id}
                  togglePending={togglePending}
                  onSelect={() => setSelectedPluginId(plugin.id)}
                  onToggleEnabled={(checked) => {
                    if (checked) {
                      void enablePlugin.mutateAsync(plugin.id);
                    } else {
                      void disablePlugin.mutateAsync(plugin.id);
                    }
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {selectedId && plugins.length > 0 ? (
          <aside className="hidden w-80 shrink-0 lg:block">
            <PluginDetailsPane pluginId={selectedId} />
          </aside>
        ) : null}
      </div>

      {selectedId && plugins.length > 0 ? (
        <div className="lg:hidden">
          <PluginDetailsPane pluginId={selectedId} />
        </div>
      ) : null}
    </CloseableWorkspacePage>
  );
}

type PluginSummary = PluginsListResponse['plugins'][number];

interface PluginCardWithManifestStatusProps {
  readonly plugin: PluginSummary;
  readonly selected: boolean;
  readonly togglePending: boolean;
  readonly onSelect: () => void;
  readonly onToggleEnabled: (enabled: boolean) => void;
}

function PluginCardWithManifestStatus({
  plugin,
  selected,
  togglePending,
  onSelect,
  onToggleEnabled,
}: PluginCardWithManifestStatusProps) {
  const manifestQuery = usePluginManifest(plugin.id);

  return (
    <PluginCard
      plugin={plugin}
      selected={selected}
      manifestFailed={manifestQuery.isError}
      togglePending={togglePending}
      onSelect={onSelect}
      onToggleEnabled={onToggleEnabled}
    />
  );
}
