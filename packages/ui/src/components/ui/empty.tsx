import * as React from 'react';

import { cn } from '../../lib/utils.js';

function Empty({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="empty"
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center',
        className,
      )}
      {...props}
    />
  );
}

function EmptyHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="empty-header" className={cn('flex flex-col gap-1', className)} {...props} />
  );
}

function EmptyTitle({ className, ...props }: React.ComponentProps<'h3'>) {
  return <h3 data-slot="empty-title" className={cn('text-sm font-medium', className)} {...props} />;
}

function EmptyDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="empty-description"
      className={cn('max-w-sm text-xs text-muted-foreground', className)}
      {...props}
    />
  );
}

function EmptyContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="empty-content"
      className={cn('flex items-center gap-2', className)}
      {...props}
    />
  );
}

export { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle };
