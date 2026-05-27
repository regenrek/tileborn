import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, cn, typography } from '@tileborne/ui';

import { useInstallBattleRoyalePlugin } from '@/hooks/mutations';
import { usePluginsList } from '@/hooks/queries';
import { BATTLE_ROYALE_PLUGIN_ID } from '@/lib/battle-royale-plugin';
import { notifyError, notifySuccess } from '@/stores/app-notifications-store';

import { PluginStatusBadges } from './plugin-status-badges';

export function BundledPluginsSection() {
  const pluginsQuery = usePluginsList();
  const installBattleRoyale = useInstallBattleRoyalePlugin();
  const battleRoyalePlugin = pluginsQuery.data?.plugins.find(
    (plugin) => plugin.id === BATTLE_ROYALE_PLUGIN_ID,
  );

  return (
    <section className="space-y-2">
      <p className={typography.sectionLabelMicro}>Bundled plugins</p>
      <Card>
        <CardHeader className="gap-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <CardTitle className={cn('text-sm', typography.caption)}>Battle Royale</CardTitle>
              <CardDescription className={typography.bodyCompact}>
                Workspace gameplay plugin for playtest and runtime systems.
              </CardDescription>
              {battleRoyalePlugin ? (
                <PluginStatusBadges
                  enabled={battleRoyalePlugin.enabled}
                  version={battleRoyalePlugin.version}
                />
              ) : (
                <p className={typography.bodyMicro}>Not installed</p>
              )}
            </div>
            {battleRoyalePlugin ? null : (
              <Button
                variant="outline"
                className="shrink-0"
                data-testid="install-battle-royale-manager"
                disabled={installBattleRoyale.isPending}
                onClick={() =>
                  void installBattleRoyale
                    .mutateAsync()
                    .then(() => notifySuccess('Battle Royale plugin installed'))
                    .catch((error) =>
                      notifyError(error instanceof Error ? error.message : String(error)),
                    )
                }
              >
                Install
              </Button>
            )}
          </div>
        </CardHeader>
        {battleRoyalePlugin ? (
          <CardContent className="px-4 pb-4 pt-0">
            <p className={cn('break-all font-mono', typography.bodyMicro, 'text-muted-foreground')}>
              {battleRoyalePlugin.rootPath}
            </p>
          </CardContent>
        ) : null}
      </Card>
    </section>
  );
}
