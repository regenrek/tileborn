import { Button, cn, Label } from '@tileborne/ui';
import { Loader2Icon } from 'lucide-react';
import { useCallback, type ReactNode } from 'react';

export function FormMessage({
  message,
  className,
}: {
  readonly message?: string | undefined;
  readonly className?: string;
}) {
  if (message === undefined || message.length === 0) {
    return null;
  }
  return (
    <p role="alert" className={cn('text-xs text-destructive', className)}>
      {message}
    </p>
  );
}

export function FormField({
  label,
  htmlFor,
  children,
  message,
  className,
}: {
  readonly label: string;
  readonly htmlFor: string;
  readonly children: ReactNode;
  readonly message?: string | undefined;
  readonly className?: string;
}) {
  return (
    <div className={cn('grid gap-2', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      <FormMessage message={message} />
    </div>
  );
}

export function usePendingDialogClose(
  isPending: boolean,
  onOpenChange: (open: boolean) => void,
): (open: boolean) => void {
  return useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && isPending) {
        return;
      }
      onOpenChange(nextOpen);
    },
    [isPending, onOpenChange],
  );
}

export function DialogSubmitButton({
  pending,
  disabled,
  children,
  ...props
}: React.ComponentProps<typeof Button> & {
  readonly pending: boolean;
}) {
  return (
    <Button type="submit" disabled={disabled || pending} {...props}>
      {pending ? <Loader2Icon className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </Button>
  );
}
