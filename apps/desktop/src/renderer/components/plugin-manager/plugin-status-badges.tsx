import { Badge, cn, typography } from '@tileborne/ui';

import {
  formatPluginLifecycleStatus,
  resolvePluginLifecycleStatus,
  type PluginLifecycleStatus,
} from '@/lib/plugin-status';

interface PluginStatusBadgesProps {
  readonly enabled: boolean;
  readonly version: string;
  readonly manifestFailed?: boolean;
  readonly className?: string;
}

const lifecycleBadgeVariant = (status: PluginLifecycleStatus) => {
  switch (status) {
    case 'enabled':
      return 'success' as const;
    case 'disabled':
      return 'muted' as const;
    case 'update-available':
      return 'warning' as const;
    case 'failed':
      return 'destructive' as const;
  }
};

export function PluginStatusBadges({
  enabled,
  version,
  manifestFailed = false,
  className,
}: PluginStatusBadgesProps) {
  const lifecycleStatus = resolvePluginLifecycleStatus({
    enabled,
    version,
    manifestFailed,
  });

  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      <Badge variant="secondary" className={typography.micro}>
        Installed
      </Badge>
      <Badge variant={lifecycleBadgeVariant(lifecycleStatus)} className={typography.micro}>
        {formatPluginLifecycleStatus(lifecycleStatus)}
      </Badge>
    </div>
  );
}
