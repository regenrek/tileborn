import { useEffect, useMemo, useState } from 'react';
import { Option } from 'effect';
import type {
  GameObjectComponent,
  GameObjectType,
  LootTable,
  MapObject,
  ProjectId,
  TileborneMap,
} from '@tileborne/core';
import { Button, Input, Separator, Skeleton, cn, typography } from '@tileborne/ui';
import { SaveIcon } from 'lucide-react';

import { CollisionFootprintSection } from '@/components/inspector/collision-footprint-section';
import { LootSourceBinding } from '@/components/inspector/loot-source-binding';
import { useResolvedCatalog } from '@/hooks/queries';
import { useUpdateMap } from '@/hooks/mutations';
import { setObjectProperties } from '@/editor/map-utils';
import {
  COLLISION_FOOTPRINT_OFFSET_PROPERTY_KEY,
  findCollisionFootprint,
  footprintAllowsInstanceAdjust,
  footprintOffsetRecord,
  readFootprintOffset,
  type FootprintOffset,
} from '@/lib/catalog-collision-footprint';
import {
  LOOT_SOURCE_PROPERTY_KEY,
  buildInstanceOverridesForm,
  findLootSource,
  lootBindingRecord,
  mergeInstanceOverrides,
  readInstanceOverrides,
  readLootBinding,
  type LootBindingValue,
} from '@/lib/catalog-instance-overrides';
import { notifyError, notifySuccess } from '@/stores/app-notifications-store';

interface CatalogObjectPanelProps {
  readonly projectId: string;
  readonly map: TileborneMap;
  readonly object: MapObject;
}

/** Neutral one-line summary of a catalog component, keyed only on engine tags. */
const summariseComponent = (component: GameObjectComponent): string => {
  switch (component._tag) {
    case 'collision-footprint':
      return `${component.parts.length} part${component.parts.length === 1 ? '' : 's'} · ${component.source}${
        component.reviewed ? ' · reviewed' : ''
      }`;
    case 'visual-ref':
      return `${component.width}×${component.height}`;
    case 'spawn-point':
      return 'spawn marker';
    case 'loot-source':
      return `interaction: ${component.interactionMode}`;
    case 'breakable':
      return 'breakable';
    case 'hazard':
      return 'hazard zone';
    case 'interactable':
      return `${component.kind} · ${component.radiusPx}px`;
    case 'equippable':
      return `slot: ${component.slot}`;
  }
};

/** Humanise a component tag (`collision-footprint` → `Collision footprint`). */
const componentLabel = (tag: string): string => {
  const spaced = tag.replace(/[-_]+/g, ' ').trim();
  return spaced.length === 0 ? tag : `${spaced[0]!.toUpperCase()}${spaced.slice(1)}`;
};

/**
 * Inspector panel for a placed catalog object (ADR-0025 slice 5). Resolves the
 * selected `MapObject`'s `GameObjectType` from the slice-4 `catalog:resolve` DTO
 * and renders its components read-only plus per-instance overrides through the
 * generic `AuthoringSettingsForm` mechanism. A `LootSourceComponent` surfaces a
 * loot-table picker + grant/interaction overrides. Per-instance edits persist to
 * `MapObject.properties`; catalog definitions are never mutated (decision
 * `c-cgsd`). The renderer reads only the projected DTO — never `services-plugin`.
 */
export function CatalogObjectPanel({ projectId, map, object }: CatalogObjectPanelProps) {
  const catalogQuery = useResolvedCatalog(projectId);
  const entry = catalogQuery.data?.objectTypes.find(
    (candidate) => candidate.objectType.id === object.kind,
  );

  if (catalogQuery.isLoading) {
    return (
      <div className="space-y-2" data-testid="catalog-object-panel-loading">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-full" />
      </div>
    );
  }

  if (entry === undefined) {
    return (
      <p className={cn('break-words', typography.bodyDense)} data-testid="catalog-object-unknown">
        Selected object&rsquo;s type <code className="break-all">{object.kind}</code> is not in the
        resolved catalog.
      </p>
    );
  }

  return (
    <ResolvedCatalogObjectPanel
      projectId={projectId}
      map={map}
      object={object}
      objectType={entry.objectType}
      lootTables={catalogQuery.data?.lootTables ?? []}
    />
  );
}

interface ResolvedCatalogObjectPanelProps {
  readonly projectId: string;
  readonly map: TileborneMap;
  readonly object: MapObject;
  readonly objectType: GameObjectType;
  readonly lootTables: readonly LootTable[];
}

function ResolvedCatalogObjectPanel({
  projectId,
  map,
  object,
  objectType,
  lootTables,
}: ResolvedCatalogObjectPanelProps) {
  const updateMap = useUpdateMap();
  const overridesForm = useMemo(() => buildInstanceOverridesForm(objectType), [objectType]);
  const lootSource = useMemo(() => findLootSource(objectType), [objectType]);
  const footprint = useMemo(() => findCollisionFootprint(objectType), [objectType]);

  const [draft, setDraft] = useState(() =>
    overridesForm.toDraft(readInstanceOverrides(object, objectType)),
  );
  const [lootBinding, setLootBinding] = useState<LootBindingValue | undefined>(() =>
    lootSource === undefined ? undefined : readLootBinding(object, lootSource),
  );
  const [footprintOffset, setFootprintOffset] = useState<FootprintOffset>(() =>
    readFootprintOffset(object),
  );

  // Re-sync local edit state when the selected object / its type changes.
  useEffect(() => {
    setDraft(overridesForm.toDraft(readInstanceOverrides(object, objectType)));
    setLootBinding(lootSource === undefined ? undefined : readLootBinding(object, lootSource));
    setFootprintOffset(readFootprintOffset(object));
  }, [object, objectType, overridesForm, lootSource]);

  const parsed = overridesForm.parseDraft(draft);
  const category = Option.getOrUndefined(objectType.category);

  const save = async () => {
    if (!parsed) {
      notifyError(overridesForm.invalidMessage);
      return;
    }
    let nextProperties = mergeInstanceOverrides(object, parsed);
    if (lootSource !== undefined && lootBinding !== undefined) {
      nextProperties = {
        ...nextProperties,
        [LOOT_SOURCE_PROPERTY_KEY]: lootBindingRecord(lootBinding),
      };
    }
    if (footprint !== undefined && footprintAllowsInstanceAdjust(footprint)) {
      nextProperties = {
        ...nextProperties,
        [COLLISION_FOOTPRINT_OFFSET_PROPERTY_KEY]: footprintOffsetRecord(footprintOffset),
      };
    }
    const nextMap = setObjectProperties(map, object.id, nextProperties);
    try {
      await updateMap.mutateAsync({ projectId: projectId as ProjectId, map: nextMap });
      notifySuccess('Object overrides saved');
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Object overrides save failed');
    }
  };

  return (
    <div className="space-y-3" data-testid="catalog-object-panel" data-object-type={objectType.id}>
      <div className="space-y-0.5">
        <p className={cn('break-words', typography.rowTitle)}>{objectType.label}</p>
        <p className={cn('break-words', typography.rowMeta)}>
          {objectType.family}
          {category === undefined ? '' : ` · ${category}`}
        </p>
      </div>

      <section className="space-y-1" data-testid="catalog-object-components">
        <p className={cn('px-0.5', typography.sectionLabelMicro)}>Components</p>
        {objectType.components.length === 0 ? (
          <p className={cn('px-0.5', typography.bodyMicro)}>No components.</p>
        ) : (
          <ul className="space-y-1">
            {objectType.components.map((component, index) => (
              <li
                key={`${component._tag}-${index}`}
                data-testid={`catalog-component-${component._tag}`}
                className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-2 py-1"
              >
                <span className={cn('min-w-0 truncate', typography.rowTitle)}>
                  {componentLabel(component._tag)}
                </span>
                <span className={cn('shrink-0 truncate', typography.rowMeta)}>
                  {summariseComponent(component)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {footprint !== undefined ? (
        <>
          <Separator />
          <CollisionFootprintSection
            footprint={footprint}
            offset={footprintOffset}
            onOffsetChange={setFootprintOffset}
          />
        </>
      ) : null}

      {overridesForm.fields.length > 0 ? (
        <section className="space-y-1" data-testid="catalog-object-overrides">
          <p className={cn('px-0.5', typography.sectionLabelMicro)}>Per-instance overrides</p>
          <div className="grid grid-cols-2 gap-2">
            {overridesForm.fields.map((field) => (
              <label key={field.key} className="min-w-0 space-y-1">
                <span className={cn('block truncate', typography.rowMeta)}>{field.label}</span>
                <Input
                  type="number"
                  min={field.min}
                  step={field.step}
                  value={draft[field.key] ?? ''}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                  data-testid={`catalog-override-${field.key}`}
                />
              </label>
            ))}
          </div>
        </section>
      ) : null}

      {lootSource !== undefined && lootBinding !== undefined ? (
        <>
          <Separator />
          <LootSourceBinding
            lootTables={lootTables}
            value={lootBinding}
            onChange={setLootBinding}
          />
        </>
      ) : null}

      <Button
        type="button"
        size="sm"
        className="w-full"
        disabled={updateMap.isPending || parsed === undefined}
        onClick={() => void save()}
        data-testid="catalog-object-save"
      >
        <SaveIcon className="size-3.5" aria-hidden />
        Save object overrides
      </Button>
    </div>
  );
}
