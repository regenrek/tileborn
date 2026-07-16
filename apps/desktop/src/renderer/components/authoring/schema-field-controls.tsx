import type {
  AuthoringFieldSchema,
  AuthoringReferenceTarget,
  JsonObject,
  JsonValue,
} from '@tileborne/core';
import { validateAuthoringValues } from '@tileborne/core';
import { Checkbox, Input, Label, cn, typography } from '@tileborne/ui';

export interface AuthoringReferenceOption {
  readonly id: string;
  readonly label: string;
  readonly previewUrl?: string;
}

export type AuthoringReferenceOptions = Partial<
  Record<AuthoringReferenceTarget, readonly AuthoringReferenceOption[]>
>;

interface SchemaFieldControlsProps {
  readonly fields: readonly AuthoringFieldSchema[];
  readonly values: JsonObject;
  readonly references?: AuthoringReferenceOptions;
  readonly disabled?: boolean;
  readonly testIdPrefix?: string;
  readonly onChange: (values: JsonObject) => void;
}

const selectClassName =
  'h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50';

const objectValue = (value: JsonValue | undefined): JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonObject : {};

function FieldControl({
  field,
  value,
  references,
  disabled,
  testId,
  onChange,
}: {
  readonly field: AuthoringFieldSchema;
  readonly value: JsonValue | undefined;
  readonly references: AuthoringReferenceOptions;
  readonly disabled: boolean;
  readonly testId: string;
  readonly onChange: (value: JsonValue) => void;
}) {
  if (field.kind === 'group') {
    const group = objectValue(value);
    return (
      <fieldset className="space-y-2 rounded-md border border-border/70 p-2" data-testid={testId}>
        <legend className={cn('px-1', typography.rowTitle)}>{field.label}</legend>
        {field.help === undefined ? null : <p className={typography.bodyMicro}>{field.help}</p>}
        <SchemaFieldControls
          fields={field.fields}
          values={group}
          references={references}
          disabled={disabled}
          testIdPrefix={testId}
          onChange={onChange}
        />
      </fieldset>
    );
  }
  if (field.kind === 'optional') {
    const enabled = value !== undefined && value !== null;
    return (
      <div className="space-y-2 rounded-md border border-border/70 p-2" data-testid={testId}>
        <label className="flex items-center gap-2">
          <Checkbox
            checked={enabled}
            disabled={disabled}
            onCheckedChange={(checked) => onChange(checked === true ? field.field.kind === 'group' ? {} : field.field.kind === 'reference' ? field.field.default ?? '' : field.field.kind === 'optional' ? null : field.field.default : null)}
          />
          <span className={typography.rowTitle}>{field.label}</span>
        </label>
        {enabled ? (
          <FieldControl
            field={field.field}
            value={value}
            references={references}
            disabled={disabled}
            testId={`${testId}-value`}
            onChange={onChange}
          />
        ) : null}
      </div>
    );
  }

  const describedBy = field.help === undefined ? undefined : `${testId}-help`;
  const label = <Label htmlFor={testId}>{field.label}</Label>;
  let control;
  if (field.kind === 'number') {
    control = (
      <Input
        id={testId}
        data-testid={testId}
        type="number"
        value={typeof value === 'number' ? value : field.default}
        min={field.min}
        max={field.max}
        step={field.step ?? (field.integer === true ? 1 : undefined)}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          if (Number.isFinite(next)) onChange(next);
        }}
      />
    );
  } else if (field.kind === 'text') {
    control = field.multiline === true ? (
      <textarea
        id={testId}
        data-testid={testId}
        className={cn(selectClassName, 'min-h-20 py-1')}
        value={typeof value === 'string' ? value : field.default}
        minLength={field.minLength}
        maxLength={field.maxLength}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    ) : (
      <Input
        id={testId}
        data-testid={testId}
        value={typeof value === 'string' ? value : field.default}
        minLength={field.minLength}
        maxLength={field.maxLength}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    );
  } else if (field.kind === 'boolean') {
    control = (
      <Checkbox
        id={testId}
        data-testid={testId}
        checked={typeof value === 'boolean' ? value : field.default}
        disabled={disabled}
        aria-describedby={describedBy}
        onCheckedChange={(checked) => onChange(checked === true)}
      />
    );
  } else {
    const options: readonly AuthoringReferenceOption[] = field.kind === 'enum'
      ? field.options.map((option) => ({ id: option.value, label: option.label }))
      : references[field.target] ?? [];
    const selected = typeof value === 'string'
      ? value
      : field.kind === 'enum'
        ? field.default
        : field.default ?? '';
    const selectedReference = field.kind === 'reference'
      ? options.find((option) => option.id === selected)
      : undefined;
    control = (
      <div className="flex items-center gap-2">
        {selectedReference?.previewUrl === undefined ? null : (
          <img src={selectedReference.previewUrl} alt="" className="size-8 rounded object-contain" />
        )}
        <select
          id={testId}
          data-testid={testId}
          className={selectClassName}
          value={selected}
          disabled={disabled}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.currentTarget.value)}
        >
          {field.kind === 'reference' && field.allowNone === true ? <option value="">None</option> : null}
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <div className={field.kind === 'boolean' ? 'flex items-center gap-2' : 'space-y-1'}>
        {field.kind === 'boolean' ? control : label}
        {field.kind === 'boolean' ? label : control}
      </div>
      {field.help === undefined ? null : (
        <p id={describedBy} className={cn('text-muted-foreground', typography.bodyMicro)}>{field.help}</p>
      )}
    </div>
  );
}

/** Generic recursive editor for all durable AuthoringFieldSchema kinds. */
export function SchemaFieldControls({
  fields,
  values,
  references = {},
  disabled = false,
  testIdPrefix = 'authoring-field',
  onChange,
}: SchemaFieldControlsProps) {
  const referenceIndex = Object.fromEntries(
    Object.entries(references).map(([target, options]) => [target, new Set(options.map((option) => option.id))]),
  );
  const validation = validateAuthoringValues(fields, values, referenceIndex);
  return (
    <div className="space-y-2" data-testid={`${testIdPrefix}-controls`} data-valid={validation.ok}>
      {fields.map((field) => (
        <FieldControl
          key={field.key}
          field={field}
          value={values[field.key]}
          references={references}
          disabled={disabled}
          testId={`${testIdPrefix}-${field.key}`}
          onChange={(value) => onChange({ ...values, [field.key]: value })}
        />
      ))}
      {validation.issues.length === 0 ? null : (
        <ul className={cn('text-destructive', typography.bodyMicro)}>
          {validation.issues.map((issue) => <li key={`${issue.path}:${issue.message}`}>{issue.message}</li>)}
        </ul>
      )}
    </div>
  );
}
