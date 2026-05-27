import { Badge, Card, CardContent, cn, typography } from '@tileborne/ui';
import type { PluginContributionZone } from '@tileborne/plugin-api';
import { SettingsIcon, WrenchIcon } from 'lucide-react';
import { useMemo } from 'react';

import { usePluginContributions } from '@/hooks/queries';
import type { PluginContributionsResponse } from '@/lib/bridge-types';

type PanelContribution = PluginContributionsResponse['panels'][number];
type ToolContribution = PluginContributionsResponse['tools'][number];

type SidebarContribution =
  | ({ readonly kind: 'Panel' } & PanelContribution)
  | ({ readonly kind: 'Tool' } & ToolContribution);

interface SidebarPluginContributionsProps {
  readonly zone: PluginContributionZone;
  readonly title: string;
}

const compareContributions = (left: SidebarContribution, right: SidebarContribution): number => {
  const leftOrder = left.order ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = right.order ?? Number.MAX_SAFE_INTEGER;
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  return `${left.pluginName}:${left.title}`.localeCompare(`${right.pluginName}:${right.title}`);
};

const contributionSummary = (contribution: SidebarContribution): string => {
  const capabilities = contribution.capabilities ?? [];
  if (capabilities.length > 0) {
    return capabilities.join(', ');
  }
  if (contribution.kind === 'Panel') {
    return 'Editor panel';
  }
  return 'Editor tool';
};

export function SidebarPluginContributions({ zone, title }: SidebarPluginContributionsProps) {
  const contributionsQuery = usePluginContributions();
  const contributions = useMemo<readonly SidebarContribution[]>(() => {
    const panels = (contributionsQuery.data?.panels ?? [])
      .filter((panel) => panel.zone === zone)
      .map((panel) => ({ kind: 'Panel' as const, ...panel }));
    const tools = (contributionsQuery.data?.tools ?? [])
      .filter((tool) => tool.zone === zone)
      .map((tool) => ({ kind: 'Tool' as const, ...tool }));
    return [...panels, ...tools].sort(compareContributions);
  }, [contributionsQuery.data?.panels, contributionsQuery.data?.tools, zone]);

  if (contributionsQuery.isLoading) {
    return (
      <section className="space-y-2 px-2" data-testid={`sidebar-plugin-zone-${zone}`}>
        <p className={typography.panelTitle}>{title}</p>
        <p className={typography.bodyDense}>Loading plugin contributions...</p>
      </section>
    );
  }

  if (contributionsQuery.isError) {
    return (
      <section className="space-y-2 px-2" data-testid={`sidebar-plugin-zone-${zone}`}>
        <p className={typography.panelTitle}>{title}</p>
        <p
          className={cn(
            'rounded-md border border-destructive/40 bg-destructive/10 p-2',
            typography.bodyCompact,
          )}
        >
          Plugin contributions could not be loaded.
        </p>
      </section>
    );
  }

  if (contributions.length === 0) {
    return null;
  }

  return (
    <section
      className="space-y-2 px-2"
      data-testid={`sidebar-plugin-zone-${zone}`}
      aria-labelledby={`sidebar-plugin-zone-${zone}-title`}
    >
      <div className="flex items-center justify-between gap-2">
        <p id={`sidebar-plugin-zone-${zone}-title`} className={typography.panelTitle}>
          {title}
        </p>
        <Badge variant="secondary" className={cn('px-1.5 py-0 font-normal', typography.rowMeta)}>
          {contributions.length}
        </Badge>
      </div>
      <div className="flex flex-col gap-2">
        {contributions.map((contribution) => (
          <Card
            key={`${contribution.pluginId}:${contribution.kind}:${contribution.id}`}
            className="gap-1 py-2.5"
            data-testid={`sidebar-plugin-contribution-${zone}-${contribution.id}`}
          >
            <CardContent className="space-y-1 px-3 py-0">
              <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className={cn('break-words', typography.rowTitle)}>{contribution.title}</p>
                  <p className={cn('break-words', typography.rowMeta)}>{contribution.pluginName}</p>
                </div>
                <Badge variant="outline" className={cn('shrink-0 px-1 py-0', typography.rowMeta)}>
                  {contribution.kind}
                </Badge>
              </div>
              {contribution.description !== undefined ? (
                <p className={typography.bodyCompact}>{contribution.description}</p>
              ) : null}
              <p className={cn('flex items-center gap-1', typography.rowMeta)}>
                {contribution.kind === 'Panel' ? (
                  <SettingsIcon className="size-3" aria-hidden />
                ) : (
                  <WrenchIcon className="size-3" aria-hidden />
                )}
                {contributionSummary(contribution)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
