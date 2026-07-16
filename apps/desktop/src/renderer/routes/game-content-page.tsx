import { Link, useParams } from '@tanstack/react-router';
import {
  GameObjectType,
  ItemGrant,
  LootSourceComponent,
  WeaponRefComponent,
  makeItemDefinitionId,
  makeLootTableId,
  makeWeaponDefinitionId,
  type Uuid,
} from '@tileborne/core';
import { Badge, Button, Input, ScrollArea, cn, typography } from '@tileborne/ui';
import { Option, Schema } from 'effect';
import { CopyIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  useDuplicateCatalogDefinition,
  useRemoveCatalogDefinition,
  useUpsertCatalogDefinition,
  useUpsertCatalogType,
} from '@/hooks/mutations';
import { useProject, useResolvedCatalog } from '@/hooks/queries';
import { usePlaceableVisual } from '@/hooks/use-placeable-visual';
import { assetThumbnailUrl } from '@/lib/asset-url';
import { documentLifecycle, useDocumentLifecycle } from '@/lib/document-lifecycle';
import { notifyError, notifySuccess } from '@/stores/app-notifications-store';

type ContentTab = 'objects' | 'weapons' | 'items' | 'loot';
const rarityOptions = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;
const freshUuid = (): Uuid => crypto.randomUUID() as Uuid;

const visualFor = (objectType: GameObjectType) =>
  objectType.components.find((component) => component._tag === 'visual-ref');

export function GameContentPage() {
  const { projectId } = useParams({ from: '/editor/projects/$projectId/game-content' });
  const catalogQuery = useResolvedCatalog(projectId);
  const projectQuery = useProject(projectId);
  const catalog = catalogQuery.data;
  const activeModeId = typeof projectQuery.data?.project.settings?.activeGameMode === 'string'
    ? projectQuery.data.project.settings.activeGameMode
    : undefined;
  const upsert = useUpsertCatalogDefinition();
  const duplicate = useDuplicateCatalogDefinition();
  const remove = useRemoveCatalogDefinition();
  const upsertType = useUpsertCatalogType();
  const [tab, setTab] = useState<ContentTab>('objects');
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState('consumable');
  const [rarity, setRarity] = useState<(typeof rarityOptions)[number]>('common');
  const [visualEntityId, setVisualEntityId] = useState('');
  const [selectedItemId, setSelectedItemId] = useState('');
  const [weight, setWeight] = useState('1');
  const [damage, setDamage] = useState('20');
  const [cooldown, setCooldown] = useState('8');
  const [magazine, setMagazine] = useState('12');
  const [reload, setReload] = useState('30');

  const visualObjects = useMemo(
    () =>
      catalog?.objectTypes.filter(
        ({ objectType, origin }) => origin === 'project' && visualFor(objectType) !== undefined,
      ) ?? [],
    [catalog?.objectTypes],
  );
  const visibleWeapons = useMemo(
    () => (catalog?.weapons ?? []).filter(({ origin, sourcePluginId }) =>
      origin === 'project' || activeModeId === undefined || String(sourcePluginId) === activeModeId),
    [activeModeId, catalog?.weapons],
  );
  const isProject = (id: string) => catalog?.definitionProvenance?.[id] !== undefined;
  const busy = upsert.isPending || duplicate.isPending || remove.isPending || upsertType.isPending;

  const reportFailure = (message: string) => {
    notifyError(message);
    return false as const;
  };
  const resetContentDraft = () => {
    setLabel('');
    setCategory('consumable');
    setRarity('common');
    setVisualEntityId('');
    setSelectedItemId('');
    setWeight('1');
    setDamage('20');
    setCooldown('8');
    setMagazine('12');
    setReload('30');
  };
  const duplicateDefinition = async (kind: 'object-type' | 'weapon' | 'item' | 'loot-table', id: string, name: string) => {
    try {
      const result = await duplicate.mutateAsync({ projectId, kind, definitionId: id, label: `${name} copy` });
      if (!result.duplicated) return reportFailure(result.report.issues[0]?.message ?? 'Could not duplicate template');
      notifySuccess(`Created editable ${name} copy`);
    } catch (error) {
      reportFailure(error instanceof Error ? error.message : 'Could not duplicate content');
    }
  };

  const removeDefinition = async (kind: 'weapon' | 'item' | 'loot-table', id: string) => {
    try {
      const result = await remove.mutateAsync({ projectId, kind, definitionId: id });
      if (!result.removed) return reportFailure(result.blockedBy.length > 0 ? `Still used by ${result.blockedBy.join(', ')}` : 'Definition is not project-owned');
      notifySuccess('Content removed');
    } catch (error) {
      reportFailure(error instanceof Error ? error.message : 'Could not remove content');
    }
  };

  const createItem = async () => {
    const visualObject = catalog?.objectTypes.find(({ objectType }) => String(objectType.id) === visualEntityId)?.objectType;
    const visual = visualObject === undefined ? undefined : visualFor(visualObject);
    if (label.trim().length === 0 || visualObject === undefined || visual?.placeableId === undefined || Option.isNone(visual.placeableId)) {
      return reportFailure('Name and a real visual/pickup entity are required.');
    }
    const id = makeItemDefinitionId(freshUuid());
    const definition = {
      id,
      label: label.trim(),
      category,
      data: { itemKind: label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'), tier: rarity, visualPlaceableId: visual.placeableId.value },
    };
    const pickup = new GameObjectType({
      ...visualObject,
      components: [
        ...visualObject.components.filter((component) => component._tag !== 'loot-source'),
        new LootSourceComponent({
          lootTableId: Option.none(),
          interactionMode: 'tap',
          grants: {},
          grantRefs: [new ItemGrant({ itemId: id })],
        }),
      ],
    });
    try {
      const result = await upsert.mutateAsync({ projectId, kind: 'item', definitionJson: definition });
      if (!result.saved) return reportFailure(result.report.issues[0]?.message ?? 'Item was not saved');
      await upsertType.mutateAsync({ projectId, objectTypeJson: Schema.encodeUnknownSync(GameObjectType)(pickup) });
      notifySuccess(`Created ${definition.label} and linked its pickup visual`);
      resetContentDraft();
      return true;
    } catch (error) {
      reportFailure(error instanceof Error ? error.message : 'Could not create item');
    }
  };

  const createLootTable = async () => {
    const item = catalog?.items.find((entry) => String(entry.id) === selectedItemId);
    const parsedWeight = Number(weight);
    if (label.trim().length === 0 || item === undefined || !Number.isFinite(parsedWeight) || parsedWeight <= 0) {
      return reportFailure('Name, item and a positive weight are required.');
    }
    const definition = {
      id: makeLootTableId(freshUuid()),
      label: label.trim(),
      entries: [{ itemId: item.id, tier: rarity, weight: parsedWeight }],
    };
    try {
      const result = await upsert.mutateAsync({ projectId, kind: 'loot-table', definitionJson: definition });
      if (!result.saved) return reportFailure(result.report.issues[0]?.message ?? 'Loot table was not saved');
      notifySuccess(`Created ${definition.label}`);
      resetContentDraft();
      return true;
    } catch (error) {
      reportFailure(error instanceof Error ? error.message : 'Could not create loot table');
    }
  };

  const createWeapon = async () => {
    const visualObject = catalog?.objectTypes.find(({ objectType }) => String(objectType.id) === visualEntityId)?.objectType;
    const numeric = [damage, cooldown, magazine, reload].map(Number);
    if (label.trim().length === 0 || visualObject === undefined || numeric.some((value) => !Number.isFinite(value))) {
      return reportFailure('Name, visual entity and valid weapon values are required.');
    }
    const [damageValue, cooldownValue, magazineValue, reloadValue] = numeric as [number, number, number, number];
    const id = makeWeaponDefinitionId(freshUuid());
    const definition = {
      weapon: { id, damage: damageValue, cooldownTicks: Math.max(0, Math.round(cooldownValue)), magazineSize: Math.max(1, Math.round(magazineValue)), reloadTicks: Math.max(0, Math.round(reloadValue)) },
      delivery: { _tag: 'ProjectileDelivery', damage: damageValue, speed: 12, ttlTicks: 40, radius: 8, falloff: { _tag: 'NoFalloff' }, knockback: 0 },
      appliesStatus: [],
    };
    const weaponEntity = new GameObjectType({
      ...visualObject,
      components: [
        ...visualObject.components.filter((component) => component._tag !== 'weapon-ref'),
        new WeaponRefComponent({ weaponId: id, pickupEntityId: visualObject.id }),
      ],
    });
    try {
      const result = await upsert.mutateAsync({ projectId, kind: 'weapon', definitionJson: definition, label: label.trim() });
      if (!result.saved) return reportFailure(result.report.issues[0]?.message ?? 'Weapon was not saved');
      await upsertType.mutateAsync({ projectId, objectTypeJson: Schema.encodeUnknownSync(GameObjectType)(weaponEntity) });
      notifySuccess(`Created ${label.trim()} and linked its real visual entity`);
      resetContentDraft();
      return true;
    } catch (error) {
      reportFailure(error instanceof Error ? error.message : 'Could not create weapon');
    }
  };

  const hasDraft = tab !== 'objects' && (
    label.length > 0 ||
    category !== 'consumable' ||
    rarity !== 'common' ||
    visualEntityId.length > 0 ||
    selectedItemId.length > 0 ||
    weight !== '1' ||
    damage !== '20' ||
    cooldown !== '8' ||
    magazine !== '12' ||
    reload !== '30'
  );
  const documentId = `game-content:${projectId}`;
  const documentState = useDocumentLifecycle({
    id: documentId,
    label: 'Gameplay content draft',
    kind: 'project-content',
    dirty: hasDraft,
    recoveryVersion: JSON.stringify({
      tab,
      label,
      category,
      rarity,
      visualEntityId,
      selectedItemId,
      weight,
      damage,
      cooldown,
      magazine,
      reload,
    }),
    save: async () => {
      const saved = tab === 'items'
        ? await createItem()
        : tab === 'loot'
          ? await createLootTable()
          : tab === 'weapons'
            ? await createWeapon()
            : true;
      if (!saved) throw new Error('Gameplay content draft was not saved');
    },
    discard: resetContentDraft,
    snapshot: () => ({
      tab,
      label,
      category,
      rarity,
      visualEntityId,
      selectedItemId,
      weight,
      damage,
      cooldown,
      magazine,
      reload,
    }),
    recover: (snapshot) => {
      const value = snapshot as {
        readonly tab: ContentTab;
        readonly label: string;
        readonly category: string;
        readonly rarity: (typeof rarityOptions)[number];
        readonly visualEntityId: string;
        readonly selectedItemId: string;
        readonly weight: string;
        readonly damage: string;
        readonly cooldown: string;
        readonly magazine: string;
        readonly reload: string;
      };
      setTab(value.tab);
      setLabel(value.label);
      setCategory(value.category);
      setRarity(value.rarity);
      setVisualEntityId(value.visualEntityId);
      setSelectedItemId(value.selectedItemId);
      setWeight(value.weight);
      setDamage(value.damage);
      setCooldown(value.cooldown);
      setMagazine(value.magazine);
      setReload(value.reload);
    },
  });
  const saveContentDraft = async () => {
    await documentLifecycle.save(documentId);
  };

  return (
    <ScrollArea className="h-full">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6" data-testid="game-content-page">
        <div className="flex items-start justify-between gap-3">
          <div>
          <h1 className="text-xl font-semibold">Gameplay content</h1>
          <p className="text-sm text-muted-foreground">Create match-ready objects, weapons, pickups, items and loot without editing JSON or IDs.</p>
          </div>
          <span className="text-xs text-muted-foreground" data-testid="content-document-status">
            {documentState?.status ?? 'clean'}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {(['objects', 'weapons', 'items', 'loot'] as const).map((value) => (
            <Button key={value} size="sm" variant={tab === value ? 'default' : 'outline'} onClick={() => setTab(value)} data-testid={`content-tab-${value}`}>
              {value === 'loot' ? 'Loot tables' : value[0]!.toUpperCase() + value.slice(1)}
            </Button>
          ))}
        </div>

        {catalogQuery.isLoading ? <p>Loading content…</p> : null}
        {tab === 'objects' ? (
          <section className="grid gap-2 sm:grid-cols-2">
            {catalog?.objectTypes.map(({ objectType, origin }) => (
              <article key={String(objectType.id)} className="flex items-center gap-3 rounded-md border p-3">
                <ObjectThumbnail objectType={objectType} />
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{objectType.label}</p><Badge variant="secondary">{origin === 'plugin' ? 'Template' : 'Project'}</Badge></div>
                {origin === 'plugin' ? <Button size="icon-sm" variant="ghost" disabled={busy} onClick={() => void duplicateDefinition('object-type', String(objectType.id), objectType.label)} aria-label={`Duplicate ${objectType.label}`}><CopyIcon /></Button> : null}
              </article>
            ))}
            <Link to="/projects/$projectId/entities" params={{ projectId }} className="rounded-md border border-dashed p-4 text-sm hover:bg-muted/50"><PlusIcon className="mb-2 size-4" />Create or edit a placeable object with the real sprite picker</Link>
          </section>
        ) : null}

        {tab !== 'objects' ? (
          <section className="rounded-md border p-4" data-testid="content-create-form">
            <h2 className={cn('mb-3 text-sm font-semibold')}>Create {tab === 'loot' ? 'loot table' : tab.slice(0, -1)}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1"><span className={typography.rowMeta}>Name</span><Input value={label} onChange={(event) => setLabel(event.target.value)} data-testid="content-name" /></label>
              {tab === 'items' ? <label className="space-y-1"><span className={typography.rowMeta}>Category</span><Input value={category} onChange={(event) => setCategory(event.target.value)} /></label> : null}
              {tab === 'items' || tab === 'loot' ? <label className="space-y-1"><span className={typography.rowMeta}>Rarity / tier</span><select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={rarity} onChange={(event) => setRarity(event.target.value as typeof rarity)} data-testid="content-rarity">{rarityOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label> : null}
              {tab === 'items' || tab === 'weapons' ? <label className="space-y-1"><span className={typography.rowMeta}>Project visual / pickup entity</span><select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={visualEntityId} onChange={(event) => setVisualEntityId(event.target.value)} data-testid="content-visual-entity"><option value="">Choose by name…</option>{visualObjects.map(({ objectType }) => <option key={String(objectType.id)} value={String(objectType.id)}>{objectType.label}</option>)}</select>{visualObjects.length === 0 ? <span className={typography.rowMeta}>Duplicate a visual template in Objects first, or create one in the Entity Editor.</span> : null}</label> : null}
              {tab === 'loot' ? <><label className="space-y-1"><span className={typography.rowMeta}>Item</span><select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={selectedItemId} onChange={(event) => setSelectedItemId(event.target.value)} data-testid="content-loot-item"><option value="">Choose by name…</option>{catalog?.items.map((item) => <option key={String(item.id)} value={String(item.id)}>{item.label}</option>)}</select></label><label className="space-y-1"><span className={typography.rowMeta}>Drop weight</span><Input type="number" min={0.1} step={0.1} value={weight} onChange={(event) => setWeight(event.target.value)} /></label></> : null}
              {tab === 'weapons' ? <>{[['Damage', damage, setDamage], ['Cooldown ticks', cooldown, setCooldown], ['Magazine', magazine, setMagazine], ['Reload ticks', reload, setReload]].map(([name, value, setter]) => <label key={name as string} className="space-y-1"><span className={typography.rowMeta}>{name as string}</span><Input type="number" min={0} value={value as string} onChange={(event) => (setter as (next: string) => void)(event.target.value)} /></label>)}</> : null}
            </div>
            <Button className="mt-3" disabled={busy} onClick={() => void saveContentDraft()} data-testid="content-create"><PlusIcon />Create</Button>
          </section>
        ) : null}

        {tab === 'items' ? <DefinitionList entries={catalog?.items.map((item) => ({ id: String(item.id), label: item.label })) ?? []} isProject={isProject} busy={busy} duplicate={(id, name) => duplicateDefinition('item', id, name)} remove={(id) => removeDefinition('item', id)} /> : null}
        {tab === 'loot' ? <DefinitionList entries={catalog?.lootTables.map((table) => ({ id: String(table.id), label: table.label })) ?? []} isProject={isProject} busy={busy} duplicate={(id, name) => duplicateDefinition('loot-table', id, name)} remove={(id) => removeDefinition('loot-table', id)} /> : null}
        {tab === 'weapons' ? <DefinitionList entries={visibleWeapons.map(({ entry, label: name }) => { const visualObject = catalog?.objectTypes.find(({ objectType }) => objectType.components.some((component) => component._tag === 'weapon-ref' && String(component.weaponId) === String(entry.weapon.id)))?.objectType; return { id: String(entry.weapon.id), label: name, ...(visualObject === undefined ? {} : { visualObject }) }; })} isProject={isProject} busy={busy} duplicate={(id, name) => duplicateDefinition('weapon', id, name)} remove={(id) => removeDefinition('weapon', id)} /> : null}
      </main>
    </ScrollArea>
  );
}

function ObjectThumbnail({ objectType }: { readonly objectType: GameObjectType }) {
  const visual = visualFor(objectType);
  const placeableId = visual === undefined ? undefined : Option.getOrUndefined(visual.placeableId);
  const resolved = usePlaceableVisual(placeableId === undefined ? undefined : String(placeableId));
  const src = resolved?.preview === undefined
    ? undefined
    : assetThumbnailUrl(resolved.packId, resolved.preview, resolved.integrityHash);
  return <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">{src === undefined ? <span aria-hidden>◇</span> : <img src={src} alt={`${objectType.label} visual`} className="size-full object-contain [image-rendering:pixelated]" />}</div>;
}

function DefinitionList({ entries, isProject, busy, duplicate, remove }: { readonly entries: readonly { id: string; label: string; visualObject?: GameObjectType }[]; readonly isProject: (id: string) => boolean | undefined; readonly busy: boolean; readonly duplicate: (id: string, label: string) => Promise<unknown>; readonly remove: (id: string) => Promise<unknown> }) {
  return <ul className="grid gap-2 sm:grid-cols-2">{entries.map((entry) => { const projectOwned = isProject(entry.id); return <li key={entry.id} className="flex items-center gap-2 rounded-md border p-3">{entry.visualObject === undefined ? null : <ObjectThumbnail objectType={entry.visualObject} />}<div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{entry.label}</p><Badge variant="secondary">{projectOwned ? 'Project override' : 'Immutable template'}</Badge></div>{projectOwned ? <Button size="icon-sm" variant="ghost" disabled={busy} onClick={() => void remove(entry.id)} aria-label={`Remove ${entry.label}`}><Trash2Icon /></Button> : <Button size="icon-sm" variant="ghost" disabled={busy} onClick={() => void duplicate(entry.id, entry.label)} aria-label={`Duplicate ${entry.label}`}><CopyIcon /></Button>}</li>; })}</ul>;
}
