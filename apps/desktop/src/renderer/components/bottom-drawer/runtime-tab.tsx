import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  typography,
} from '@tileborne/ui';
import { CpuIcon } from 'lucide-react';

import { DrawerEmptyState } from '@/components/bottom-drawer/drawer-empty-state';
import { DrawerListSkeleton } from '@/components/bottom-drawer/drawer-list-skeleton';
import { formatDrawerTimestamp } from '@/components/bottom-drawer/format';
import { usePlaytestSessions } from '@/hooks/queries';
import { resolvePlaytestPluginName } from '@/lib/playtest-runtime-status';
import { useEditorUiStore } from '@/stores/editor-ui-store';

export function RuntimeTab() {
  const playtestActive = useEditorUiStore((state) => state.playtestActive);
  const playtestSessionId = useEditorUiStore((state) => state.playtestSessionId);
  const playtestActivePlugins = useEditorUiStore((state) => state.playtestActivePlugins);
  const playtestQuery = usePlaytestSessions({
    refetchInterval: playtestActive ? 1_000 : false,
  });

  const session = playtestQuery.data?.sessions.find((entry) => entry.id === playtestSessionId);
  const metrics = session?.runtimeMetrics;
  const pluginName = resolvePlaytestPluginName(session?.activePlugins ?? playtestActivePlugins);

  if (playtestQuery.isLoading) {
    return <DrawerListSkeleton rows={4} />;
  }

  if (!playtestActive || !metrics) {
    return (
      <DrawerEmptyState
        icon={CpuIcon}
        title="Runtime idle"
        description="Start a playtest session to stream plugin tick metrics here."
      />
    );
  }

  return (
    <div className="space-y-2 py-2">
      <Card className="gap-2 py-2">
        <CardHeader className="gap-1 px-3 py-0">
          <CardTitle className={cn(typography.caption, 'text-foreground')}>Plugin runtime</CardTitle>
          <CardDescription className={typography.bodyMicro}>{pluginName}</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 px-3 py-0 sm:grid-cols-4">
          <MetricTile label="Tick" value={String(metrics.tickCount)} />
          <MetricTile label="Players" value={String(metrics.playerCount)} />
          <MetricTile label="Last event" value={metrics.lastPluginEvent} />
          <MetricTile
            label="Last tick"
            value={formatDrawerTimestamp(metrics.lastTickAtMs)}
          />
        </CardContent>
      </Card>
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="success">Live</Badge>
        <Badge variant="info">{pluginName}</Badge>
      </div>
    </div>
  );
}

function MetricTile({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-2 py-1.5">
      <p className={typography.sectionLabelMicro}>{label}</p>
      <p className={cn(typography.caption, 'truncate font-medium text-foreground')}>{value}</p>
    </div>
  );
}
