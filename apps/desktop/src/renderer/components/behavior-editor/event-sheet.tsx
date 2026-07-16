import {
  BehaviorStateField,
  type BehaviorActionNode,
  type BehaviorCondition,
  type BehaviorRegistryEntry,
  type JsonValue,
} from '@tileborne/core';
import { Badge, Button, Input, Label, cn, typography } from '@tileborne/ui';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BracesIcon,
  GitBranchIcon,
  GripVerticalIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import { useState } from 'react';

import { BehaviorBlockPicker } from './block-picker';
import {
  BehaviorInvocationEditor,
  type BehaviorReferenceOption,
  type BehaviorReferenceOptions,
} from './invocation-editor';
import { freshBehaviorNodeId, invocationForEntry, type BehaviorEditorIssue, type VisualBehaviorDraft } from './model';

const firstEntry = (entries: readonly BehaviorRegistryEntry[], kind: BehaviorRegistryEntry['kind']) => {
  const entry = entries.find((candidate) => candidate.kind === kind);
  if (entry === undefined) throw new Error(`No ${kind} block is available.`);
  return entry;
};

const newCondition = (entries: readonly BehaviorRegistryEntry[]): BehaviorCondition => ({
  _tag: 'condition',
  nodeId: freshBehaviorNodeId(),
  invocation: invocationForEntry(firstEntry(entries, 'condition')),
});

function AddActionButton({ entries, onAdd }: {
  readonly entries: readonly BehaviorRegistryEntry[];
  readonly onAdd: (entry: BehaviorRegistryEntry) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <PlusIcon className="size-3.5" aria-hidden /> Add action
      </Button>
      <BehaviorBlockPicker open={open} kind="action" entries={entries} onOpenChange={setOpen} onPick={onAdd} />
    </>
  );
}

function ConditionNode({ condition, entries, state, references, projectId, onReferenceOption, path, issues, onChange, onRemove }: {
  readonly condition: BehaviorCondition;
  readonly entries: readonly BehaviorRegistryEntry[];
  readonly state: VisualBehaviorDraft['state'];
  readonly references: BehaviorReferenceOptions;
  readonly projectId?: string | undefined;
  readonly onReferenceOption?: ((option: BehaviorReferenceOption) => void) | undefined;
  readonly path: string;
  readonly issues: readonly BehaviorEditorIssue[];
  readonly onChange: (condition: BehaviorCondition) => void;
  readonly onRemove?: (() => void) | undefined;
}) {
  const wrap = (tag: 'all' | 'any' | 'not') => {
    if (tag === 'not') onChange({ _tag: 'not', nodeId: freshBehaviorNodeId(), condition });
    else onChange({ _tag: tag, nodeId: freshBehaviorNodeId(), conditions: [condition] });
  };
  const nodeIssues = issues.filter((issue) => issue.nodeId === condition.nodeId && issue.path === path);
  return (
    <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/[0.04] p-3" data-node-id={condition.nodeId} data-issue-path={path} tabIndex={-1} aria-invalid={nodeIssues.length > 0 || undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="border-amber-500/40 text-amber-600">{condition._tag.toUpperCase()}</Badge>
        <span className={cn('text-muted-foreground', typography.bodyMicro)}>IF condition</span>
        <div className="ml-auto flex items-center gap-1">
          {condition._tag === 'condition' ? (
            <>
              <Button type="button" size="sm" variant="ghost" onClick={() => wrap('all')}>ALL</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => wrap('any')}>ANY</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => wrap('not')}>NOT</Button>
            </>
          ) : null}
          {onRemove === undefined ? null : (
            <Button type="button" size="icon" variant="ghost" aria-label="Remove condition" onClick={onRemove}>
              <Trash2Icon className="size-3.5" aria-hidden />
            </Button>
          )}
        </div>
      </div>
      {condition._tag === 'condition' ? (
        <BehaviorInvocationEditor
          kind="condition"
          invocation={condition.invocation}
          entries={entries}
          state={state}
          references={references}
          projectId={projectId}
          onReferenceOption={onReferenceOption}
          path={path}
          issues={issues}
          onChange={(invocation) => onChange({ ...condition, invocation })}
        />
      ) : condition._tag === 'not' ? (
        <ConditionNode
          condition={condition.condition}
          entries={entries}
          state={state}
          references={references}
          projectId={projectId}
          onReferenceOption={onReferenceOption}
          path={`${path}.not`}
          issues={issues}
          onChange={(nested) => onChange({ ...condition, condition: nested })}
        />
      ) : (
        <div className="space-y-2 border-l-2 border-amber-500/25 pl-3">
          {condition.conditions.map((nested, index) => (
            <ConditionNode
              key={nested.nodeId}
              condition={nested}
              entries={entries}
              state={state}
              references={references}
              projectId={projectId}
              onReferenceOption={onReferenceOption}
              path={`${path}.${index}`}
              issues={issues}
              onChange={(value) => onChange({ ...condition, conditions: condition.conditions.map((item, itemIndex) => itemIndex === index ? value : item) })}
              onRemove={() => onChange({ ...condition, conditions: condition.conditions.filter((_, itemIndex) => itemIndex !== index) })}
            />
          ))}
          <Button type="button" size="sm" variant="outline" onClick={() => onChange({ ...condition, conditions: [...condition.conditions, newCondition(entries)] })}>
            <PlusIcon className="size-3.5" aria-hidden /> Add condition
          </Button>
        </div>
      )}
      {nodeIssues.map((issue) => <p key={`${issue.path}:${issue.message}`} role="alert" className="text-xs text-destructive">{issue.message}</p>)}
    </div>
  );
}

function ActionList({ actions, entries, state, references, projectId, onReferenceOption, path, issues, label, onChange }: {
  readonly actions: readonly BehaviorActionNode[];
  readonly entries: readonly BehaviorRegistryEntry[];
  readonly state: VisualBehaviorDraft['state'];
  readonly references: BehaviorReferenceOptions;
  readonly projectId?: string | undefined;
  readonly onReferenceOption?: ((option: BehaviorReferenceOption) => void) | undefined;
  readonly path: string;
  readonly issues: readonly BehaviorEditorIssue[];
  readonly label: string;
  readonly onChange: (actions: readonly BehaviorActionNode[]) => void;
}) {
  const [dragged, setDragged] = useState<number | undefined>();
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= actions.length) return;
    const next = [...actions];
    const [item] = next.splice(from, 1);
    if (item === undefined) return;
    next.splice(to, 0, item);
    onChange(next);
  };
  return (
    <div className="space-y-2" role="group" aria-label={label}>
      {actions.map((action, index) => {
        const itemPath = `${path}.${index}`;
        const nodeIssues = issues.filter((issue) => issue.nodeId === action.nodeId && issue.path === itemPath);
        return (
        <div
          key={action.nodeId}
          draggable
          onDragStart={() => setDragged(index)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={() => {
            if (dragged !== undefined) move(dragged, index);
            setDragged(undefined);
          }}
          className="rounded-md border border-emerald-500/30 bg-emerald-500/[0.04] p-3"
          data-node-id={action.nodeId}
          data-issue-path={itemPath}
          tabIndex={-1}
          aria-invalid={nodeIssues.length > 0 || undefined}
        >
          <div className="mb-2 flex items-center gap-1">
            <GripVerticalIcon className="size-4 cursor-grab text-muted-foreground" aria-hidden />
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-600">
              {action._tag === 'branch' ? 'BRANCH' : `DO ${index + 1}`}
            </Badge>
            <div className="ml-auto flex items-center gap-1">
              <Button type="button" size="icon" variant="ghost" disabled={index === 0} aria-label="Move action up" onClick={() => move(index, index - 1)}>
                <ArrowUpIcon className="size-3.5" aria-hidden />
              </Button>
              <Button type="button" size="icon" variant="ghost" disabled={index === actions.length - 1} aria-label="Move action down" onClick={() => move(index, index + 1)}>
                <ArrowDownIcon className="size-3.5" aria-hidden />
              </Button>
              <Button type="button" size="icon" variant="ghost" aria-label="Remove action" onClick={() => onChange(actions.filter((_, itemIndex) => itemIndex !== index))}>
                <Trash2Icon className="size-3.5" aria-hidden />
              </Button>
            </div>
          </div>
          {action._tag === 'action' ? (
            <BehaviorInvocationEditor
              kind="action"
              invocation={action.invocation}
              entries={entries}
              state={state}
              references={references}
              projectId={projectId}
              onReferenceOption={onReferenceOption}
              path={itemPath}
              issues={issues}
              onChange={(invocation) => onChange(actions.map((item, itemIndex) => itemIndex === index ? { ...action, invocation } : item))}
            />
          ) : (
            <div className="space-y-3">
              <ConditionNode
                condition={action.condition}
                entries={entries}
                state={state}
                references={references}
                projectId={projectId}
                onReferenceOption={onReferenceOption}
                path={`${itemPath}.if`}
                issues={issues}
                onChange={(condition) => onChange(actions.map((item, itemIndex) => itemIndex === index ? { ...action, condition } : item))}
              />
              <fieldset className="space-y-2 rounded-md border border-border/60 p-3">
                <legend className={cn('px-1 text-emerald-600', typography.rowTitle)}>THEN</legend>
                <ActionList
                  actions={action.then}
                  entries={entries}
                  state={state}
                  references={references}
                  projectId={projectId}
                  onReferenceOption={onReferenceOption}
                  path={`${itemPath}.then`}
                  issues={issues}
                  label="Then actions"
                  onChange={(then) => onChange(actions.map((item, itemIndex) => itemIndex === index ? { ...action, then } : item))}
                />
              </fieldset>
              <fieldset className="space-y-2 rounded-md border border-border/60 p-3">
                <legend className={cn('px-1 text-muted-foreground', typography.rowTitle)}>ELSE</legend>
                <ActionList
                  actions={action.else ?? []}
                  entries={entries}
                  state={state}
                  references={references}
                  projectId={projectId}
                  onReferenceOption={onReferenceOption}
                  path={`${itemPath}.else`}
                  issues={issues}
                  label="Else actions"
                  onChange={(otherwise) => onChange(actions.map((item, itemIndex) => itemIndex === index ? { ...action, else: otherwise } : item))}
                />
              </fieldset>
            </div>
          )}
          {nodeIssues.map((issue) => <p key={`${issue.path}:${issue.message}`} role="alert" className="mt-2 text-xs text-destructive">{issue.message}</p>)}
        </div>
      );})}
      <div className="flex flex-wrap gap-2">
        <AddActionButton
          entries={entries}
          onAdd={(entry) => onChange([...actions, { _tag: 'action', nodeId: freshBehaviorNodeId(), invocation: invocationForEntry(entry) }])}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!entries.some(({ kind }) => kind === 'condition')}
          onClick={() => onChange([...actions, {
            _tag: 'branch',
            nodeId: freshBehaviorNodeId(),
            condition: newCondition(entries),
            then: [],
            else: [],
          }])}
        >
          <GitBranchIcon className="size-3.5" aria-hidden /> Add branch
        </Button>
      </div>
    </div>
  );
}

function StateValueInput({ value, onChange }: { readonly value: JsonValue; readonly onChange: (value: JsonValue) => void }) {
  const [draft, setDraft] = useState(typeof value === 'string' ? value : JSON.stringify(value));
  return (
    <Input
      value={draft}
      aria-label="Initial state value"
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={() => {
        try { onChange(JSON.parse(draft) as JsonValue); } catch { onChange(draft); }
      }}
    />
  );
}

export function BehaviorEventSheet({ draft, entries, references, projectId, onReferenceOption, issues, onChange }: {
  readonly draft: VisualBehaviorDraft;
  readonly entries: readonly BehaviorRegistryEntry[];
  readonly references: BehaviorReferenceOptions;
  readonly projectId?: string | undefined;
  readonly onReferenceOption?: ((option: BehaviorReferenceOption) => void) | undefined;
  readonly issues: readonly BehaviorEditorIssue[];
  readonly onChange: (draft: VisualBehaviorDraft) => void;
}) {
  const errorsFor = (prefix: string) => issues.filter(({ path }) => path === prefix || path.startsWith(`${prefix}.`));
  const focusIssue = (issue: BehaviorEditorIssue) => {
    const candidates = [...document.querySelectorAll<HTMLElement>('[data-issue-path]')];
    const exact = candidates.find((element) => element.dataset.issuePath === issue.path);
    const node = issue.nodeId === undefined ? undefined : [...document.querySelectorAll<HTMLElement>('[data-node-id]')]
      .find((element) => element.dataset.nodeId === String(issue.nodeId));
    const target = exact?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? exact ?? node;
    target?.focus();
    target?.scrollIntoView?.({ block: 'center' });
  };
  const labelIssues = errorsFor('label');
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-5" data-testid="behavior-event-sheet">
      {issues.length === 0 ? null : (
        <div role="region" aria-label="Behavior problems" className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <p className={typography.rowTitle}>Fix before saving</p>
          <ul className="mt-1 space-y-1">{issues.map((issue) => <li key={`${issue.path}:${issue.message}`}><button type="button" className="text-left text-xs text-destructive underline-offset-2 hover:underline" onClick={() => focusIssue(issue)}>{issue.message}</button></li>)}</ul>
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-[8rem_1fr] sm:items-center">
        <Label htmlFor="behavior-label">Name</Label>
        <div data-issue-path="label"><Input id="behavior-label" aria-invalid={labelIssues.length > 0 ? 'true' : undefined} aria-describedby={labelIssues.length > 0 ? 'behavior-label-issues' : undefined} value={draft.label} onChange={(event) => onChange({ ...draft, label: event.currentTarget.value })} />{labelIssues.length === 0 ? null : <p id="behavior-label-issues" role="alert" className="mt-1 text-xs text-destructive">{labelIssues.map(({ message }) => message).join('. ')}</p>}</div>
      </div>

      <section className="space-y-3 rounded-lg border border-sky-500/30 bg-sky-500/[0.04] p-4" aria-labelledby="behavior-when-heading">
        <div className="flex items-center gap-2">
          <Badge className="bg-sky-600">WHEN</Badge>
          <h2 id="behavior-when-heading" className={typography.rowTitle}>Trigger</h2>
        </div>
        <BehaviorInvocationEditor
          kind="event"
          invocation={draft.when}
          entries={entries}
          state={draft.state}
          references={references}
          projectId={projectId}
          onReferenceOption={onReferenceOption}
          path="when"
          issues={issues}
          onChange={(when) => onChange({ ...draft, when })}
        />
        {errorsFor('when').map((issue) => <p key={`${issue.path}:${issue.message}`} className="text-xs text-destructive">{issue.message}</p>)}
      </section>

      <section className="space-y-3 rounded-lg border border-amber-500/30 p-4" aria-labelledby="behavior-if-heading">
        <div className="flex items-center gap-2">
          <Badge className="bg-amber-600">IF</Badge>
          <h2 id="behavior-if-heading" className={typography.rowTitle}>Conditions</h2>
          {draft.if === undefined ? null : (
            <Button className="ml-auto" type="button" size="sm" variant="ghost" onClick={() => onChange({ ...draft, if: undefined })}>Clear</Button>
          )}
        </div>
        {draft.if === undefined ? (
          <div className="rounded-md border border-dashed p-5 text-center">
            <p className="mb-3 text-sm text-muted-foreground">No condition — every matching event runs the actions.</p>
            <Button type="button" size="sm" variant="outline" disabled={!entries.some(({ kind }) => kind === 'condition')} onClick={() => onChange({ ...draft, if: newCondition(entries) })}>
              <PlusIcon className="size-3.5" aria-hidden /> Add condition
            </Button>
          </div>
        ) : (
          <ConditionNode condition={draft.if} entries={entries} state={draft.state} references={references} projectId={projectId} onReferenceOption={onReferenceOption} path="if" issues={issues} onChange={(nextIf) => onChange({ ...draft, if: nextIf })} />
        )}
        {errorsFor('if').map((issue) => <p key={`${issue.path}:${issue.message}`} className="text-xs text-destructive">{issue.message}</p>)}
      </section>

      <section className="space-y-3 rounded-lg border border-emerald-500/30 p-4" aria-labelledby="behavior-do-heading">
        <div className="flex items-center gap-2">
          <Badge className="bg-emerald-600">DO</Badge>
          <h2 id="behavior-do-heading" className={typography.rowTitle}>Actions in order</h2>
        </div>
        {draft.do.length === 0 ? (
          <p className="rounded-md border border-dashed p-5 text-center text-sm text-muted-foreground">Add actions or a nested branch. They execute from top to bottom.</p>
        ) : null}
        <ActionList actions={draft.do} entries={entries} state={draft.state} references={references} projectId={projectId} onReferenceOption={onReferenceOption} path="do" issues={issues} label="Behavior actions" onChange={(actions) => onChange({ ...draft, do: actions })} />
        {errorsFor('do').map((issue) => <p key={`${issue.path}:${issue.message}`} className="text-xs text-destructive">{issue.message}</p>)}
      </section>

      <section className="space-y-3 rounded-lg border p-4" aria-labelledby="behavior-state-heading">
        <div className="flex items-center gap-2">
          <BracesIcon className="size-4 text-violet-500" aria-hidden />
          <h2 id="behavior-state-heading" className={typography.rowTitle}>Local state</h2>
          <Button className="ml-auto" type="button" size="sm" variant="outline" onClick={() => {
            const index = draft.state.length + 1;
            onChange({ ...draft, state: [...draft.state, new BehaviorStateField({ key: `value${index}`, label: `Value ${index}`, initialValue: null })] });
          }}>
            <PlusIcon className="size-3.5" aria-hidden /> Add state
          </Button>
        </div>
        {draft.state.map((field, index) => (
          <div key={`${field.key}:${index}`} className="grid gap-2 rounded-md border p-2 sm:grid-cols-[1fr_1fr_1.2fr_auto] sm:items-center">
            <div data-issue-path={`state.${index}.key`}><Input aria-label="State key" aria-invalid={errorsFor(`state.${index}.key`).length > 0 ? 'true' : undefined} value={field.key} onChange={(event) => onChange({ ...draft, state: draft.state.map((item, itemIndex) => itemIndex === index ? new BehaviorStateField({ ...field, key: event.currentTarget.value }) : item) })} />{errorsFor(`state.${index}.key`).map((issue) => <p key={issue.message} role="alert" className="mt-1 text-xs text-destructive">{issue.message}</p>)}</div>
            <Input aria-label="State label" value={field.label} onChange={(event) => onChange({ ...draft, state: draft.state.map((item, itemIndex) => itemIndex === index ? new BehaviorStateField({ ...field, label: event.currentTarget.value }) : item) })} />
            <StateValueInput value={field.initialValue} onChange={(initialValue) => onChange({ ...draft, state: draft.state.map((item, itemIndex) => itemIndex === index ? new BehaviorStateField({ ...field, initialValue }) : item) })} />
            <Button type="button" size="icon" variant="ghost" aria-label={`Remove ${field.label}`} onClick={() => onChange({ ...draft, state: draft.state.filter((_, itemIndex) => itemIndex !== index) })}>
              <Trash2Icon className="size-3.5" aria-hidden />
            </Button>
          </div>
        ))}
        {errorsFor('state').map((issue) => <p key={`${issue.path}:${issue.message}`} className="text-xs text-destructive">{issue.message}</p>)}
      </section>
    </div>
  );
}
