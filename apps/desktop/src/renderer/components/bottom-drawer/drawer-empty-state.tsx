import { Button, cn, typography } from '@tileborne/ui';
import type { LucideIcon } from 'lucide-react';

interface DrawerEmptyStateProps {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly description: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  readonly actionDisabled?: boolean;
  readonly className?: string;
}

export function DrawerEmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  actionDisabled,
  className,
}: DrawerEmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-md border border-dashed border-border bg-card/50 px-4 py-6 text-center',
        className,
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-md bg-muted">
        <Icon className="size-5 text-muted-foreground" aria-hidden />
      </div>
      <div className="space-y-1">
        <p className={cn(typography.caption, 'font-medium text-foreground')}>{title}</p>
        <p className={typography.bodyCompact}>{description}</p>
      </div>
      {actionLabel && onAction ? (
        <Button size="sm" disabled={actionDisabled} onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
