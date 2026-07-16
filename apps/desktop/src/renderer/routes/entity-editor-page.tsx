import { useParams } from '@tanstack/react-router';
import { GameObjectType, type AuthoringFieldSchema, type VisualRefComponent } from '@tileborne/core';
import { Badge, Button, Input, Label, cn, typography } from '@tileborne/ui';
import { Option, Schema } from 'effect';
import { CopyIcon, PlusIcon, RotateCcwIcon, SaveIcon, ShapesIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  EntityCapabilityPanel,
  type EntityOption,
} from '@/components/entity-editor/entity-capability-panel';
import { CloseableWorkspacePage } from '@/components/shell/closeable-workspace-page';
import {
  SpriteGeometryCanvas,
  type NormalizedPoint,
  type SpriteGeometryHandle,
} from '@/components/visual-editor/sprite-geometry-canvas';
import { useRemoveCatalogType, useUpsertCatalogType } from '@/hooks/mutations';
import {
  useAssetPackLibrary,
  useAssetPacks,
  useResolvedCatalog,
  useTilesetPack,
  useValidateCatalog,
  useWorkingPalettePreviews,
} from '@/hooks/queries';
import { usePlaceableVisual } from '@/hooks/use-placeable-visual';
import { assetThumbnailUrl } from '@/lib/asset-url';
import { assetLibraryReferenceKey } from '@/lib/working-palettes-bridge';
import { documentLifecycle, useDocumentLifecycle } from '@/lib/document-lifecycle';
import {
  componentOf,
  createProjectEntity,
  duplicateAsProjectEntity,
  encodeEntity,
  entityWithComponent,
  entityWithFamily,
  entityWithLabel,
  isValidAnchorName,
  visualRefWithAnchor,
  visualRefWithPatch,
  visualRefWithoutAnchor,
} from '@/lib/entity-authoring';
import { notifyError, notifySuccess } from '@/stores/app-notifications-store';
import { useEditorUiStore } from '@/stores/editor-ui-store';

import type { PackId } from '@tileborne/core';

const hasAssetReference = (fields: readonly AuthoringFieldSchema[] | undefined): boolean =>
  fields?.some((field) =>
    field.kind === 'reference'
      ? field.target === 'asset'
      : field.kind === 'group'
        ? hasAssetReference(field.fields)
        : field.kind === 'optional'
          ? hasAssetReference([field.field])
          : false,
  ) ?? false;

/**
 * Entity Editor workbench (ADR-0028): the entity-first authoring surface.
 * Left rail lists the merged catalog (plugin entities read-only, project
 * entities editable); center shows the sprite-geometry canvas with the
 * entity's `visual-ref` anchors as draggable handles; right rail edits
 * capabilities (`GameObjectComponent`s) via typed forms. Persistence goes
 * through `catalog:upsertType`/`catalog:removeType` into the project
 * catalog fragment.
 */
export function EntityEditorPage() {
  const { projectId } = useParams({ from: '/editor/projects/$projectId/entities' });
  const catalogQuery = useResolvedCatalog(projectId);
  const validateQuery = useValidateCatalog(projectId);
  const upsertType = useUpsertCatalogType();
  const removeType = useRemoveCatalogType();
  const brushIntent = useEditorUiStore((state) => state.brushIntent);
  const catalogTargetObjectTypeId = useEditorUiStore((state) => state.catalogTargetObjectTypeId);
  const setCatalogTargetObjectTypeId = useEditorUiStore((state) => state.setCatalogTargetObjectTypeId);

  const entries = useMemo(() => catalogQuery.data?.objectTypes ?? [], [catalogQuery.data]);
  const lootTables = useMemo(() => catalogQuery.data?.lootTables ?? [], [catalogQuery.data]);
  const items = useMemo(() => catalogQuery.data?.items ?? [], [catalogQuery.data]);
  const weaponOptions = useMemo(
    (): readonly EntityOption[] =>
      (catalogQuery.data?.weapons ?? []).map((weapon) => ({
        id: String(weapon.entry.weapon.id),
        label: weapon.label,
      })),
    [catalogQuery.data],
  );

  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<GameObjectType | undefined>(undefined);
  const [isDirty, setIsDirty] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createLabel, setCreateLabel] = useState('');
  const [createFamily, setCreateFamily] = useState('object');
  const [anchorName, setAnchorName] = useState('');

  useEffect(() => {
    if (
      catalogTargetObjectTypeId !== null &&
      entries.some((entry) => String(entry.objectType.id) === catalogTargetObjectTypeId)
    ) {
      setSelectedId(catalogTargetObjectTypeId);
      setSearch('');
      setCatalogTargetObjectTypeId(null);
    }
  }, [catalogTargetObjectTypeId, entries, setCatalogTargetObjectTypeId]);

  const selectedEntry = useMemo(
    () => entries.find((entry) => String(entry.objectType.id) === selectedId),
    [entries, selectedId],
  );
  const readOnly = selectedEntry?.origin === 'plugin';

  // Mirror draft/dirty into refs so the sync effect below can read them
  // without re-running (and clobbering edits) on every keystroke.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;

  useEffect(() => {
    const current = draftRef.current;
    const currentId = current === undefined ? undefined : String(current.id);
    if (selectedEntry !== undefined) {
      if (currentId === String(selectedEntry.objectType.id) && dirtyRef.current) {
        // Keep unsaved edits alive across background catalog refetches.
        return;
      }
      setDraft(selectedEntry.objectType);
      setIsDirty(false);
      return;
    }
    if (currentId === selectedId) {
      // A draft that is not in the catalog yet (newly created or just
      // duplicated) stays alive until the catalog refetch catches up.
      return;
    }
    setDraft(undefined);
    setIsDirty(false);
  }, [selectedEntry, selectedId]);

  const filteredEntries = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (query.length === 0) {
      return entries;
    }
    return entries.filter(
      (entry) =>
        entry.objectType.label.toLowerCase().includes(query) ||
        String(entry.objectType.id).toLowerCase().includes(query) ||
        String(entry.objectType.family).toLowerCase().includes(query),
    );
  }, [entries, search]);

  const entityOptions = useMemo(
    (): readonly EntityOption[] =>
      entries.map((entry) => ({
        id: String(entry.objectType.id),
        label: entry.objectType.label,
      })),
    [entries],
  );

  const entityIssues = useMemo(() => {
    const issues = validateQuery.data?.report.issues ?? [];
    return draft === undefined
      ? []
      : issues.filter((issue) => issue.objectTypeId !== undefined && String(issue.objectTypeId) === String(draft.id));
  }, [validateQuery.data, draft]);

  const activePlaceable = useMemo(() => {
    if (brushIntent.kind !== 'placeable' || brushIntent.packId === undefined) {
      return undefined;
    }
    return {
      packId: brushIntent.packId as PackId,
      placeableId: String(brushIntent.placeableId),
    };
  }, [brushIntent]);
  const packQuery = useTilesetPack(activePlaceable?.packId);
  const assetPacksQuery = useAssetPacks();
  const needsAssetOptions = hasAssetReference(draft?.instanceFields);
  const authoringAssetPackId = needsAssetOptions
    ? activePlaceable?.packId ?? assetPacksQuery.data?.packs[0]?.id
    : undefined;
  // A single bounded page keeps schema fields discoverable without pulling a
  // whole multi-thousand-asset library into the entity editor. The backend
  // index and preview resolver stay lazy until an asset field is visible.
  const authoringAssetLibrary = useAssetPackLibrary(authoringAssetPackId, {
    groupKind: 'source',
    limit: 64,
  });
  const authoringAssetRefs = useMemo(
    () =>
      (authoringAssetLibrary.data?.groups ?? []).flatMap((group) =>
        group.primaryRef === undefined ? [] : [group.primaryRef],
      ),
    [authoringAssetLibrary.data],
  );
  const authoringAssetPreviews = useWorkingPalettePreviews(authoringAssetRefs);
  const assetOptions = useMemo(
    (): readonly EntityOption[] =>
      (authoringAssetLibrary.data?.groups ?? []).flatMap((group) => {
        const ref = group.primaryRef;
        if (ref === undefined) return [];
        const key = assetLibraryReferenceKey(ref);
        const preview = authoringAssetPreviews.previewByKey.get(key);
        return [{
          id: key,
          label: group.label,
          ...(preview === undefined || authoringAssetLibrary.data === undefined
            ? {}
            : {
                previewUrl: assetThumbnailUrl(
                  String(ref.packId),
                  preview,
                  authoringAssetLibrary.data.integrityHash,
                ),
              }),
        }];
      }),
    [authoringAssetLibrary.data, authoringAssetPreviews.previewByKey],
  );
  const activeAssetLabel = useMemo(() => {
    if (activePlaceable === undefined) {
      return undefined;
    }
    const entry = packQuery.data?.placeables?.find(
      (placeable) => String(placeable.id) === activePlaceable.placeableId,
    );
    return entry?.name ?? activePlaceable.placeableId;
  }, [activePlaceable, packQuery.data]);

  const updateDraft = (next: GameObjectType) => {
    setDraft(next);
    setIsDirty(true);
  };

  const visualRef = draft === undefined ? undefined : componentOf(draft, 'visual-ref');
  const assignedPlaceableId =
    visualRef === undefined ? undefined : Option.getOrUndefined(visualRef.placeableId);
  const assignedSprite = usePlaceableVisual(
    assignedPlaceableId === undefined ? undefined : String(assignedPlaceableId),
  );
  const spriteImageUrl =
    assignedSprite?.preview === undefined
      ? undefined
      : assetThumbnailUrl(assignedSprite.packId, assignedSprite.preview, assignedSprite.integrityHash);

  const handles = useMemo((): readonly SpriteGeometryHandle[] => {
    if (visualRef === undefined) {
      return [];
    }
    return Object.entries(visualRef.anchors).map(([name, anchor]) => ({
      id: name,
      label: name,
      kind: name === 'hand' || name === 'grip' ? 'hand' : 'anchor',
      point: anchor.point,
      rotationDeg: anchor.rotationDeg,
    }));
  }, [visualRef]);

  const patchVisualRef = (next: VisualRefComponent) => {
    if (draft !== undefined) {
      updateDraft(entityWithComponent(draft, next));
    }
  };

  const updateHandle = (id: string, point: NormalizedPoint) => {
    if (visualRef !== undefined) {
      patchVisualRef(visualRefWithAnchor(visualRef, id, { point }));
    }
  };

  const updateHandleRotation = (id: string, rotationDeg: number) => {
    if (visualRef !== undefined) {
      patchVisualRef(visualRefWithAnchor(visualRef, id, { rotationDeg }));
    }
  };

  const assignActiveAsset = () => {
    if (activePlaceable === undefined) {
      notifyError('Select a sprite/object brush from the palette first.');
      return;
    }
    if (visualRef === undefined) {
      return;
    }
    const next = visualRefWithPatch(visualRef, { placeableId: activePlaceable.placeableId });
    if (Option.isNone(next.placeableId)) {
      notifyError('The active palette item has no catalog-compatible placeable id.');
      return;
    }
    patchVisualRef(next);
  };

  const createEntity = () => {
    const label = createLabel.trim();
    if (label.length === 0) {
      notifyError('Give the new entity a label.');
      return;
    }
    const entity = createProjectEntity({ label, family: createFamily.trim() });
    setSelectedId(String(entity.id));
    setDraft(entity);
    setIsDirty(true);
    setCreateOpen(false);
    setCreateLabel('');
  };

  const persistDraft = async () => {
    if (projectId === undefined || draft === undefined) {
      return;
    }
    const result = await upsertType.mutateAsync({
      projectId,
      objectTypeJson: encodeEntity(draft),
    });
    if (!result.saved) {
      throw new Error(result.report.issues[0]?.message ?? 'Entity save was rejected.');
    }
    setIsDirty(false);
    setSelectedId(String(draft.id));
    notifySuccess(
      result.report.ok
        ? `${draft.label} saved`
        : `${draft.label} saved with ${result.report.issues.length} open issue${result.report.issues.length === 1 ? '' : 's'}`,
    );
  };

  const documentId = `entity-editor:${projectId}`;
  const saveDraft = async () => {
    if (await documentLifecycle.save(documentId)) return;
    notifyError(documentLifecycle.get(documentId)?.error ?? 'Entity save failed');
  };

  const documentState = useDocumentLifecycle({
    id: documentId,
    label: draft?.label ?? 'Entity Editor',
    kind: 'entity',
    dirty: isDirty,
    recoveryVersion: draft,
    save: persistDraft,
    discard: () => {
      setDraft(selectedEntry?.objectType);
      setIsDirty(false);
    },
    snapshot: () => (draft === undefined ? undefined : encodeEntity(draft)),
    recover: (snapshot) => {
      const recovered = Schema.decodeUnknownSync(GameObjectType)(snapshot);
      setDraft(recovered);
      setSelectedId(String(recovered.id));
      setIsDirty(true);
    },
  });

  const duplicateEntity = async () => {
    if (projectId === undefined || selectedEntry === undefined) {
      return;
    }
    const copy = duplicateAsProjectEntity(selectedEntry.objectType);
    try {
      const result = await upsertType.mutateAsync({
        projectId,
        objectTypeJson: encodeEntity(copy),
      });
      if (!result.saved) {
        notifyError(result.report.issues[0]?.message ?? 'Duplicate failed.');
        return;
      }
      setDraft(copy);
      setIsDirty(false);
      setSelectedId(String(copy.id));
      notifySuccess(`${copy.label} created`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Duplicate failed');
    }
  };

  const deleteEntity = async () => {
    if (projectId === undefined || draft === undefined || readOnly) {
      return;
    }
    try {
      const result = await removeType.mutateAsync({
        projectId,
        objectTypeId: String(draft.id),
      });
      if (result.removed) {
        setSelectedId(undefined);
        notifySuccess(`${draft.label} deleted`);
      } else {
        notifyError('Entity is not part of the project fragment.');
      }
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Entity delete failed');
    }
  };

  const addAnchor = () => {
    if (visualRef === undefined) {
      return;
    }
    const name = anchorName.trim();
    if (!isValidAnchorName(name)) {
      notifyError('Anchor names are lowercase slugs (e.g. "grip", "muzzle-tip").');
      return;
    }
    patchVisualRef(visualRefWithAnchor(visualRef, name, { point: { x: 0.5, y: 0.5 } }));
    setAnchorName('');
  };

  return (
    <CloseableWorkspacePage
      title="Entity Editor"
      description="Define entities, assign sprites, add capabilities, and place anchors — the entity is the single source of truth."
      actions={
        <span className="text-xs text-muted-foreground" data-testid="entity-document-status">
          {documentState?.status ?? 'clean'}
        </span>
      }
      maxWidthClassName="max-w-[110rem]"
      data-testid="entity-editor-page"
    >
      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)_minmax(20rem,26rem)]">
        {/* Left rail: merged catalog entity list */}
        <section
          className="flex min-h-0 min-w-0 flex-col rounded-md border border-border bg-card"
          aria-labelledby="entity-list-title"
        >
          <div className="space-y-2 border-b border-border px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <h2 id="entity-list-title" className={typography.panelTitle}>
                Entities
              </h2>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2"
                onClick={() => setCreateOpen((open) => !open)}
                data-testid="entity-editor-new"
              >
                <PlusIcon className="size-3.5" aria-hidden />
                New
              </Button>
            </div>
            <Input
              value={search}
              placeholder="Search entities…"
              onChange={(event) => setSearch(event.currentTarget.value)}
              data-testid="entity-editor-search"
            />
            {createOpen ? (
              <div className="space-y-2 rounded-md border border-border bg-background p-2" data-testid="entity-editor-create-form">
                <div className="space-y-1">
                  <Label htmlFor="entity-create-label">Label</Label>
                  <Input
                    id="entity-create-label"
                    value={createLabel}
                    onChange={(event) => setCreateLabel(event.currentTarget.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="entity-create-family">Family</Label>
                  <Input
                    id="entity-create-family"
                    value={createFamily}
                    onChange={(event) => setCreateFamily(event.currentTarget.value)}
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="w-full"
                  onClick={createEntity}
                  data-testid="entity-editor-create-confirm"
                >
                  Create entity
                </Button>
              </div>
            ) : null}
          </div>
          <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto" data-testid="entity-editor-list">
            {filteredEntries.map((entry) => {
              const id = String(entry.objectType.id);
              const selected = id === selectedId;
              return (
                <li key={id} data-testid={`entity-editor-row-${id}`}>
                  <button
                    type="button"
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50',
                      selected ? 'bg-primary/10' : '',
                    )}
                    onClick={() => setSelectedId(id)}
                    data-selected={selected}
                  >
                    <ShapesIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className={cn('truncate', typography.rowTitle)}>{entry.objectType.label}</p>
                      <p className={cn('truncate', typography.rowMeta)}>
                        {String(entry.objectType.family)}
                      </p>
                    </div>
                    <Badge
                      variant={entry.origin === 'plugin' ? 'secondary' : 'default'}
                      className={cn('shrink-0 px-1.5 py-0 font-normal', typography.bodyMicro)}
                    >
                      {entry.origin === 'plugin' ? 'Plugin' : 'Project'}
                    </Badge>
                  </button>
                </li>
              );
            })}
            {filteredEntries.length === 0 ? (
              <li className={cn('px-3 py-3 text-muted-foreground', typography.rowMeta)}>
                {catalogQuery.isLoading ? 'Loading catalog…' : 'No entities match.'}
              </li>
            ) : null}
          </ul>
        </section>

        {/* Center: identity + geometry canvas */}
        <div className="min-w-0 space-y-4" data-testid="entity-editor-center">
          {draft === undefined ? (
            <section className="rounded-md border border-dashed border-border bg-card/50 p-6 text-center">
              <p className={typography.panelTitle}>No entity selected</p>
              <p className={cn('mt-1 text-muted-foreground', typography.rowMeta)}>
                Pick an entity on the left or create a new one.
              </p>
            </section>
          ) : (
            <>
              <section className="rounded-md border border-border bg-card p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={typography.sectionLabelMicro}>
                      {readOnly ? 'Plugin entity (read-only)' : 'Project entity'}
                    </p>
                    <h2 className={cn('truncate', typography.panelTitle)}>{draft.label}</h2>
                    <p className={cn('truncate text-muted-foreground', typography.bodyMicro)}>
                      {String(draft.id)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void duplicateEntity()}
                      disabled={selectedEntry === undefined || upsertType.isPending}
                      data-testid="entity-editor-duplicate"
                    >
                      <CopyIcon className="size-4" aria-hidden />
                      Duplicate as project entity
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!isDirty}
                      onClick={() => {
                        setDraft(selectedEntry?.objectType);
                        setIsDirty(false);
                      }}
                      data-testid="entity-editor-revert"
                    >
                      <RotateCcwIcon className="size-4" aria-hidden />
                      Revert
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={readOnly || selectedEntry === undefined || removeType.isPending}
                      onClick={() => void deleteEntity()}
                      data-testid="entity-editor-delete"
                    >
                      <Trash2Icon className="size-4" aria-hidden />
                      Delete
                    </Button>
                    <Button
                      type="button"
                      disabled={readOnly || !isDirty || upsertType.isPending}
                      onClick={() => void saveDraft()}
                      data-testid="entity-editor-save"
                    >
                      <SaveIcon className="size-4" aria-hidden />
                      Save
                    </Button>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="entity-editor-label">Label</Label>
                    <Input
                      id="entity-editor-label"
                      value={draft.label}
                      disabled={readOnly}
                      onChange={(event) => updateDraft(entityWithLabel(draft, event.currentTarget.value))}
                      data-testid="entity-editor-label"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="entity-editor-family">Family</Label>
                    <Input
                      id="entity-editor-family"
                      value={String(draft.family)}
                      disabled={readOnly}
                      onChange={(event) => updateDraft(entityWithFamily(draft, event.currentTarget.value))}
                      data-testid="entity-editor-family"
                    />
                  </div>
                </div>

                {entityIssues.length === 0 ? null : (
                  <div
                    className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-2"
                    data-testid="entity-editor-issues"
                  >
                    <p className={typography.rowTitle}>Validation issues</p>
                    <ul className="mt-1 list-disc space-y-1 pl-4">
                      {entityIssues.map((issue, index) => (
                        <li key={`${issue.refKind ?? issue.kind}-${index}`} className={typography.rowMeta}>
                          {issue.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>

              {visualRef === undefined ? (
                <section className="rounded-md border border-dashed border-border bg-card/50 p-4">
                  <p className={cn('text-muted-foreground', typography.rowMeta)}>
                    Add the <span className="font-medium">Visual (sprite)</span> capability to place
                    anchors on this entity.
                  </p>
                </section>
              ) : (
                <>
                  <SpriteGeometryCanvas
                    title={`${draft.label} anchors`}
                    imageUrl={spriteImageUrl}
                    handles={handles}
                    snapStep={0.01}
                    onHandleChange={readOnly ? () => undefined : updateHandle}
                    onHandleRotationChange={readOnly ? () => undefined : updateHandleRotation}
                  />
                  <section className="rounded-md border border-border bg-card p-3" data-testid="entity-editor-anchors">
                    <div className="flex items-center justify-between gap-2">
                      <p className={typography.panelTitle}>Anchors</p>
                      {readOnly ? null : (
                        <div className="flex items-center gap-1">
                          <Input
                            value={anchorName}
                            placeholder="grip, muzzle, …"
                            className="h-7 w-36"
                            onChange={(event) => setAnchorName(event.currentTarget.value)}
                            data-testid="entity-editor-anchor-name"
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 px-2"
                            onClick={addAnchor}
                            data-testid="entity-editor-anchor-add"
                          >
                            <PlusIcon className="size-3.5" aria-hidden />
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      {Object.entries(visualRef.anchors).map(([name, anchor]) => (
                        <div
                          key={name}
                          className="rounded-md border border-border bg-background p-2"
                          data-testid={`entity-editor-anchor-${name}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className={typography.rowTitle}>{name}</p>
                            {readOnly ? null : (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-6 px-1.5 text-muted-foreground"
                                onClick={() => patchVisualRef(visualRefWithoutAnchor(visualRef, name))}
                                data-testid={`entity-editor-anchor-remove-${name}`}
                              >
                                <Trash2Icon className="size-3" aria-hidden />
                              </Button>
                            )}
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <Label htmlFor={`entity-anchor-${name}-rotation`}>Rotation</Label>
                              <Input
                                id={`entity-anchor-${name}-rotation`}
                                type="number"
                                step={1}
                                value={anchor.rotationDeg}
                                disabled={readOnly}
                                onChange={(event) => {
                                  const rotationDeg = Number.parseFloat(event.currentTarget.value);
                                  if (Number.isFinite(rotationDeg)) {
                                    patchVisualRef(visualRefWithAnchor(visualRef, name, { rotationDeg }));
                                  }
                                }}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor={`entity-anchor-${name}-z`}>Z offset</Label>
                              <Input
                                id={`entity-anchor-${name}-z`}
                                type="number"
                                step={1}
                                value={anchor.zOffset}
                                disabled={readOnly}
                                onChange={(event) => {
                                  const zOffset = Number.parseFloat(event.currentTarget.value);
                                  if (Number.isFinite(zOffset)) {
                                    patchVisualRef(visualRefWithAnchor(visualRef, name, { zOffset }));
                                  }
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                      {Object.keys(visualRef.anchors).length === 0 ? (
                        <p className={cn('text-muted-foreground', typography.rowMeta)}>
                          No anchors yet. Add one (e.g. "grip") and drag it on the canvas.
                        </p>
                      ) : null}
                    </div>
                  </section>
                </>
              )}
            </>
          )}
        </div>

        {/* Right rail: capabilities */}
        <section className="min-h-0 min-w-0 overflow-y-auto rounded-md border border-border bg-card p-3">
          {draft === undefined ? (
            <p className={cn('text-muted-foreground', typography.rowMeta)}>
              Select an entity to edit its capabilities.
            </p>
          ) : (
            <EntityCapabilityPanel
              entity={draft}
              readOnly={readOnly}
              entityOptions={entityOptions}
              lootTables={lootTables}
              weaponOptions={weaponOptions}
              items={items}
              assetOptions={assetOptions}
              activeAssetLabel={activeAssetLabel}
              assignedSprite={assignedSprite}
              onAssignActiveAsset={assignActiveAsset}
              onChange={updateDraft}
            />
          )}
        </section>
      </div>
    </CloseableWorkspacePage>
  );
}
