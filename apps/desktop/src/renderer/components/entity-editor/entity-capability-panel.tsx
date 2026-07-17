import type {
  BreakableComponent,
  CollisionFootprintComponent,
  CollisionFootprintPart,
  EquippableComponent,
  GameObjectComponent,
  GameObjectType,
  ItemDefinition,
  HazardComponent,
  InteractableComponent,
  JsonObject,
  LootSourceComponent,
  LootTable,
  OverlayVisualComponent,
  SpawnPointComponent,
  VisualRefComponent,
  WeaponRefComponent,
} from '@tileborne/core';
import {
  CollisionFootprintPart as CollisionFootprintPartClass,
  BreakableComponent as BreakableComponentClass,
  CollisionFootprintComponent as CollisionFootprintComponentClass,
  EquippableComponent as EquippableComponentClass,
  HazardComponent as HazardComponentClass,
  InteractableComponent as InteractableComponentClass,
  LootSourceComponent as LootSourceComponentClass,
  OverlayVisualComponent as OverlayVisualComponentClass,
  SpawnPointComponent as SpawnPointComponentClass,
  GameObjectType as GameObjectTypeClass,
  WeaponRefComponent as WeaponRefComponentClass,
  type GameObjectTypeId,
  type OpenTag,
} from '@tileborne/core';
import { Button, Checkbox, Input, Label, cn, typography } from '@tileborne/ui';
import { Option } from 'effect';
import { ImageIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';

import { LibraryPreviewThumb } from '@/components/asset-library/library-preview-thumb';
import {
  SchemaFieldControls,
  type AuthoringReferenceOptions,
} from '@/components/authoring/schema-field-controls';
import { SpritePickerDialog } from '@/components/entity-editor/sprite-picker-dialog';
import type { ResolvedPlaceableVisual } from '@/hooks/use-placeable-visual';
import {
  CAPABILITY_OPTIONS,
  capabilityLabel,
  defaultComponentForTag,
  entityWithComponent,
  entityWithoutComponent,
  visualRefWithPatch,
  type ComponentTag,
} from '@/lib/entity-authoring';

export interface EntityOption {
  readonly id: string;
  readonly label: string;
  readonly previewUrl?: string;
}

export interface EntityCapabilityPanelProps {
  readonly entity: GameObjectType;
  readonly readOnly: boolean;
  /** All merged catalog entities, for weapon-ref companion selects. */
  readonly entityOptions: readonly EntityOption[];
  readonly lootTables: readonly LootTable[];
  readonly weaponOptions: readonly EntityOption[];
  readonly items: readonly ItemDefinition[];
  readonly assetOptions: readonly EntityOption[];
  /** Label of the active palette asset, shown on the assign button. */
  readonly activeAssetLabel: string | undefined;
  /** Resolved preview of the entity's assigned `visual-ref` placeable. */
  readonly assignedSprite: ResolvedPlaceableVisual | undefined;
  readonly onAssignActiveAsset: () => void;
  readonly onChange: (entity: GameObjectType) => void;
}

const selectClassName =
  'h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50';

const numberValue = (value: string): number | undefined => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** JSON object field with local text state; commits on blur when parseable. */
function JsonField({
  id,
  label,
  value,
  disabled,
  onCommit,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: JsonObject;
  readonly disabled: boolean;
  readonly onCommit: (next: JsonObject) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [invalid, setInvalid] = useState(false);
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <textarea
        id={id}
        className={cn(
          'min-h-20 w-full rounded-md border border-input bg-transparent px-2 py-1 font-mono text-xs shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50',
          invalid ? 'border-destructive' : '',
        )}
        value={text}
        disabled={disabled}
        onChange={(event) => setText(event.currentTarget.value)}
        onBlur={() => {
          try {
            const parsed: unknown = JSON.parse(text);
            if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
              setInvalid(false);
              onCommit(parsed as JsonObject);
              return;
            }
            setInvalid(true);
          } catch {
            setInvalid(true);
          }
        }}
        data-testid={id}
      />
      {invalid ? (
        <p className={cn('text-destructive', typography.bodyMicro)}>Must be a JSON object.</p>
      ) : null}
    </div>
  );
}

function CompanionSelect({
  id,
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string | undefined;
  readonly options: readonly EntityOption[];
  readonly disabled: boolean;
  readonly onChange: (value: string | undefined) => void;
}) {
  return (
    <label className="block min-w-0 space-y-1">
      <span className={cn('block truncate', typography.rowMeta)}>{label}</span>
      <select
        className={selectClassName}
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)}
        data-testid={id}
      >
        <option value="">None</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Right-rail capability editor of the Entity Editor (ADR-0028): add, remove,
 * and parameterize the entity's `GameObjectComponent`s via typed forms. The
 * panel only patches the draft entity — persistence stays with the page.
 */
export function EntityCapabilityPanel({
  entity,
  readOnly,
  entityOptions,
  lootTables,
  weaponOptions,
  items,
  assetOptions,
  activeAssetLabel,
  assignedSprite,
  onAssignActiveAsset,
  onChange,
}: EntityCapabilityPanelProps) {
  const presentTags = new Set(entity.components.map((component) => component._tag));
  const addable = CAPABILITY_OPTIONS.filter((option) => !presentTags.has(option.tag));
  const [pendingTag, setPendingTag] = useState<ComponentTag | ''>('');

  const patchComponent = (component: GameObjectComponent) =>
    onChange(entityWithComponent(entity, component));
  const removeComponent = (tag: ComponentTag) => onChange(entityWithoutComponent(entity, tag));

  return (
    <div className="space-y-3" data-testid="entity-capability-panel">
      <div className="flex items-center justify-between gap-2">
        <p className={typography.panelTitle}>Capabilities</p>
        {readOnly ? null : (
          <div className="flex items-center gap-1">
            <select
              className={cn(selectClassName, 'h-7 w-44')}
              value={pendingTag}
              onChange={(event) => setPendingTag(event.target.value as ComponentTag | '')}
              data-testid="entity-capability-add-select"
            >
              <option value="">Add capability…</option>
              {addable.map((option) => (
                <option key={option.tag} value={option.tag}>
                  {option.label}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2"
              disabled={pendingTag === ''}
              onClick={() => {
                if (pendingTag !== '') {
                  patchComponent(defaultComponentForTag(pendingTag));
                  setPendingTag('');
                }
              }}
              data-testid="entity-capability-add"
            >
              <PlusIcon className="size-3.5" aria-hidden />
            </Button>
          </div>
        )}
      </div>

      {entity.instanceFields === undefined || entity.instanceFields.length === 0 ? null : (
        <section
          className="rounded-md border border-border bg-card p-2"
          data-testid="entity-instance-fields"
        >
          <p className={typography.rowTitle}>Instance properties</p>
          <div className="mt-2">
            <SchemaFieldControls
              fields={entity.instanceFields}
              values={entity.instanceDefaults}
              references={
                {
                  asset: assetOptions,
                  entity: entityOptions,
                  weapon: weaponOptions,
                  item: items.map((item) => ({ id: String(item.id), label: item.label })),
                  'loot-table': lootTables.map((table) => ({
                    id: String(table.id),
                    label: table.label,
                  })),
                } satisfies AuthoringReferenceOptions
              }
              disabled={readOnly}
              testIdPrefix="entity-instance"
              onChange={(instanceDefaults) =>
                onChange(new GameObjectTypeClass({ ...entity, instanceDefaults }))
              }
            />
          </div>
        </section>
      )}

      {entity.components.length === 0 ? (
        <p className={cn('px-0.5 text-muted-foreground', typography.rowMeta)}>
          No capabilities yet. Add a visual first, then gameplay capabilities.
        </p>
      ) : null}

      {entity.components.map((component) => (
        <section
          key={component._tag}
          className="rounded-md border border-border bg-card p-2"
          data-testid={`entity-capability-${component._tag}`}
        >
          <div className="flex items-center justify-between gap-2">
            <p className={typography.rowTitle}>{capabilityLabel(component._tag)}</p>
            {readOnly ? null : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-6 px-1.5 text-muted-foreground"
                onClick={() => removeComponent(component._tag)}
                data-testid={`entity-capability-remove-${component._tag}`}
              >
                <Trash2Icon className="size-3.5" aria-hidden />
              </Button>
            )}
          </div>
          <div className="mt-2">
            <CapabilityForm
              component={component}
              entity={entity}
              readOnly={readOnly}
              entityOptions={entityOptions}
              weaponOptions={weaponOptions}
              lootTables={lootTables}
              activeAssetLabel={activeAssetLabel}
              assignedSprite={assignedSprite}
              onAssignActiveAsset={onAssignActiveAsset}
              onPatch={patchComponent}
            />
          </div>
        </section>
      ))}
    </div>
  );
}

function CapabilityForm({
  component,
  entity,
  readOnly,
  entityOptions,
  weaponOptions,
  lootTables,
  activeAssetLabel,
  assignedSprite,
  onAssignActiveAsset,
  onPatch,
}: {
  readonly component: GameObjectComponent;
  readonly entity: GameObjectType;
  readonly readOnly: boolean;
  readonly entityOptions: readonly EntityOption[];
  readonly weaponOptions: readonly EntityOption[];
  readonly lootTables: readonly LootTable[];
  readonly activeAssetLabel: string | undefined;
  readonly assignedSprite: ResolvedPlaceableVisual | undefined;
  readonly onAssignActiveAsset: () => void;
  readonly onPatch: (component: GameObjectComponent) => void;
}) {
  switch (component._tag) {
    case 'visual-ref':
      return (
        <VisualRefForm
          component={component}
          readOnly={readOnly}
          activeAssetLabel={activeAssetLabel}
          assignedSprite={assignedSprite}
          onAssignActiveAsset={onAssignActiveAsset}
          onPatch={onPatch}
        />
      );
    case 'collision-footprint':
      return <CollisionFootprintForm component={component} readOnly={readOnly} onPatch={onPatch} />;
    case 'equippable':
      return (
        <EquippableForm
          component={component}
          entity={entity}
          readOnly={readOnly}
          onPatch={onPatch}
        />
      );
    case 'weapon-ref':
      return (
        <WeaponRefForm
          component={component}
          readOnly={readOnly}
          entityOptions={entityOptions}
          weaponOptions={weaponOptions}
          onPatch={onPatch}
        />
      );
    case 'loot-source':
      return (
        <LootSourceForm
          component={component}
          readOnly={readOnly}
          lootTables={lootTables}
          onPatch={onPatch}
        />
      );
    case 'breakable':
      return (
        <BreakableForm
          component={component}
          readOnly={readOnly}
          lootTables={lootTables}
          onPatch={onPatch}
        />
      );
    case 'hazard':
      return <HazardForm component={component} readOnly={readOnly} onPatch={onPatch} />;
    case 'interactable':
      return <InteractableForm component={component} readOnly={readOnly} onPatch={onPatch} />;
    case 'overlay-visual':
      return <OverlayVisualForm component={component} readOnly={readOnly} onPatch={onPatch} />;
    case 'spawn-point':
      return <SpawnPointForm component={component} readOnly={readOnly} onPatch={onPatch} />;
  }
}

function VisualRefForm({
  component,
  readOnly,
  activeAssetLabel,
  assignedSprite,
  onAssignActiveAsset,
  onPatch,
}: {
  readonly component: VisualRefComponent;
  readonly readOnly: boolean;
  readonly activeAssetLabel: string | undefined;
  readonly assignedSprite: ResolvedPlaceableVisual | undefined;
  readonly onAssignActiveAsset: () => void;
  readonly onPatch: (component: GameObjectComponent) => void;
}) {
  const placeable = Option.getOrUndefined(component.placeableId);
  const asset = Option.getOrUndefined(component.assetId);
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        {assignedSprite !== undefined && assignedSprite.preview !== undefined ? (
          <span className="flex min-w-0 items-center gap-2" data-testid="entity-visual-preview">
            <LibraryPreviewThumb
              packId={assignedSprite.packId}
              preview={assignedSprite.preview}
              sizePx={40}
              integrityHash={assignedSprite.integrityHash}
              alt={assignedSprite.name}
            />
            <span className="min-w-0">
              <span className={cn('block truncate', typography.rowTitle)}>
                {assignedSprite.name}
              </span>
              <span className={cn('block truncate text-muted-foreground', typography.bodyMicro)}>
                {assignedSprite.packName}
              </span>
            </span>
          </span>
        ) : (
          <p className={cn('min-w-0 truncate text-muted-foreground', typography.bodyMicro)}>
            {placeable ?? asset ?? 'No sprite assigned'}
          </p>
        )}
        {readOnly ? null : (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              size="sm"
              className="h-7 px-2"
              onClick={() => setPickerOpen(true)}
              data-testid="entity-visual-browse"
            >
              <ImageIcon className="size-3.5" aria-hidden />
              {placeable === undefined && asset === undefined ? 'Choose sprite…' : 'Change…'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2"
              disabled={activeAssetLabel === undefined}
              title="Assign the sprite currently selected in the working palette"
              onClick={onAssignActiveAsset}
              data-testid="entity-visual-use-active"
            >
              {activeAssetLabel === undefined ? 'Use palette item' : `Use ${activeAssetLabel}`}
            </Button>
          </div>
        )}
      </div>
      {readOnly ? null : (
        <SpritePickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          selectedPlaceableId={placeable === undefined ? undefined : String(placeable)}
          onSelect={(selection) =>
            onPatch(
              visualRefWithPatch(component, {
                placeableId: selection.placeableId,
                width: selection.width,
                height: selection.height,
              }),
            )
          }
        />
      )}
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <Label htmlFor="entity-visual-width">Width</Label>
          <Input
            id="entity-visual-width"
            type="number"
            min={1}
            value={component.width}
            disabled={readOnly}
            onChange={(event) => {
              const width = numberValue(event.currentTarget.value);
              if (width !== undefined) {
                onPatch(visualRefWithPatch(component, { width }));
              }
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="entity-visual-height">Height</Label>
          <Input
            id="entity-visual-height"
            type="number"
            min={1}
            value={component.height}
            disabled={readOnly}
            onChange={(event) => {
              const height = numberValue(event.currentTarget.value);
              if (height !== undefined) {
                onPatch(visualRefWithPatch(component, { height }));
              }
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="entity-visual-rotation">Rotation offset</Label>
          <Input
            id="entity-visual-rotation"
            type="number"
            step={1}
            value={component.rotationOffsetDeg ?? 0}
            disabled={readOnly}
            onChange={(event) => {
              const rotationOffsetDeg = numberValue(event.currentTarget.value);
              if (rotationOffsetDeg !== undefined) {
                onPatch(visualRefWithPatch(component, { rotationOffsetDeg }));
              }
            }}
          />
        </div>
      </div>
      <p className={cn('text-muted-foreground', typography.bodyMicro)}>
        Anchors are edited on the canvas (left) and in the Anchors section.
      </p>
    </div>
  );
}

function CollisionFootprintForm({
  component,
  readOnly,
  onPatch,
}: {
  readonly component: CollisionFootprintComponent;
  readonly readOnly: boolean;
  readonly onPatch: (component: GameObjectComponent) => void;
}) {
  const patch = (
    next: Partial<{
      source: CollisionFootprintComponent['source'];
      reviewed: boolean;
      parts: readonly CollisionFootprintPart[];
    }>,
  ) =>
    onPatch(
      new CollisionFootprintComponentClass({
        source: next.source ?? component.source,
        reviewed: next.reviewed ?? component.reviewed,
        parts: [...(next.parts ?? component.parts)],
      }),
    );

  const patchPart = (index: number, partPatch: Partial<CollisionFootprintPart>) =>
    patch({
      parts: component.parts.map((part, i) =>
        i === index ? new CollisionFootprintPartClass({ ...part, ...partPatch }) : part,
      ),
    });

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5">
          <Checkbox
            checked={component.reviewed}
            disabled={readOnly}
            onCheckedChange={(checked) => patch({ reviewed: checked === true })}
          />
          <span className={typography.rowMeta}>Reviewed</span>
        </label>
        <select
          className={cn(selectClassName, 'h-7 w-28')}
          value={component.source}
          disabled={readOnly}
          onChange={(event) =>
            patch({ source: event.target.value as CollisionFootprintComponent['source'] })
          }
        >
          {(['manual', 'tiled', 'generated'] as const).map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>
      </div>
      {component.parts.map((part, index) => (
        <div key={index} className="rounded border border-border/70 p-1.5">
          <div className="grid grid-cols-4 gap-1.5">
            {(['x', 'y', 'width', 'height'] as const).map((field) => (
              <Input
                key={field}
                type="number"
                aria-label={`part ${index} ${field}`}
                value={part[field]}
                disabled={readOnly}
                onChange={(event) => {
                  const value = numberValue(event.currentTarget.value);
                  if (value !== undefined) {
                    patchPart(index, { [field]: value });
                  }
                }}
              />
            ))}
          </div>
          <div className="mt-1.5 flex items-center gap-3">
            {(
              [
                ['blocksMovement', 'Move'],
                ['blocksProjectiles', 'Shots'],
                ['blocksVision', 'Vision'],
              ] as const
            ).map(([field, label]) => (
              <label key={field} className="flex items-center gap-1">
                <Checkbox
                  checked={part[field]}
                  disabled={readOnly}
                  onCheckedChange={(checked) => patchPart(index, { [field]: checked === true })}
                />
                <span className={typography.bodyMicro}>{label}</span>
              </label>
            ))}
            {readOnly ? null : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="ml-auto h-6 px-1.5 text-muted-foreground"
                onClick={() => patch({ parts: component.parts.filter((_, i) => i !== index) })}
              >
                <Trash2Icon className="size-3" aria-hidden />
              </Button>
            )}
          </div>
        </div>
      ))}
      {readOnly ? null : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2"
          onClick={() =>
            patch({
              parts: [
                ...component.parts,
                new CollisionFootprintPartClass({
                  x: 0,
                  y: 0,
                  width: 1,
                  height: 1,
                  blocksMovement: true,
                  blocksProjectiles: false,
                  blocksVision: false,
                }),
              ],
            })
          }
          data-testid="entity-footprint-add-part"
        >
          <PlusIcon className="size-3.5" aria-hidden />
          Add part
        </Button>
      )}
    </div>
  );
}

/**
 * Editor for the overlay slot an entity claims. Slots are open tags owned by
 * the consuming game mode (BR ships shield/shadow/hazard); the datalist offers
 * the well-known ones while still accepting any custom slot name.
 */
function OverlayVisualForm({
  component,
  readOnly,
  onPatch,
}: {
  readonly component: OverlayVisualComponent;
  readonly readOnly: boolean;
  readonly onPatch: (component: GameObjectComponent) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor="entity-overlay-slot">Overlay slot</Label>
      <Input
        id="entity-overlay-slot"
        list="entity-overlay-slot-options"
        value={String(component.slot)}
        disabled={readOnly}
        data-testid="entity-overlay-slot"
        onChange={(event) =>
          onPatch(new OverlayVisualComponentClass({ slot: event.currentTarget.value as OpenTag }))
        }
      />
      <datalist id="entity-overlay-slot-options">
        <option value="shield" />
        <option value="shadow" />
        <option value="hazard" />
      </datalist>
      <p className={typography.rowMeta}>
        The entity&apos;s sprite renders in this runtime overlay slot. A project entity claiming a
        slot overrides the plugin default.
      </p>
    </div>
  );
}

function EquippableForm({
  component,
  entity,
  readOnly,
  onPatch,
}: {
  readonly component: EquippableComponent;
  readonly entity: GameObjectType;
  readonly readOnly: boolean;
  readonly onPatch: (component: GameObjectComponent) => void;
}) {
  const visualRef = entity.components.find(
    (candidate): candidate is VisualRefComponent => candidate._tag === 'visual-ref',
  );
  const anchorNames = [
    ...new Set([...Object.keys(visualRef?.anchors ?? {}), String(component.attachAnchor)]),
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-1">
        <Label htmlFor="entity-equippable-slot">Slot</Label>
        <Input
          id="entity-equippable-slot"
          value={String(component.slot)}
          disabled={readOnly}
          onChange={(event) =>
            onPatch(
              new EquippableComponentClass({
                slot: event.currentTarget.value as OpenTag,
                attachAnchor: component.attachAnchor,
              }),
            )
          }
        />
      </div>
      <label className="block min-w-0 space-y-1">
        <span className={cn('block', typography.rowMeta)}>Attach anchor</span>
        <select
          className={selectClassName}
          value={String(component.attachAnchor)}
          disabled={readOnly}
          onChange={(event) =>
            onPatch(
              new EquippableComponentClass({
                slot: component.slot,
                attachAnchor: event.target.value as EquippableComponent['attachAnchor'],
              }),
            )
          }
          data-testid="entity-equippable-anchor"
        >
          {anchorNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function WeaponRefForm({
  component,
  readOnly,
  entityOptions,
  weaponOptions,
  onPatch,
}: {
  readonly component: WeaponRefComponent;
  readonly readOnly: boolean;
  readonly entityOptions: readonly EntityOption[];
  readonly weaponOptions: readonly EntityOption[];
  readonly onPatch: (component: GameObjectComponent) => void;
}) {
  const patch = (
    next: Partial<{
      weaponId: WeaponRefComponent['weaponId'];
      projectileEntityId: GameObjectTypeId | undefined;
      muzzleFlashEntityId: GameObjectTypeId | undefined;
      impactVfxEntityId: GameObjectTypeId | undefined;
      pickupEntityId: GameObjectTypeId | undefined;
      muzzleFlashDurationMs: number | undefined;
      impactVfxDurationMs: number | undefined;
    }>,
  ) => {
    const merged = {
      weaponId: component.weaponId,
      projectileEntityId: component.projectileEntityId,
      muzzleFlashEntityId: component.muzzleFlashEntityId,
      impactVfxEntityId: component.impactVfxEntityId,
      pickupEntityId: component.pickupEntityId,
      muzzleFlashDurationMs: component.muzzleFlashDurationMs,
      impactVfxDurationMs: component.impactVfxDurationMs,
      ...next,
    };
    onPatch(
      new WeaponRefComponentClass({
        weaponId: merged.weaponId,
        ...(merged.projectileEntityId === undefined
          ? {}
          : { projectileEntityId: merged.projectileEntityId }),
        ...(merged.muzzleFlashEntityId === undefined
          ? {}
          : { muzzleFlashEntityId: merged.muzzleFlashEntityId }),
        ...(merged.impactVfxEntityId === undefined
          ? {}
          : { impactVfxEntityId: merged.impactVfxEntityId }),
        ...(merged.pickupEntityId === undefined ? {} : { pickupEntityId: merged.pickupEntityId }),
        ...(merged.muzzleFlashDurationMs === undefined
          ? {}
          : { muzzleFlashDurationMs: merged.muzzleFlashDurationMs }),
        ...(merged.impactVfxDurationMs === undefined
          ? {}
          : { impactVfxDurationMs: merged.impactVfxDurationMs }),
      }),
    );
  };

  const companion = (
    field: 'projectileEntityId' | 'muzzleFlashEntityId' | 'impactVfxEntityId' | 'pickupEntityId',
    label: string,
  ) => (
    <CompanionSelect
      id={`entity-weapon-${field}`}
      label={label}
      value={component[field] === undefined ? undefined : String(component[field])}
      options={entityOptions}
      disabled={readOnly}
      onChange={(value) => patch({ [field]: value as GameObjectTypeId | undefined })}
    />
  );

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label htmlFor="entity-weapon-id">Weapon</Label>
        <select
          id="entity-weapon-id"
          className={selectClassName}
          value={String(component.weaponId)}
          disabled={readOnly}
          onChange={(event) =>
            patch({ weaponId: event.currentTarget.value as WeaponRefComponent['weaponId'] })
          }
        >
          {!weaponOptions.some((option) => option.id === component.weaponId) ? (
            <option value={component.weaponId}>Missing: {component.weaponId}</option>
          ) : null}
          {weaponOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {companion('projectileEntityId', 'Projectile')}
        {companion('muzzleFlashEntityId', 'Muzzle flash')}
        {companion('impactVfxEntityId', 'Impact VFX')}
        {companion('pickupEntityId', 'Pickup')}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="entity-weapon-muzzle-duration">Muzzle flash ms</Label>
          <Input
            id="entity-weapon-muzzle-duration"
            type="number"
            min={0}
            value={component.muzzleFlashDurationMs ?? ''}
            disabled={readOnly}
            onChange={(event) =>
              patch({ muzzleFlashDurationMs: numberValue(event.currentTarget.value) })
            }
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="entity-weapon-impact-duration">Impact VFX ms</Label>
          <Input
            id="entity-weapon-impact-duration"
            type="number"
            min={0}
            value={component.impactVfxDurationMs ?? ''}
            disabled={readOnly}
            onChange={(event) =>
              patch({ impactVfxDurationMs: numberValue(event.currentTarget.value) })
            }
          />
        </div>
      </div>
    </div>
  );
}

function LootSourceForm({
  component,
  readOnly,
  lootTables,
  onPatch,
}: {
  readonly component: LootSourceComponent;
  readonly readOnly: boolean;
  readonly lootTables: readonly LootTable[];
  readonly onPatch: (component: GameObjectComponent) => void;
}) {
  const patch = (
    next: Partial<{
      lootTableId: LootSourceComponent['lootTableId'];
      interactionMode: LootSourceComponent['interactionMode'];
    }>,
  ) =>
    onPatch(
      new LootSourceComponentClass({
        lootTableId: next.lootTableId ?? component.lootTableId,
        interactionMode: next.interactionMode ?? component.interactionMode,
        grants: component.grants,
        ...(component.grantRefs === undefined ? {} : { grantRefs: component.grantRefs }),
      }),
    );

  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="block min-w-0 space-y-1">
        <span className={cn('block', typography.rowMeta)}>Loot table</span>
        <select
          className={selectClassName}
          value={Option.getOrUndefined(component.lootTableId) ?? ''}
          disabled={readOnly}
          onChange={(event) =>
            patch({
              lootTableId:
                event.target.value === ''
                  ? Option.none()
                  : Option.some(event.target.value as LootTable['id']),
            })
          }
          data-testid="entity-loot-table"
        >
          <option value="">None</option>
          {lootTables.map((table) => (
            <option key={table.id} value={table.id}>
              {table.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block min-w-0 space-y-1">
        <span className={cn('block', typography.rowMeta)}>Interaction</span>
        <select
          className={selectClassName}
          value={component.interactionMode}
          disabled={readOnly}
          onChange={(event) =>
            patch({ interactionMode: event.target.value as LootSourceComponent['interactionMode'] })
          }
        >
          {(['auto', 'tap', 'hold'] as const).map((mode) => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function BreakableForm({
  component,
  readOnly,
  lootTables,
  onPatch,
}: {
  readonly component: BreakableComponent;
  readonly readOnly: boolean;
  readonly lootTables: readonly LootTable[];
  readonly onPatch: (component: GameObjectComponent) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-1">
        <Label htmlFor="entity-breakable-hp">HP</Label>
        <Input
          id="entity-breakable-hp"
          type="number"
          min={1}
          value={component.hp}
          disabled={readOnly}
          onChange={(event) => {
            const hp = numberValue(event.currentTarget.value);
            if (hp !== undefined) {
              onPatch(new BreakableComponentClass({ hp, dropTableId: component.dropTableId }));
            }
          }}
        />
      </div>
      <label className="block min-w-0 space-y-1">
        <span className={cn('block', typography.rowMeta)}>Drop table</span>
        <select
          className={selectClassName}
          value={Option.getOrUndefined(component.dropTableId) ?? ''}
          disabled={readOnly}
          onChange={(event) =>
            onPatch(
              new BreakableComponentClass({
                hp: component.hp,
                dropTableId:
                  event.target.value === ''
                    ? Option.none()
                    : Option.some(event.target.value as LootTable['id']),
              }),
            )
          }
        >
          <option value="">None</option>
          {lootTables.map((table) => (
            <option key={table.id} value={table.id}>
              {table.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function HazardForm({
  component,
  readOnly,
  onPatch,
}: {
  readonly component: HazardComponent;
  readonly readOnly: boolean;
  readonly onPatch: (component: GameObjectComponent) => void;
}) {
  return (
    <JsonField
      id="entity-hazard-data"
      label="Hazard data"
      value={component.data}
      disabled={readOnly}
      onCommit={(data) => onPatch(new HazardComponentClass({ data }))}
    />
  );
}

function SpawnPointForm({
  component,
  readOnly,
  onPatch,
}: {
  readonly component: SpawnPointComponent;
  readonly readOnly: boolean;
  readonly onPatch: (component: GameObjectComponent) => void;
}) {
  return (
    <JsonField
      id="entity-spawn-data"
      label="Spawn data"
      value={component.data}
      disabled={readOnly}
      onCommit={(data) => onPatch(new SpawnPointComponentClass({ data }))}
    />
  );
}

function InteractableForm({
  component,
  readOnly,
  onPatch,
}: {
  readonly component: InteractableComponent;
  readonly readOnly: boolean;
  readonly onPatch: (component: GameObjectComponent) => void;
}) {
  const patch = (next: Partial<{ kind: string; radiusPx: number; parameters: JsonObject }>) =>
    onPatch(
      new InteractableComponentClass({
        kind: (next.kind ?? String(component.kind)) as OpenTag,
        radiusPx: next.radiusPx ?? component.radiusPx,
        parameters: next.parameters ?? component.parameters,
      }),
    );
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="entity-interactable-kind">Kind</Label>
          <Input
            id="entity-interactable-kind"
            value={String(component.kind)}
            disabled={readOnly}
            onChange={(event) => patch({ kind: event.currentTarget.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="entity-interactable-radius">Radius px</Label>
          <Input
            id="entity-interactable-radius"
            type="number"
            min={0}
            value={component.radiusPx}
            disabled={readOnly}
            onChange={(event) => {
              const radiusPx = numberValue(event.currentTarget.value);
              if (radiusPx !== undefined) {
                patch({ radiusPx });
              }
            }}
          />
        </div>
      </div>
      <JsonField
        id="entity-interactable-parameters"
        label="Parameters"
        value={component.parameters}
        disabled={readOnly}
        onCommit={(parameters) => patch({ parameters })}
      />
    </div>
  );
}
