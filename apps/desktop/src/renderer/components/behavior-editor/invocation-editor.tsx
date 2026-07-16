import type {
  BehaviorInvocation,
  BehaviorParameterMetadata,
  BehaviorReference,
  BehaviorRegistryEntry,
  BehaviorRegistryEntryKind,
  BehaviorStateField,
  BehaviorValueExpression,
  JsonValue,
} from '@tileborne/core';
import {
  BehaviorInvocation as BehaviorInvocationValue,
  EventFieldBehaviorValue,
  LiteralBehaviorValue,
  ReferenceBehaviorValue,
  StateBehaviorValue,
} from '@tileborne/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  cn,
  typography,
} from '@tileborne/ui';
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, SearchIcon } from 'lucide-react';
import { useDeferredValue, useEffect, useRef, useState } from 'react';

import { BEHAVIOR_REFERENCE_PAGE_SIZE, useBehaviorReferences } from '@/hooks/queries';

import { BehaviorBlockIcon } from './block-icon';
import { BehaviorBlockPicker } from './block-picker';
import { convertExpression, expressionForParameter, invocationForEntry, type BehaviorEditorIssue } from './model';

export interface BehaviorReferenceOption {
  readonly id: string;
  readonly label: string;
  readonly reference: BehaviorReference;
  readonly previewUrl?: string | undefined;
  readonly detail?: string | undefined;
}

export type BehaviorReferenceOptions = Partial<
  Record<BehaviorReference['_tag'], readonly BehaviorReferenceOption[]>
>;

const selectClass = 'h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50';

const referenceKindFor = (
  parameter: BehaviorParameterMetadata,
): BehaviorReference['_tag'] | undefined => {
  switch (parameter.valueKind) {
    case 'entity-reference': return 'entity';
    case 'asset-reference': return 'asset';
    case 'catalog-reference': return 'catalog';
    case 'behavior-reference': return 'behavior';
    default: return undefined;
  }
};

const referenceId = (reference: BehaviorReference): string => {
  switch (reference._tag) {
    case 'entity': return String(reference.objectId);
    case 'asset': return String(reference.assetId);
    case 'catalog': return String(reference.objectTypeId);
    case 'behavior': return String(reference.behaviorId);
  }
};

export function BehaviorReferencePicker({
  open,
  projectId,
  kind,
  selectedId,
  onOpenChange,
  onPick,
}: {
  readonly open: boolean;
  readonly projectId: string;
  readonly kind: BehaviorReference['_tag'];
  readonly selectedId?: string | undefined;
  readonly onOpenChange: (open: boolean) => void;
  readonly onPick: (option: BehaviorReferenceOption) => void;
}) {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [offset, setOffset] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  useEffect(() => setOffset(0), [deferredQuery, kind]);
  const page = useBehaviorReferences({
    projectId,
    kind,
    query: deferredQuery,
    offset,
    limit: BEHAVIOR_REFERENCE_PAGE_SIZE,
    enabled: open,
  });
  const options = page.data?.options ?? [];
  const virtualizer = useVirtualizer({
    count: options.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => 52,
    overscan: 6,
    initialRect: { width: 560, height: 320 },
  });
  const virtualRows = virtualizer.getVirtualItems();
  const rows = virtualRows.length === 0
    ? options.slice(0, 12).map((_, index) => ({ index, key: index, size: 52, start: index * 52 }))
    : virtualRows;
  const total = page.data?.total ?? 0;
  const hasPrevious = offset > 0;
  const hasNext = offset + options.length < total;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl overflow-hidden" data-testid="behavior-reference-picker">
        <DialogHeader>
          <DialogTitle>Choose {kind}</DialogTitle>
          <DialogDescription>Search project references. Results load in bounded pages.</DialogDescription>
        </DialogHeader>
        <label className="relative block">
          <SearchIcon className="pointer-events-none absolute left-2 top-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            aria-label={`Search ${kind} references`}
            placeholder={`Search ${kind}…`}
            className="pl-8"
          />
        </label>
        <div
          ref={viewportRef}
          role="listbox"
          aria-label={`${kind} references`}
          className="h-80 overflow-auto rounded-md border"
          data-testid="behavior-reference-virtual-list"
        >
          {page.isLoading ? (
            <div className="p-5 text-center text-sm text-muted-foreground">Loading references…</div>
          ) : page.isError ? (
            <div role="alert" className="p-5 text-center text-sm text-destructive">Could not load references.</div>
          ) : options.length === 0 ? (
            <div className="p-5 text-center text-sm text-muted-foreground">No matching references.</div>
          ) : (
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {rows.map((row) => {
                const option = options[row.index]!;
                const selected = option.id === selectedId;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={cn(
                      'absolute left-0 top-0 flex w-full items-center gap-3 border-b px-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                      selected && 'bg-primary/10',
                    )}
                    style={{ height: row.size, transform: `translateY(${row.start}px)` }}
                    onClick={() => {
                      onPick(option);
                      onOpenChange(false);
                    }}
                  >
                    {option.previewUrl === undefined ? null : <img src={option.previewUrl} alt="" className="size-9 shrink-0 rounded object-contain" />}
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate', typography.rowTitle)}>{option.label}</span>
                      {option.detail === undefined ? null : <span className={cn('block truncate text-muted-foreground', typography.bodyMicro)}>{option.detail}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>{total === 0 ? '0 results' : `${offset + 1}–${Math.min(offset + options.length, total)} of ${total}`}</span>
          <div className="flex gap-1">
            <Button type="button" size="sm" variant="outline" disabled={!hasPrevious || page.isFetching} onClick={() => setOffset(Math.max(0, offset - BEHAVIOR_REFERENCE_PAGE_SIZE))}>
              <ChevronLeftIcon className="size-3.5" aria-hidden /> Previous
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={!hasNext || page.isFetching} onClick={() => setOffset(offset + BEHAVIOR_REFERENCE_PAGE_SIZE)}>
              Next <ChevronRightIcon className="size-3.5" aria-hidden />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function JsonLiteralInput({ value, onChange, invalid, describedBy }: {
  readonly value: JsonValue;
  readonly onChange: (value: JsonValue) => void;
  readonly invalid?: boolean;
  readonly describedBy?: string | undefined;
}) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  const [draft, setDraft] = useState(serialized);
  useEffect(() => setDraft(serialized), [serialized]);
  return (
    <Input
      value={draft}
      aria-label="JSON value"
      aria-invalid={invalid}
      aria-describedby={describedBy}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={() => {
        try {
          onChange(JSON.parse(draft) as JsonValue);
        } catch {
          onChange(draft);
        }
      }}
    />
  );
}

function ArgumentEditor({
  parameter,
  expression,
  state,
  references,
  projectId,
  onReferenceOption,
  path,
  issues,
  onChange,
}: {
  readonly parameter: BehaviorParameterMetadata;
  readonly expression: BehaviorValueExpression | undefined;
  readonly state: readonly BehaviorStateField[];
  readonly references: BehaviorReferenceOptions;
  readonly projectId?: string | undefined;
  readonly onReferenceOption?: ((option: BehaviorReferenceOption) => void) | undefined;
  readonly path: string;
  readonly issues: readonly BehaviorEditorIssue[];
  readonly onChange: (value: BehaviorValueExpression | undefined) => void;
}) {
  const referenceKind = referenceKindFor(parameter);
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const referenceOptions = referenceKind === undefined ? [] : references[referenceKind] ?? [];
  const selectedReferenceOption = expression?._tag === 'reference'
    ? referenceOptions.find((option) => option.id === referenceId(expression.reference))
    : undefined;
  const parameterReferences: Partial<Record<BehaviorReference['_tag'], readonly BehaviorReference[]>> =
    referenceKind === undefined ? {} : { [referenceKind]: referenceOptions.map(({ reference }) => reference) };
  const modes = [
    ...(!parameter.required ? [{ value: 'unset', label: 'Any / unset' }] : []),
    { value: 'literal', label: 'Value' },
    ...(state.length === 0 ? [] : [{ value: 'state', label: 'State' }]),
    { value: 'event-field', label: 'Event' },
    ...(referenceKind === undefined ? [] : [{ value: 'reference', label: 'Reference' }]),
  ] as const;
  const fieldIssues = issues.filter((issue) => issue.path === path);
  const issueId = fieldIssues.length === 0 ? undefined : `behavior-issue-${path.replaceAll(/[^A-Za-z0-9_-]/g, '-')}`;
  const invalidProps = { 'aria-invalid': fieldIssues.length > 0 || undefined, 'aria-describedby': issueId } as const;
  return (
    <div className="grid gap-1.5 sm:grid-cols-[minmax(7rem,0.8fr)_7rem_minmax(10rem,1.5fr)] sm:items-center" data-issue-path={path}>
      <Label className={typography.bodyMicro}>{parameter.label}{parameter.required ? ' *' : ''}</Label>
      <select
        className={selectClass}
        aria-label={`${parameter.label} source`}
        {...invalidProps}
        value={expression?._tag ?? 'unset'}
        onChange={(event) => {
          if (event.currentTarget.value === 'unset') {
            onChange(undefined);
            return;
          }
          const mode = event.currentTarget.value as BehaviorValueExpression['_tag'];
          if (mode === 'reference' && referenceKind !== undefined && projectId !== undefined) {
            setReferencePickerOpen(true);
            return;
          }
          const current = expression ?? expressionForParameter(parameter, parameterReferences);
          onChange(convertExpression(mode, parameter, current, referenceOptions[0]?.reference));
        }}
      >
        {modes.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
      </select>
      {expression === undefined ? (
        <span className="text-xs text-muted-foreground">Matches any {parameter.label.toLowerCase()}</span>
      ) : expression._tag === 'literal' ? (
        parameter.valueKind === 'boolean' ? (
          <select
            className={selectClass}
            value={String(expression.value)}
            aria-label={parameter.label}
            {...invalidProps}
            onChange={(event) => onChange(new LiteralBehaviorValue({ value: event.currentTarget.value === 'true' }))}
          >
            <option value="false">False</option><option value="true">True</option>
          </select>
        ) : parameter.valueKind === 'number' ? (
          <Input
            type="number"
            value={typeof expression.value === 'number' ? expression.value : 0}
            aria-label={parameter.label}
            {...invalidProps}
            onChange={(event) => onChange(new LiteralBehaviorValue({ value: Number(event.currentTarget.value) }))}
          />
        ) : parameter.valueKind === 'json' ? (
          <JsonLiteralInput value={expression.value} invalid={fieldIssues.length > 0} describedBy={issueId} onChange={(value) => onChange(new LiteralBehaviorValue({ value }))} />
        ) : (
          <Input
            value={typeof expression.value === 'string' ? expression.value : ''}
            aria-label={parameter.label}
            {...invalidProps}
            onChange={(event) => onChange(new LiteralBehaviorValue({ value: event.currentTarget.value }))}
          />
        )
      ) : expression._tag === 'state' ? (
        <select
          className={selectClass}
          value={expression.key}
          aria-label={parameter.label}
          {...invalidProps}
          onChange={(event) => onChange(new StateBehaviorValue({ key: event.currentTarget.value }))}
        >
          <option value="">Choose state…</option>
          {state.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
        </select>
      ) : expression._tag === 'event-field' ? (
        <Input
          value={expression.path}
          placeholder="event.field"
          aria-label={parameter.label}
          {...invalidProps}
          onChange={(event) => onChange(new EventFieldBehaviorValue({ path: event.currentTarget.value }))}
        />
      ) : projectId !== undefined && referenceKind !== undefined ? (
        <Button
          type="button"
          variant="outline"
          className="h-8 min-w-0 justify-between px-2 text-xs"
          aria-label={parameter.label}
          onClick={() => setReferencePickerOpen(true)}
        >
          {selectedReferenceOption?.previewUrl === undefined ? null : <img src={selectedReferenceOption.previewUrl} alt="" className="size-6 shrink-0 rounded object-contain" />}
          <span className="min-w-0 flex-1 truncate text-left">{selectedReferenceOption?.label ?? referenceId(expression.reference)}</span>
          <ChevronDownIcon className="size-3.5 shrink-0" aria-hidden />
        </Button>
      ) : (
        <div className="flex items-center gap-2">
          {referenceOptions.find((option) => option.id === referenceId(expression.reference))?.previewUrl === undefined ? null : (
            <img
              src={referenceOptions.find((option) => option.id === referenceId(expression.reference))!.previewUrl}
              alt=""
              className="size-8 rounded object-contain"
            />
          )}
          <select
            className={cn(selectClass, 'min-w-0 flex-1')}
            value={referenceId(expression.reference)}
            aria-label={parameter.label}
            {...invalidProps}
            onChange={(event) => {
              const reference = referenceOptions.find((option) => option.id === event.currentTarget.value)?.reference;
              if (reference !== undefined) onChange(new ReferenceBehaviorValue({ reference }));
            }}
          >
            <option value="">Choose {referenceKind}…</option>
            {referenceOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </div>
      )}
      {projectId === undefined || referenceKind === undefined ? null : (
        <BehaviorReferencePicker
          open={referencePickerOpen}
          projectId={projectId}
          kind={referenceKind}
          selectedId={expression?._tag === 'reference' ? referenceId(expression.reference) : undefined}
          onOpenChange={setReferencePickerOpen}
          onPick={(option) => {
            onReferenceOption?.(option);
            onChange(new ReferenceBehaviorValue({ reference: option.reference }));
          }}
        />
      )}
      {fieldIssues.length === 0 ? null : <div id={issueId} role="alert" className="text-xs text-destructive sm:col-start-3">{fieldIssues.map(({ message }) => message).join('. ')}</div>}
    </div>
  );
}

export function BehaviorInvocationEditor({
  kind,
  invocation,
  entries,
  state,
  references,
  projectId,
  onReferenceOption,
  path,
  issues = [],
  onChange,
}: {
  readonly kind: BehaviorRegistryEntryKind;
  readonly invocation: BehaviorInvocation;
  readonly entries: readonly BehaviorRegistryEntry[];
  readonly state: readonly BehaviorStateField[];
  readonly references: BehaviorReferenceOptions;
  readonly projectId?: string | undefined;
  readonly onReferenceOption?: ((option: BehaviorReferenceOption) => void) | undefined;
  readonly path: string;
  readonly issues?: readonly BehaviorEditorIssue[];
  readonly onChange: (invocation: BehaviorInvocation) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const entry = entries.find(({ id }) => id === invocation.entryId);
  const changeArgument = (key: string, value: BehaviorValueExpression | undefined) => {
    const argumentsValue = { ...invocation.arguments };
    if (value === undefined) delete argumentsValue[key];
    else argumentsValue[key] = value;
    onChange(new BehaviorInvocationValue({ entryId: invocation.entryId, arguments: argumentsValue }));
  };
  const availableReferences = (parameter: BehaviorParameterMetadata): Partial<
    Record<BehaviorReference['_tag'], readonly BehaviorReference[]>
  > => {
    const kind = referenceKindFor(parameter);
    return kind === undefined ? {} : { [kind]: (references[kind] ?? []).map(({ reference }) => reference) };
  };
  return (
    <div className="space-y-3">
      <Button
        type="button"
        variant="outline"
        className="h-auto w-full justify-start gap-3 px-3 py-2 text-left"
        onClick={() => setPickerOpen(true)}
        aria-label={`Choose ${kind} block`}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
          <BehaviorBlockIcon name={entry?.icon} />
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block', typography.rowTitle)}>{entry?.label ?? String(invocation.entryId)}</span>
          <span className={cn('block truncate text-muted-foreground', typography.bodyMicro)}>{entry?.description ?? 'Unavailable capability'}</span>
        </span>
        <ChevronDownIcon className="size-4 text-muted-foreground" aria-hidden />
      </Button>
      {entry?.inputs.map((parameter) => (
        <ArgumentEditor
          key={parameter.key}
          parameter={parameter}
          expression={invocation.arguments[parameter.key] ?? (parameter.required
            ? expressionForParameter(parameter, availableReferences(parameter))
            : undefined)}
          state={state}
          references={references}
          projectId={projectId}
          onReferenceOption={onReferenceOption}
          path={`${path}.${parameter.key}`}
          issues={issues}
          onChange={(value) => changeArgument(parameter.key, value)}
        />
      ))}
      <BehaviorBlockPicker
        open={pickerOpen}
        kind={kind}
        entries={entries}
        onOpenChange={setPickerOpen}
        onPick={(nextEntry) => onChange(invocationForEntry(nextEntry, {}, Object.fromEntries(
          (['entity', 'asset', 'catalog', 'behavior'] as const).map((referenceKind) => [
            referenceKind,
            (references[referenceKind] ?? []).map(({ reference }) => reference),
          ]),
        )))}
      />
    </div>
  );
}
