import type { GameObjectType } from '@tileborne/core';
import type { GameObjectCatalogEntryView } from '@tileborne/ipc-contracts';
import {
  BoxIcon,
  CrosshairIcon,
  DoorOpenIcon,
  HammerIcon,
  PackageIcon,
  ShapesIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { Option } from 'effect';

import type { PaletteActionIcon, PaletteActionItem } from '@/lib/palette-actions';

/**
 * A family-grouped projection of the resolved catalog into selectable palette
 * actions. The "Objects" palette group renders one block per {@link group} so
 * authors browse object types clustered by their open `family` tag.
 */
export interface CatalogPaletteGroup {
  /** Stable, brand-neutral group key (the raw `family` tag). */
  readonly id: string;
  /** Human-readable group heading derived from the `family` tag. */
  readonly label: string;
  readonly items: readonly PaletteActionItem[];
}

/**
 * Neutral icon per engine-closed component tag. The catalog carries no editor
 * icon, so the chip uses a generic icon picked from the object type's most
 * salient component (priority order below), falling back to a neutral shape.
 * Keyed purely on engine component tags — never on any plugin/brand identity —
 * so it stays neutral across game modes.
 */
const COMPONENT_ICON: Partial<Record<string, PaletteActionIcon>> = {
  'spawn-point': CrosshairIcon,
  'loot-source': PackageIcon,
  hazard: TriangleAlertIcon,
  interactable: DoorOpenIcon,
  breakable: HammerIcon,
  'visual-ref': BoxIcon,
};

/** Order in which an object type's components decide its representative icon. */
const ICON_PRIORITY = [
  'spawn-point',
  'loot-source',
  'hazard',
  'interactable',
  'breakable',
  'visual-ref',
] as const;

const NEUTRAL_ICON: PaletteActionIcon = ShapesIcon;

const iconForObjectType = (objectType: GameObjectType): PaletteActionIcon => {
  const tags = new Set(objectType.components.map((component) => component._tag));
  for (const tag of ICON_PRIORITY) {
    if (tags.has(tag)) {
      const icon = COMPONENT_ICON[tag];
      if (icon !== undefined) {
        return icon;
      }
    }
  }
  return NEUTRAL_ICON;
};

/** Humanise an open tag (`spawn-point` → `Spawn point`) for headings/tooltips. */
const humanise = (tag: string): string => {
  const spaced = tag.replace(/[-_]+/g, ' ').trim();
  if (spaced.length === 0) {
    return tag;
  }
  return `${spaced[0]!.toUpperCase()}${spaced.slice(1)}`;
};

const categoryOf = (objectType: GameObjectType): string | undefined =>
  Option.getOrUndefined(objectType.category);

/**
 * Project one resolved catalog entry into a selectable palette action. The
 * action's `objectKind` carries the resolved {@link GameObjectType.id} verbatim;
 * the existing `plugin-object` placement flow stamps it onto `MapObject.kind`
 * directly (the DTO already holds the resolved id, so no key→id round-trip).
 */
const toPaletteActionItem = (entry: GameObjectCatalogEntryView): PaletteActionItem => {
  const { objectType } = entry;
  const category = categoryOf(objectType);
  const familyLabel = humanise(objectType.family);
  return {
    id: objectType.id,
    objectKind: objectType.id,
    label: objectType.label,
    description: category === undefined ? familyLabel : `${familyLabel} · ${humanise(category)}`,
    icon: iconForObjectType(objectType),
    placement: 'sticky',
  };
};

const compareItems = (
  left: { readonly category: string | undefined; readonly label: string },
  right: { readonly category: string | undefined; readonly label: string },
): number => {
  const leftCategory = left.category ?? '';
  const rightCategory = right.category ?? '';
  if (leftCategory !== rightCategory) {
    return leftCategory.localeCompare(rightCategory);
  }
  return left.label.localeCompare(right.label);
};

/**
 * Project the resolved catalog `objectTypes` into the flat, deterministically
 * ordered list of palette actions (ordered by family, then category, then
 * label) so chips cluster by family even when rendered ungrouped.
 */
export const projectCatalogPaletteActions = (
  entries: readonly GameObjectCatalogEntryView[],
): readonly PaletteActionItem[] =>
  groupCatalogPaletteActions(entries).flatMap((group) => group.items);

/**
 * Project the resolved catalog `objectTypes` into palette actions grouped by
 * their open `family` tag (ADR-0025 D3). Groups and items are deterministically
 * ordered so the palette is stable across resolves.
 */
export const groupCatalogPaletteActions = (
  entries: readonly GameObjectCatalogEntryView[],
): readonly CatalogPaletteGroup[] => {
  const byFamily = new Map<
    string,
    {
      readonly label: string;
      readonly items: { item: PaletteActionItem; category: string | undefined }[];
    }
  >();

  for (const entry of entries) {
    const family = entry.objectType.family as string;
    const existing = byFamily.get(family);
    const bucket = existing ?? { label: humanise(family), items: [] };
    bucket.items.push({
      item: toPaletteActionItem(entry),
      category: categoryOf(entry.objectType),
    });
    if (existing === undefined) {
      byFamily.set(family, bucket);
    }
  }

  return [...byFamily.entries()]
    .sort(([leftFamily], [rightFamily]) => leftFamily.localeCompare(rightFamily))
    .map(([family, bucket]) => ({
      id: family,
      label: bucket.label,
      items: [...bucket.items]
        .sort((left, right) =>
          compareItems(
            { category: left.category, label: left.item.label },
            { category: right.category, label: right.item.label },
          ),
        )
        .map(({ item }) => item),
    }));
};
