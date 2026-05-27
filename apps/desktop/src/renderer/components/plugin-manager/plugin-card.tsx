import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Switch,
  cn,
  motion,
  typography,
} from '@tileborne/ui';
import { PuzzleIcon } from 'lucide-react';

import type { PluginsListResponse } from '@/lib/bridge-types';

import { PluginStatusBadges } from './plugin-status-badges';

type PluginSummary = PluginsListResponse['plugins'][number];

interface PluginCardProps {
  readonly plugin: PluginSummary;
  readonly selected: boolean;
  readonly manifestFailed?: boolean;
  readonly togglePending?: boolean;
  readonly onSelect: () => void;
  readonly onToggleEnabled: (enabled: boolean) => void;
}

export function PluginCard({
  plugin,
  selected,
  manifestFailed = false,
  togglePending = false,
  onSelect,
  onToggleEnabled,
}: PluginCardProps) {
  return (
    <Card
      data-testid={`plugin-card-${plugin.id}`}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'cursor-pointer gap-3 py-3',
        motion.fast,
        'hover:border-primary/40 hover:bg-muted/20',
        selected && 'border-primary ring-1 ring-primary/30',
      )}
    >
      <CardHeader className="gap-3 px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
              <PuzzleIcon className="size-4 text-muted-foreground" aria-hidden />
            </div>
            <div className="min-w-0">
              <CardTitle className={cn('truncate text-sm', typography.caption)}>
                {plugin.id}
              </CardTitle>
              <CardDescription className={typography.bodyMicro}>v{plugin.version}</CardDescription>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Switch
              checked={plugin.enabled}
              disabled={togglePending}
              aria-label={plugin.enabled ? 'Disable plugin' : 'Enable plugin'}
              onCheckedChange={onToggleEnabled}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            />
          </div>
        </div>
        <PluginStatusBadges
          enabled={plugin.enabled}
          version={plugin.version}
          manifestFailed={manifestFailed}
        />
      </CardHeader>
    </Card>
  );
}
