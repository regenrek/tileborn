import { useParams } from '@tanstack/react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  type BehaviorTemplate,
  type ProjectId,
} from '@tileborne/core';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  cn,
  typography,
} from '@tileborne/ui';
import {
  AlertCircleIcon,
  CheckIcon,
  Code2Icon,
  FilePlus2Icon,
  Redo2Icon,
  SaveIcon,
  SearchIcon,
  Trash2Icon,
  Undo2Icon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import {
  useConvertBehaviorToTypeScript,
  useCreateVisualBehavior,
  useRemoveBehavior,
  useSaveVisualBehavior,
  useSaveTypeScriptBehavior,
} from '@/hooks/mutations';
import { useBehaviorRegistry, useBehaviors, useResolveBehaviorReferences } from '@/hooks/queries';
import { documentLifecycle, useDocumentLifecycle } from '@/lib/document-lifecycle';
import {
  consumeBehaviorSourceNavigation,
  sourcePositionOffset,
  type BehaviorSourceNavigationTarget,
} from '@/lib/behavior-source-navigation';
import { notifyError, notifySuccess } from '@/stores/app-notifications-store';

import { BehaviorBlockIcon } from './block-icon';
import { BehaviorEventSheet } from './event-sheet';
import { createEditorHistory, reduceEditorHistory } from './history';
import type { BehaviorReferenceOption, BehaviorReferenceOptions } from './invocation-editor';
import {
  createBlankBehaviorDraft,
  behaviorReferencesForDraft,
  decodeVisualBehaviorDraft,
  fromBehaviorDefinition,
  instantiateBehaviorTemplate,
  requiredCapabilitiesForDraft,
  toBehaviorDefinition,
  validateBehaviorDraft,
  type VisualBehaviorDraft,
} from './model';

type BehaviorSnapshot = NonNullable<ReturnType<typeof useBehaviors>['data']>['snapshot'];
type BehaviorResource = BehaviorSnapshot['resources'][number];
type VisualBehaviorResource = Extract<BehaviorResource, { readonly kind: 'visual' }>;
type TypeScriptBehaviorResource = Extract<BehaviorResource, { readonly kind: 'typescript' }>;

const serializedDraft = (draft: VisualBehaviorDraft): string => JSON.stringify(draft);

export function BehaviorConversionWarning() {
  return (
    <div className="space-y-2" data-testid="behavior-conversion-warning">
      <p className="text-sm text-muted-foreground">
        This is a one-way eject. Tileborne creates readable SDK source, preserves the behavior ID,
        and makes that TypeScript file the only canonical source. It cannot be converted back into
        visual blocks.
      </p>
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
        The saved visual event sheet will be removed after the TypeScript source is written. Commit
        or back up your project first if you want to keep a visual copy.
      </div>
    </div>
  );
}

export function focusBehaviorSourceNavigation(target: BehaviorSourceNavigationTarget): boolean {
  if (target.nodeId !== undefined) {
    const node = [...document.querySelectorAll<HTMLElement>('[data-node-id]')]
      .find((element) => element.dataset.nodeId === target.nodeId);
    if (node === undefined) return false;
    node.scrollIntoView({ block: 'center' });
    node.focus();
    return true;
  }
  const textarea = document.querySelector<HTMLTextAreaElement>('[aria-label="TypeScript behavior source"]');
  if (textarea === null) return false;
  const offset = sourcePositionOffset(textarea.value, target.line, target.column);
  textarea.focus();
  textarea.setSelectionRange(offset, offset);
  return true;
}

export type BehaviorEditorShortcut = 'save' | 'undo' | 'redo';

export const behaviorEditorShortcut = (event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>): BehaviorEditorShortcut | undefined => {
  if ((!event.metaKey && !event.ctrlKey) || event.altKey) return undefined;
  const key = event.key.toLowerCase();
  if (key === 's') return 'save';
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  return key === 'y' ? 'redo' : undefined;
};

const rawReferences = (references: BehaviorReferenceOptions) => Object.fromEntries(
  (['entity', 'asset', 'catalog', 'behavior'] as const).map((kind) => [
    kind,
    (references[kind] ?? []).map(({ reference }) => reference),
  ]),
);

function TemplateDialog({ open, templates, onOpenChange, onChoose, onBlank }: {
  readonly open: boolean;
  readonly templates: readonly BehaviorTemplate[];
  readonly onOpenChange: (open: boolean) => void;
  readonly onChoose: (template: BehaviorTemplate) => void;
  readonly onBlank: () => void;
}) {
  const [query, setQuery] = useState('');
  const matches = templates.filter((template) => query.trim().length === 0 ||
    [template.label, template.description, template.category].some((value) => value.toLowerCase().includes(query.trim().toLowerCase())));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden" data-testid="behavior-template-dialog">
        <DialogHeader>
          <DialogTitle>Create visual behavior</DialogTitle>
          <DialogDescription>Start blank or use a declarative core/plugin template. Everything remains editable.</DialogDescription>
        </DialogHeader>
        <label className="relative block">
          <SearchIcon className="pointer-events-none absolute left-2 top-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input value={query} onChange={(event) => setQuery(event.currentTarget.value)} aria-label="Search behavior templates" placeholder="Search templates…" className="pl-8" />
        </label>
        <div className="grid max-h-[58vh] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2" role="list">
          <button
            type="button"
            className="flex min-h-28 items-start gap-3 rounded-lg border border-dashed p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onBlank}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted"><FilePlus2Icon className="size-5" aria-hidden /></span>
            <span><span className={cn('block', typography.rowTitle)}>Blank event sheet</span><span className={cn('mt-1 block text-muted-foreground', typography.bodyMicro)}>Choose the WHEN block, conditions and actions yourself.</span></span>
          </button>
          {matches.map((template) => (
            <button
              key={String(template.id)}
              type="button"
              className="flex min-h-28 items-start gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onChoose(template)}
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><BehaviorBlockIcon name={template.icon} className="size-5" /></span>
              <span className="min-w-0"><span className={cn('block', typography.rowTitle)}>{template.label}</span><span className={cn('mt-1 block text-muted-foreground', typography.bodyMicro)}>{template.description}</span><Badge variant="outline" className="mt-2">{template.category}</Badge></span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function BehaviorResourceList({ resources, selectedId, query, onQueryChange, onSelect, onCreate }: {
  readonly resources: readonly BehaviorResource[];
  readonly selectedId?: string | undefined;
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  readonly onSelect: (id: string) => void;
  readonly onCreate: () => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => resources.filter(({ manifest }) =>
    query.trim().length === 0 || manifest.label.toLowerCase().includes(query.trim().toLowerCase())), [query, resources]);
  const virtualizer = useVirtualizer({
    count: matches.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52,
    overscan: 8,
    initialRect: { width: 288, height: 260 },
  });
  const virtualRows = virtualizer.getVirtualItems();
  const rows = virtualRows.length === 0
    ? matches.slice(0, 16).map((_, index) => ({ index, key: index, size: 52, start: index * 52 }))
    : virtualRows;
  const focusIndex = (index: number) => {
    const nextIndex = Math.max(0, Math.min(matches.length - 1, index));
    const id = String(matches[nextIndex]?.manifest.id ?? '');
    if (id.length === 0) return;
    onSelect(id);
    virtualizer.scrollToIndex(nextIndex);
    requestAnimationFrame(() => [...(parentRef.current?.querySelectorAll<HTMLElement>('[data-behavior-id]') ?? [])]
      .find((element) => element.dataset.behaviorId === id)?.focus());
  };
  return (
    <aside className="flex min-h-0 flex-col border-r bg-muted/10 max-md:h-52 max-md:border-b max-md:border-r-0" aria-label="Behaviors">
      <div className="flex items-center gap-2 border-b p-2">
        <label className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute left-2 top-2.5 size-3.5 text-muted-foreground" aria-hidden />
          <Input value={query} onChange={(event) => onQueryChange(event.currentTarget.value)} className="h-8 pl-7" aria-label="Search behaviors" placeholder="Search…" />
        </label>
        <Button type="button" size="icon" variant="outline" aria-label="Create behavior" onClick={onCreate}><FilePlus2Icon className="size-4" aria-hidden /></Button>
      </div>
      <div ref={parentRef} className="min-h-0 flex-1 overflow-auto" data-testid="behavior-virtual-list" role="listbox" aria-label="Project behaviors">
        {matches.length === 0 ? (
          <div className="p-5 text-center text-sm text-muted-foreground">{resources.length === 0 ? 'No behaviors yet.' : 'No matching behaviors.'}</div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {rows.map((row) => {
              const resource = matches[row.index]!;
              const active = String(resource.manifest.id) === selectedId;
              return (
                <button
                  key={String(resource.manifest.id)}
                  type="button"
                  role="option"
                  aria-selected={active}
                  tabIndex={active || (selectedId === undefined && row.index === 0) ? 0 : -1}
                  data-behavior-id={String(resource.manifest.id)}
                  onClick={() => onSelect(String(resource.manifest.id))}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
                      event.preventDefault();
                      focusIndex(event.key === 'Home' ? 0 : event.key === 'End' ? matches.length - 1 : row.index + (event.key === 'ArrowDown' ? 1 : -1));
                    }
                  }}
                  className={cn('absolute left-0 top-0 flex w-full items-center gap-2 border-b px-3 text-left hover:bg-muted/50 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', active && 'bg-primary/10')}
                  style={{ height: row.size, transform: `translateY(${row.start}px)` }}
                >
                  {resource.kind === 'visual' ? <BehaviorBlockIcon name="blocks" className="size-4 shrink-0 text-primary" /> : <Code2Icon className="size-4 shrink-0 text-violet-500" aria-hidden />}
                  <span className="min-w-0 flex-1"><span className={cn('block truncate', typography.rowTitle)}>{resource.manifest.label}</span><span className={cn('block text-muted-foreground', typography.bodyMicro)}>{resource.kind === 'visual' ? 'Event sheet' : 'TypeScript'}</span></span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

function VisualBehaviorDocument({ projectId, revision, resource, entries, onSaved, onRemoved, onConverted }: {
  readonly projectId: ProjectId;
  readonly revision: number;
  readonly resource: VisualBehaviorResource;
  readonly entries: Parameters<typeof BehaviorEventSheet>[0]['entries'];
  readonly onSaved: (snapshot: BehaviorSnapshot) => void;
  readonly onRemoved: (snapshot: BehaviorSnapshot) => void;
  readonly onConverted: (snapshot: BehaviorSnapshot) => void;
}) {
  const initial = useMemo(() => fromBehaviorDefinition(resource.definition, resource.manifest.requiredCapabilities), [resource]);
  const [history, dispatch] = useReducer(reduceEditorHistory<VisualBehaviorDraft>, initial, createEditorHistory);
  const [pickedReferences, setPickedReferences] = useState<BehaviorReferenceOptions>({});
  const draftReferences = useMemo(() => behaviorReferencesForDraft(history.present), [history.present]);
  const resolvedReferences = useResolveBehaviorReferences(projectId, draftReferences);
  const references = useMemo<BehaviorReferenceOptions>(() => {
    if (resolvedReferences.data === undefined) return pickedReferences;
    const requestedKinds = new Set(draftReferences.map(({ _tag }) => _tag));
    const nextByKind: BehaviorReferenceOptions = { ...pickedReferences };
    for (const kind of requestedKinds) nextByKind[kind] = [];
    for (const option of resolvedReferences.data.options) {
      const kind = option.reference._tag;
      nextByKind[kind] = [...(nextByKind[kind] ?? []), option];
    }
    return nextByKind;
  }, [draftReferences, pickedReferences, resolvedReferences.data]);
  const rememberReferenceOption = useCallback((option: BehaviorReferenceOption) => {
    const kind = option.reference._tag;
    setPickedReferences((current) => ({
      ...current,
      [kind]: [
        ...(current[kind] ?? []).filter(({ id }) => id !== option.id),
        option,
      ],
    }));
  }, []);
  const baseline = serializedDraft(initial);
  const dirty = serializedDraft(history.present) !== baseline;
  const saveMutation = useSaveVisualBehavior();
  const removeMutation = useRemoveBehavior();
  const convertMutation = useConvertBehaviorToTypeScript();
  const [convertOpen, setConvertOpen] = useState(false);
  const documentId = `behavior:${resource.manifest.id}`;
  const recoveryVersion = serializedDraft(history.present);
  const issues = useMemo(() => {
    const validation = validateBehaviorDraft(history.present, { schemaVersion: 1, entries } as never, {
      ...(references.entity === undefined ? {} : { entity: new Set(references.entity.map(({ id }) => id)) }),
      ...(references.asset === undefined ? {} : { asset: new Set(references.asset.map(({ id }) => id)) }),
      ...(references.catalog === undefined ? {} : { catalog: new Set(references.catalog.map(({ id }) => id)) }),
      ...(references.behavior === undefined ? {} : { behavior: new Set(references.behavior.map(({ id }) => id)) }),
    });
    return resolvedReferences.isError
      ? [...validation, { path: 'references', message: 'Could not validate selected references' }]
      : validation;
  }, [entries, history.present, references.asset, references.behavior, references.catalog, references.entity, resolvedReferences.isError]);

  const save = useCallback(async () => {
    if (resolvedReferences.isFetching) throw new Error('Wait for reference validation to finish.');
    if (issues.length > 0) throw new Error(`Fix ${issues.length} behavior problem${issues.length === 1 ? '' : 's'} before saving.`);
    const requiredCapabilities = requiredCapabilitiesForDraft(history.present, { schemaVersion: 1, entries } as never);
    const result = await saveMutation.mutateAsync({
      projectId,
      behaviorId: resource.manifest.id,
      expectedRevision: revision,
      label: history.present.label.trim(),
      definition: toBehaviorDefinition(resource.manifest.id, history.present),
      requiredCapabilities,
    });
    const saved = result.snapshot.resources.find(({ manifest }) => manifest.id === resource.manifest.id);
    if (saved?.kind === 'visual') dispatch({ type: 'reset', value: fromBehaviorDefinition(saved.definition, saved.manifest.requiredCapabilities) });
    onSaved(result.snapshot);
    notifySuccess(`Saved ${history.present.label}`);
  }, [entries, history.present, issues.length, onSaved, projectId, resolvedReferences.isFetching, resource.manifest.id, revision, saveMutation]);

  const lifecycle = useDocumentLifecycle({
    id: documentId,
    label: history.present.label,
    kind: 'behavior',
    scopeId: `behaviors:${projectId}`,
    dirty,
    recoveryVersion,
    save,
    discard: () => dispatch({ type: 'reset', value: initial }),
    snapshot: () => history.present,
    recover: (snapshot) => dispatch({ type: 'reset', value: decodeVisualBehaviorDraft(snapshot) }),
  });

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const shortcut = behaviorEditorShortcut(event);
      if (shortcut === 'save') {
        event.preventDefault();
        void documentLifecycle.save(documentId);
      } else if (shortcut === 'undo') {
        event.preventDefault();
        dispatch({ type: 'undo' });
      } else if (shortcut === 'redo') {
        event.preventDefault();
        dispatch({ type: 'redo' });
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [documentId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-11 flex-wrap items-center gap-2 border-b px-3 py-1.5">
        <Badge variant={dirty ? 'secondary' : 'outline'}>{lifecycle?.status ?? (dirty ? 'dirty' : 'clean')}</Badge>
        {issues.length === 0 ? <span className="flex items-center gap-1 text-xs text-emerald-600"><CheckIcon className="size-3.5" aria-hidden /> Valid</span> : <span className="flex items-center gap-1 text-xs text-destructive"><AlertCircleIcon className="size-3.5" aria-hidden /> {issues.length} problems</span>}
        <div className="ml-auto flex items-center gap-1">
          <Button type="button" size="icon" variant="ghost" aria-label="Undo" disabled={history.past.length === 0} onClick={() => dispatch({ type: 'undo' })}><Undo2Icon className="size-4" aria-hidden /></Button>
          <Button type="button" size="icon" variant="ghost" aria-label="Redo" disabled={history.future.length === 0} onClick={() => dispatch({ type: 'redo' })}><Redo2Icon className="size-4" aria-hidden /></Button>
          <Button type="button" size="sm" disabled={!dirty || issues.length > 0 || saveMutation.isPending || resolvedReferences.isFetching} onClick={() => void documentLifecycle.save(documentId)}><SaveIcon className="size-3.5" aria-hidden /> Save</Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={dirty || issues.length > 0 || convertMutation.isPending || resolvedReferences.isFetching}
            title={dirty ? 'Save this event sheet before converting it.' : 'Convert this event sheet to native TypeScript'}
            onClick={() => setConvertOpen(true)}
          ><Code2Icon className="size-3.5" aria-hidden /> Convert to TypeScript</Button>
          <Button type="button" size="icon" variant="ghost" aria-label="Delete behavior" disabled={removeMutation.isPending} onClick={async () => {
            if (!confirm(`Delete ${history.present.label}?`)) return;
            try {
              const result = await removeMutation.mutateAsync({ projectId, behaviorId: resource.manifest.id, expectedRevision: revision });
              onRemoved(result.snapshot);
            } catch (error) { notifyError(error instanceof Error ? error.message : 'Could not delete behavior'); }
          }}><Trash2Icon className="size-4" aria-hidden /></Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <BehaviorEventSheet draft={history.present} entries={entries} references={references} projectId={projectId} onReferenceOption={rememberReferenceOption} issues={issues} onChange={(value) => dispatch({ type: 'commit', value })} />
      </div>
      <Dialog open={convertOpen} onOpenChange={setConvertOpen}>
        <DialogContent className="max-w-lg" data-testid="behavior-convert-dialog">
          <DialogHeader>
            <DialogTitle>Convert to TypeScript?</DialogTitle>
            <DialogDescription>Review the irreversible canonical-source change before continuing.</DialogDescription>
          </DialogHeader>
          <BehaviorConversionWarning />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setConvertOpen(false)}>Cancel</Button>
            <Button
              type="button"
              disabled={convertMutation.isPending}
              onClick={async () => {
                try {
                  const result = await convertMutation.mutateAsync({
                    projectId,
                    behaviorId: resource.manifest.id,
                    expectedRevision: revision,
                  });
                  setConvertOpen(false);
                  onConverted(result.snapshot);
                  notifySuccess(`Converted ${history.present.label} to TypeScript`);
                } catch (error) {
                  notifyError(error instanceof Error ? error.message : 'Could not convert behavior');
                }
              }}
            >{convertMutation.isPending ? 'Converting…' : 'Convert permanently'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface TypeScriptBehaviorDraft {
  readonly label: string;
  readonly source: string;
  readonly exportName: string;
}

const decodeTypeScriptBehaviorDraft = (value: unknown): TypeScriptBehaviorDraft => {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid TypeScript recovery draft.');
  const record = value as Readonly<Record<string, unknown>>;
  if (typeof record.label !== 'string' || typeof record.source !== 'string' || typeof record.exportName !== 'string') {
    throw new Error('Invalid TypeScript recovery draft.');
  }
  return { label: record.label, source: record.source, exportName: record.exportName };
};

export function TypeScriptBehaviorDocument({ projectId, revision, resource, onSaved }: {
  readonly projectId: ProjectId;
  readonly revision: number;
  readonly resource: TypeScriptBehaviorResource;
  readonly onSaved: (snapshot: BehaviorSnapshot) => void;
}) {
  const sourcePath = resource.manifest.source._tag === 'typescript'
    ? resource.manifest.source.sourcePath
    : '';
  const initialDraft = useMemo<TypeScriptBehaviorDraft>(() => ({
    label: resource.manifest.label,
    source: resource.source,
    exportName: resource.manifest.source._tag === 'typescript'
      ? resource.manifest.source.exportName
      : 'default',
  }), [resource]);
  const [draft, setDraft] = useState(initialDraft);
  const [savedDraft, setSavedDraft] = useState(initialDraft);
  const saveMutation = useSaveTypeScriptBehavior();
  const dirty = JSON.stringify(draft) !== JSON.stringify(savedDraft);
  const documentId = `behavior:${resource.manifest.id}`;
  const save = useCallback(async () => {
    if (draft.label.trim().length === 0) throw new Error('Behavior name is required.');
    if (draft.source.trim().length === 0) throw new Error('TypeScript source is required.');
    if (draft.exportName.trim().length === 0) throw new Error('Export name is required.');
    const result = await saveMutation.mutateAsync({
      projectId,
      behaviorId: resource.manifest.id,
      expectedRevision: revision,
      label: draft.label.trim(),
      source: draft.source,
      exportName: draft.exportName.trim(),
      requiredCapabilities: [...resource.manifest.requiredCapabilities],
    });
    const saved = result.snapshot.resources.find(({ manifest }) => manifest.id === resource.manifest.id);
    if (saved?.kind === 'typescript') {
      const next = {
        label: saved.manifest.label,
        source: saved.source,
        exportName: saved.manifest.source._tag === 'typescript' ? saved.manifest.source.exportName : 'default',
      };
      setDraft(next);
      setSavedDraft(next);
    }
    onSaved(result.snapshot);
    notifySuccess(`Saved ${draft.label.trim()}`);
  }, [draft, onSaved, projectId, resource.manifest.id, resource.manifest.requiredCapabilities, revision, saveMutation]);
  const lifecycle = useDocumentLifecycle({
    id: documentId,
    label: draft.label,
    kind: 'behavior',
    scopeId: `behaviors:${projectId}`,
    dirty,
    recoveryVersion: JSON.stringify(draft),
    save,
    discard: () => setDraft(savedDraft),
    snapshot: () => draft,
    recover: (snapshot) => setDraft(decodeTypeScriptBehaviorDraft(snapshot)),
  });
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (behaviorEditorShortcut(event) !== 'save') return;
      event.preventDefault();
      void documentLifecycle.save(documentId);
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [documentId]);
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="typescript-behavior-document">
      <div className="flex min-h-11 flex-wrap items-center gap-2 border-b px-3 py-1.5">
        <Badge variant="outline">TypeScript · canonical</Badge>
        <code className="min-w-0 truncate text-xs text-muted-foreground">{sourcePath}</code>
        <Badge variant={dirty ? 'secondary' : 'outline'}>{lifecycle?.status ?? (dirty ? 'dirty' : 'clean')}</Badge>
        <Button
          className="ml-auto"
          type="button"
          size="sm"
          disabled={!dirty || saveMutation.isPending || draft.label.trim().length === 0 || draft.source.trim().length === 0 || draft.exportName.trim().length === 0}
          onClick={() => void documentLifecycle.save(documentId)}
        ><SaveIcon className="size-3.5" aria-hidden /> Save</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-muted/20 p-4">
        <p className="mb-3 max-w-3xl text-sm text-muted-foreground">
          This native TypeScript source uses <code>@tileborne/game-sdk</code>. Conversion back to
          visual blocks is intentionally unavailable.
        </p>
        <div className="mb-3 grid max-w-3xl gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <label className="grid gap-1 text-xs font-medium">Behavior name
            <Input value={draft.label} onChange={(event) => setDraft((current) => ({ ...current, label: event.currentTarget.value }))} />
          </label>
          <label className="grid gap-1 text-xs font-medium">Export name
            <Input value={draft.exportName} onChange={(event) => setDraft((current) => ({ ...current, exportName: event.currentTarget.value }))} />
          </label>
        </div>
        <textarea
          className="min-h-[28rem] w-full min-w-[42rem] resize-y rounded-md border bg-background p-4 font-mono text-xs leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="TypeScript behavior source"
          spellCheck={false}
          value={draft.source}
          onChange={(event) => setDraft((current) => ({ ...current, source: event.currentTarget.value }))}
        />
      </div>
    </div>
  );
}

export function BehaviorEditorPage() {
  const { projectId: projectIdParam } = useParams({ from: '/editor/projects/$projectId/behaviors' });
  const projectId = projectIdParam as ProjectId;
  const behaviorsQuery = useBehaviors(projectId);
  const registryQuery = useBehaviorRegistry(projectId);
  const createMutation = useCreateVisualBehavior();
  const [sourceNavigation] = useState(() => consumeBehaviorSourceNavigation(String(projectId)));
  const sourceNavigationApplied = useRef(false);
  const [snapshotOverride, setSnapshotOverride] = useState<BehaviorSnapshot | undefined>();
  const snapshot = snapshotOverride ?? behaviorsQuery.data?.snapshot;
  const [selectedId, setSelectedId] = useState<string | undefined>(sourceNavigation?.behaviorId);
  const [query, setQuery] = useState('');
  const [templateOpen, setTemplateOpen] = useState(false);
  const resources = snapshot?.resources ?? [];
  const selected = resources.find(({ manifest }) => String(manifest.id) === selectedId) ?? resources[0];
  useEffect(() => {
    if (sourceNavigation?.sourcePath === undefined) return;
    const owner = resources.find((resource) => {
      const source = resource.manifest.source;
      const resourcePath = source._tag === 'visual' ? source.definitionPath : source.sourcePath;
      return resourcePath === sourceNavigation.sourcePath;
    });
    if (owner !== undefined && String(owner.manifest.id) !== selectedId) {
      setSelectedId(String(owner.manifest.id));
    }
  }, [resources, selectedId, sourceNavigation]);
  useEffect(() => {
    if (selectedId === undefined && resources[0] !== undefined) setSelectedId(String(resources[0].manifest.id));
  }, [resources, selectedId]);
  useEffect(() => {
    if (
      sourceNavigationApplied.current ||
      sourceNavigation === undefined ||
      selected === undefined ||
      String(selected.manifest.id) !== sourceNavigation.behaviorId
    ) return;
    sourceNavigationApplied.current = true;
    requestAnimationFrame(() => {
      focusBehaviorSourceNavigation(sourceNavigation);
    });
  }, [selected, sourceNavigation]);

  const references: BehaviorReferenceOptions = {};

  const create = async (template?: BehaviorTemplate) => {
    const registry = registryQuery.data?.registry;
    if (registry === undefined) return;
    try {
      const draft = template === undefined ? createBlankBehaviorDraft(registry) : instantiateBehaviorTemplate(template, registry, rawReferences(references));
      const result = await createMutation.mutateAsync({
        projectId,
        label: draft.label,
        definition: { state: [...draft.state], when: draft.when, ...(draft.if === undefined ? {} : { if: draft.if }), do: [...draft.do] },
        requiredCapabilities: requiredCapabilitiesForDraft(draft, registry),
      });
      const previousIds = new Set(resources.map(({ manifest }) => String(manifest.id)));
      const created = result.snapshot.resources.find(({ manifest }) => !previousIds.has(String(manifest.id)));
      setSnapshotOverride(result.snapshot);
      if (created !== undefined) setSelectedId(String(created.manifest.id));
      setTemplateOpen(false);
      notifySuccess(`Created ${draft.label}`);
    } catch (error) { notifyError(error instanceof Error ? error.message : 'Could not create behavior'); }
  };

  if (behaviorsQuery.isLoading || registryQuery.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading behaviors…</div>;
  if (behaviorsQuery.isError || registryQuery.isError || snapshot === undefined || registryQuery.data === undefined) {
    return <div role="alert" className="m-6 rounded-md border border-destructive/40 p-4 text-sm text-destructive">Could not open the behavior editor. {String(behaviorsQuery.error ?? registryQuery.error ?? '')}</div>;
  }
  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)] max-md:grid-cols-1 max-md:grid-rows-[auto_minmax(0,1fr)]" data-testid="behavior-editor-page">
      <BehaviorResourceList resources={resources} selectedId={selected === undefined ? undefined : String(selected.manifest.id)} query={query} onQueryChange={setQuery} onSelect={setSelectedId} onCreate={() => setTemplateOpen(true)} />
      <main className="flex min-h-0 min-w-0 flex-col">
        {selected === undefined ? (
          <div className="flex flex-1 items-center justify-center p-8 text-center"><div><FilePlus2Icon className="mx-auto mb-3 size-10 text-muted-foreground" aria-hidden /><h1 className="text-lg font-semibold">Build gameplay visually</h1><p className="mt-2 max-w-md text-sm text-muted-foreground">Create a WHEN / IF / DO event sheet. It compiles to the same deterministic behavior runtime as TypeScript.</p><Button className="mt-4" onClick={() => setTemplateOpen(true)}>Create behavior</Button></div></div>
        ) : selected.kind === 'visual' ? (
          <VisualBehaviorDocument key={String(selected.manifest.id)} projectId={projectId} revision={snapshot.revision} resource={selected} entries={registryQuery.data.registry.entries} onSaved={setSnapshotOverride} onConverted={setSnapshotOverride} onRemoved={(next) => { setSnapshotOverride(next); setSelectedId(next.resources[0] === undefined ? undefined : String(next.resources[0].manifest.id)); }} />
        ) : (
          <TypeScriptBehaviorDocument projectId={projectId} revision={snapshot.revision} resource={selected} onSaved={setSnapshotOverride} />
        )}
      </main>
      <TemplateDialog open={templateOpen} templates={registryQuery.data.templates} onOpenChange={setTemplateOpen} onChoose={(template) => void create(template)} onBlank={() => void create()} />
    </div>
  );
}
