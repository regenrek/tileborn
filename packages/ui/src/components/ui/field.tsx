import * as React from 'react';

import { cn } from '../../lib/utils.js';

function FieldGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="field-group" className={cn('flex flex-col gap-4', className)} {...props} />
  );
}

function Field({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="field" className={cn('flex flex-col gap-1.5', className)} {...props} />;
}

function FieldLabel({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label data-slot="field-label" className={cn('text-sm font-medium', className)} {...props} />
  );
}

function FieldDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="field-description"
      className={cn('text-xs text-muted-foreground', className)}
      {...props}
    />
  );
}

function FieldSet({ className, ...props }: React.ComponentProps<'fieldset'>) {
  return (
    <fieldset data-slot="fieldset" className={cn('flex flex-col gap-3', className)} {...props} />
  );
}

function FieldLegend({ className, ...props }: React.ComponentProps<'legend'>) {
  return (
    <legend data-slot="field-legend" className={cn('text-sm font-medium', className)} {...props} />
  );
}

export { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet };
