import { Button, Card, CardContent, CardHeader, CardTitle, cn, typography } from '@tileborne/ui';

import { useInstallBattleRoyalePlugin } from '@/hooks/mutations';
import { usePluginsList } from '@/hooks/queries';
import { BATTLE_ROYALE_PLUGIN_ID } from '@/lib/battle-royale-plugin';
import { notifyError, notifySuccess } from '@/stores/app-notifications-store';

import { PluginStatusBadges } from './plugin-status-badges';

/**
 * Lists EVERY installed plugin generically (ADR-0023 section B) rather than a
 * single hardcoded Battle Royale card. Both bundled example plugins (Battle
 * Royale + the example arena) auto-seed on boot, so they appear here as soon as
 * the registry lists them. The Battle Royale one-click install is retained only
 * as a bootstrap fallback for the case where seeding has not run yet.
 */
export function BundledPluginsSection() {
  const pluginsQuery = usePluginsList();
  const installBattleRoyale = useInstallBattleRoyalePlugin();
  const plugins = pluginsQuery.data?.plugins ?? [];
  const hasBattleRoyale = plugins.some((plugin) => plugin.id === BATTLE_ROYALE_PLUGIN_ID);

  return (
    <section className="space-y-2">
      <p className={typography.sectionLabelMicro}>Bundled plugins</p>

      {plugins.length === 0 ? (
        <Card>
          <CardHeader className="gap-3 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className={typography.bodyCompact}>No plugins installed yet.</p>
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
                Install Battle Royale
              </Button>
            </div>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-2">
          {plugins.map((plugin) => (
            <Card key={plugin.id} data-testid={`bundled-plugin-${plugin.id}`}>
              <CardHeader className="gap-2 p-4">
                <div className="min-w-0 space-y-2">
                  <CardTitle className={cn('break-all text-sm', typography.caption)}>
                    {plugin.id}
                  </CardTitle>
                  <PluginStatusBadges enabled={plugin.enabled} version={plugin.version} />
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                <p
                  className={cn('break-all font-mono', typography.bodyMicro, 'text-muted-foreground')}
                >
                  {plugin.rootPath}
                </p>
              </CardContent>
            </Card>
          ))}
          {hasBattleRoyale ? null : (
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
              Install Battle Royale
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
