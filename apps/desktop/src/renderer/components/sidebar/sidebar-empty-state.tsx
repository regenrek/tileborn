import { Button, cn, typography } from '@tileborne/ui';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface SidebarEmptyStateProps {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly description: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  readonly actionDisabled?: boolean;
  readonly actionTestId?: string;
  readonly secondaryAction?: ReactNode;
  readonly className?: string;
}

export function SidebarEmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  actionDisabled,
  actionTestId,
  secondaryAction,
  className,
}: SidebarEmptyStateProps) {
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
        <Button size="sm" data-testid={actionTestId} disabled={actionDisabled} onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
      {secondaryAction}
    </div>
  );
}
