import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Separator,
  Skeleton,
  Switch,
  cn,
  typography,
} from '@tileborne/ui';

import { useDisablePlugin, useEnablePlugin } from '@/hooks/mutations';
import { usePluginManifest, usePluginsList } from '@/hooks/queries';
import { listPluginCapabilities } from '@/lib/plugin-capabilities';

import { PluginStatusBadges } from './plugin-status-badges';

interface PluginDetailsPaneProps {
  readonly pluginId: string;
}

export function PluginDetailsPane({ pluginId }: PluginDetailsPaneProps) {
  const pluginsQuery = usePluginsList();
  const manifestQuery = usePluginManifest(pluginId);
  const enablePlugin = useEnablePlugin();
  const disablePlugin = useDisablePlugin();
  const plugin = pluginsQuery.data?.plugins.find((entry) => entry.id === pluginId);
  const manifest = manifestQuery.data?.manifest;
  const manifestFailed = manifestQuery.isError;
  const togglePending = enablePlugin.isPending || disablePlugin.isPending;

  if (pluginsQuery.isLoading || manifestQuery.isLoading || !plugin) {
    return (
      <Card className="h-fit border-border/80">
        <CardHeader className="gap-3">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 6 }, (_, rowNumber) => `plugin-detail-row-${rowNumber}`).map((rowKey) => (
            <Skeleton key={rowKey} className="h-4 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const capabilities =
    manifest?.contributes !== undefined
      ? listPluginCapabilities(manifest.contributes as Record<string, unknown>)
      : [];

  return (
    <Card className="h-fit border-border/80" data-testid="plugin-details-pane">
      <CardHeader className="gap-3">
        <div className="space-y-2">
          <CardTitle>{manifest?.displayName ?? plugin.id}</CardTitle>
          <CardDescription className={typography.bodyCompact}>
            {manifest?.description ?? 'Manifest summary for the selected plugin'}
          </CardDescription>
        </div>
        <PluginStatusBadges
          enabled={plugin.enabled}
          version={plugin.version}
          manifestFailed={manifestFailed}
        />
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="space-y-2">
          <DetailRow label="Plugin id" value={plugin.id} mono />
          <DetailRow label="Version" value={`v${plugin.version}`} />
          <DetailRow label="Name" value={manifest?.name ?? plugin.id} />
          <DetailRow label="Author" value={manifest?.author ?? '—'} />
          <DetailRow label="License" value={manifest?.license ?? '—'} />
          <DetailRow label="Engine" value={manifest?.engine ?? '—'} />
        </dl>

        <Separator />

        <section className="space-y-2">
          <p className={typography.sectionLabelMicro}>Capabilities</p>
          {capabilities.length === 0 ? (
            <p className={typography.bodyCompact}>No declared contribution slots.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {capabilities.map((capability) => (
                <li key={capability}>
                  <Badge variant="outline" className={typography.micro}>
                    {capability}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <p className={typography.sectionLabelMicro}>Permissions</p>
          {manifest?.permissions.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {manifest.permissions.map((permission) => (
                <li key={permission}>
                  <Badge variant="secondary" className={typography.micro}>
                    {permission}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className={typography.bodyCompact}>No permissions declared.</p>
          )}
        </section>

        <section className="space-y-2">
          <p className={typography.sectionLabelMicro}>Install path</p>
          <p className={cn('break-all font-mono', typography.bodyMicro, 'text-foreground')}>
            {plugin.rootPath}
          </p>
        </section>
      </CardContent>
      <CardContent className="pt-0">
        <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
          <div>
            <p className={cn(typography.caption, 'font-medium')}>Plugin enabled</p>
            <p className={typography.bodyMicro}>
              {plugin.enabled ? 'Contributions are active' : 'Contributions are disabled'}
            </p>
          </div>
          <Switch
            checked={plugin.enabled}
            disabled={togglePending}
            aria-label={plugin.enabled ? 'Disable plugin' : 'Enable plugin'}
            onCheckedChange={(checked) => {
              if (checked) {
                void enablePlugin.mutateAsync(plugin.id);
              } else {
                void disablePlugin.mutateAsync(plugin.id);
              }
            }}
          />
        </div>
        {manifestFailed ? (
          <Button
            variant="outline"
            className="mt-3 w-full"
            onClick={() => void manifestQuery.refetch()}
          >
            Retry manifest load
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={cn(typography.sectionLabelMicro, 'normal-case tracking-normal')}>{label}</dt>
      <dd
        className={cn(
          'text-right',
          typography.caption,
          'text-foreground',
          mono && 'font-mono text-xs',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
