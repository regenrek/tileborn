import { Link } from '@tanstack/react-router';
import {
  Badge,
  Button,
  ScrollArea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
  typography,
} from '@tileborne/ui';
import { PuzzleIcon } from 'lucide-react';

import { SidebarPluginContributions } from '@/components/sidebar/plugin-contribution-zone';
import { SidebarEmptyState } from '@/components/sidebar/sidebar-empty-state';
import { SidebarListSkeleton } from '@/components/sidebar/sidebar-list-skeleton';
import { usePluginsList } from '@/hooks/queries';
import { BATTLE_ROYALE_PLUGIN_ID } from '@/lib/battle-royale-plugin';
import { useEditorUiStore } from '@/stores/editor-ui-store';

interface PluginsTabProps {
  readonly projectId: string | undefined;
}

export function PluginsTab({ projectId }: PluginsTabProps) {
  const pluginsQuery = usePluginsList();
  const setPluginInstallDialogOpen = useEditorUiStore((s) => s.setPluginInstallDialogOpen);
  const installedPlugins = pluginsQuery.data?.plugins ?? [];
  const battleRoyalePlugin = installedPlugins.find(
    (plugin) => plugin.id === BATTLE_ROYALE_PLUGIN_ID,
  );

  return (
    <ScrollArea className="h-full min-h-0">
      <div className="space-y-3 py-2">
        <div className="space-y-2 rounded-md border border-border bg-card p-2">
          <div className="flex items-center justify-between gap-2">
            <p className={typography.sectionLabelMicro}>Bundled plugins</p>
            {installedPlugins.length > 0 ? (
              <Badge
                variant="secondary"
                className={cn('px-1.5 py-0 font-normal', typography.rowMeta)}
              >
                {installedPlugins.length}
              </Badge>
            ) : null}
          </div>
          <div className="flex min-w-0 items-center justify-between gap-2">
            <div className="min-w-0">
              <p className={cn(typography.caption, 'truncate font-medium text-foreground')}>
                Battle Royale
              </p>
              <p className={typography.bodyCompact}>
                {battleRoyalePlugin
                  ? battleRoyalePlugin.enabled
                    ? 'Installed · Enabled'
                    : 'Installed · Disabled'
                  : 'Not installed'}
              </p>
            </div>
            {battleRoyalePlugin ? null : (
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                data-testid="install-battle-royale-sidebar"
                onClick={() => setPluginInstallDialogOpen(true)}
              >
                Install
              </Button>
            )}
          </div>
        </div>

        <SidebarPluginContributions zone="plugins" title="Plugin settings" />

        {pluginsQuery.isLoading ? (
          <SidebarListSkeleton rows={3} />
        ) : installedPlugins.length === 0 ? (
          <SidebarEmptyState
            icon={PuzzleIcon}
            title="No plugins installed"
            description="Install a gameplay plugin to extend playtest and runtime behavior."
            actionLabel="Install plugin"
            actionTestId="install-battle-royale-sidebar"
            onAction={() => setPluginInstallDialogOpen(true)}
          />
        ) : (
          <ul className="space-y-1">
            {installedPlugins.map((plugin) => (
              <li
                key={plugin.id}
                className="truncate rounded-md px-2 py-1.5 text-caption text-muted-foreground"
              >
                <span className="font-medium text-foreground">{plugin.id}</span>
                <span className="ml-1">· {plugin.enabled ? 'Enabled' : 'Disabled'}</span>
              </li>
            ))}
          </ul>
        )}

        {projectId ? (
          <Link
            to="/projects/$projectId/plugins"
            params={{ projectId }}
            className={cn('inline-block px-1', typography.caption, 'text-primary hover:underline')}
          >
            Open plugin manager
          </Link>
        ) : (
          <p className={cn('px-1', typography.bodyCompact)}>Open a project to manage plugins</p>
        )}
      </div>
    </ScrollArea>
  );
}

export function PluginsTabCollapsedHint({ onClick }: { readonly onClick?: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="Plugins" onClick={onClick}>
            <PuzzleIcon className="size-4 text-muted-foreground" aria-hidden />
          </Button>
        }
      />
      <TooltipContent side="right">Installed plugins</TooltipContent>
    </Tooltip>
  );
}
