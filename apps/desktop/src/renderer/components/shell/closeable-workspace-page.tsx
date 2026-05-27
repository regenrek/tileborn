import { ScrollArea, cn, typography } from '@tileborne/ui';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

interface CloseableWorkspacePageProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly maxWidthClassName?: string;
}

/**
 * Layout shell for workspace pages that render inside the tabbed shell.
 * The tab strip in {@link WorkspaceTabBar} owns the close affordance, so this
 * wrapper deliberately only handles title/actions/scroll layout.
 */
export function CloseableWorkspacePage({
  title,
  description,
  actions,
  maxWidthClassName = 'max-w-6xl',
  className,
  children,
  ...props
}: CloseableWorkspacePageProps) {
  return (
    <ScrollArea className="h-full">
      <div
        className={cn(
          'mx-auto flex min-h-full w-full flex-col gap-6 p-8',
          maxWidthClassName,
          className,
        )}
        {...props}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">{title}</h1>
            {description ? <p className={typography.bodyCompact}>{description}</p> : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
          ) : null}
        </div>

        {children}
      </div>
    </ScrollArea>
  );
}
