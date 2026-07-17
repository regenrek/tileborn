import * as React from 'react';

import { cn } from '../../lib/utils.js';

function Checkbox({
  className,
  checked,
  onCheckedChange,
  ...props
}: Omit<React.ComponentProps<'input'>, 'type' | 'onChange'> & {
  readonly onCheckedChange?: (checked: boolean) => void;
}) {
  return (
    <input
      data-slot="checkbox"
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange?.(event.currentTarget.checked)}
      className={cn('size-4 rounded border border-input accent-primary', className)}
      {...props}
    />
  );
}

export { Checkbox };
