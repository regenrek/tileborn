import {
  RuntimeMapPackage,
  RuntimeObjectPlacement,
  type GameObjectComponent,
} from '@tileborne/core';
import { RuntimeProjectContent } from '@tileborne/plugin-api/project-content';
import { Schema } from 'effect';

import { extractObjectCollisionRects } from './collision-artifact.js';
import {
  ABILITY,
  DECOY_KIND,
  LOOT_CRATE_KIND,
  PLUGIN_ID,
  SHRINK_ZONE_ANCHOR_KIND,
  SPAWN_POINT_KIND,
  TRAP_KIND,
} from './constants.js';
import { makeIsLootSourceType, readNumber, readString } from './instance-reads.js';
import { decodeBattleRoyaleModeData } from './mode-data-schema.js';
import {
  assertBattleRoyaleArtifact,
  type BattleRoyaleArtifact,
  type ObjectPlacement,
  type PlayerModelSelectionArtifact,
  type SpawnPointArtifact,
} from './types/artifact.js';

/**
 * ADR-0030 slice 5: build BR's runtime world state from the neutral
 * `RuntimeMapPackage` instead of the monolithic `ExportedArtifact`.
 *
 * Placement meaning is component-driven (spawn-point / loot-source / hazard
 * catalog components) with BR's well-known type ids covering the two roles
 * that have no neutral component (shrink-zone-anchor, decoy). Zone/loot/cap
 * config comes from the plugin's own `modeData` section; visuals are taken
 * as baked by assembly — never re-derived from the catalog here.
 *
 * Returns the BR-internal `BattleRoyaleArtifact` runtime-state shape consumed
 * by the runtime adapter, server rules, and projector.
 */

type PlacementRole = ObjectPlacement['role'];

const buildRoleResolver = (mapPackage: RuntimeMapPackage) => {
  const componentsByTypeId = new Map<string, readonly GameObjectComponent[]>(
    mapPackage.catalog.map((entry) => [String(entry.objectType.id), entry.objectType.components]),
  );
  const hasComponent = (
    typeId: RuntimeObjectPlacement['typeId'],
    tag: GameObjectComponent['_tag'],
  ): boolean =>
    componentsByTypeId.get(String(typeId))?.some((component) => component._tag === tag) ?? false;
  const isLootSourceType = makeIsLootSourceType(mapPackage.catalog);

  return (placement: RuntimeObjectPlacement): PlacementRole | undefined => {
    if (hasComponent(placement.typeId, 'spawn-point')) {
      return 'spawn-point';
    }
    if (placement.typeId === SHRINK_ZONE_ANCHOR_KIND) {
      return 'shrink-zone-anchor';
    }
    if (isLootSourceType(placement.typeId)) {
      return 'loot-crate';
    }
    if (hasComponent(placement.typeId, 'hazard')) {
      return 'trap';
    }
    if (placement.typeId === DECOY_KIND) {
      return 'decoy';
    }
    return undefined;
  };
};

const spawnPointFromPlacement = (placement: RuntimeObjectPlacement): SpawnPointArtifact => ({
  x: placement.x,
  y: placement.y,
  team: readString(placement.instanceProperties?.team, 'solo'),
  weight: readNumber(placement.instanceProperties?.weight, 1),
});

const projectLootEntries = (content: RuntimeProjectContent): BattleRoyaleArtifact['lootTables'] => {
  const itemIds = new Set(content.items.map((item) => String(item.id)));
  return content.lootTables.flatMap((table) =>
    table.entries.flatMap((entry) => {
      const referencedItem =
        typeof entry.itemId === 'string' && itemIds.has(entry.itemId) ? entry.itemId : undefined;
      const itemKind =
        referencedItem ?? (typeof entry.itemKind === 'string' ? entry.itemKind : undefined);
      if (itemKind === undefined) return [];
      return [
        {
          itemKind,
          tier: typeof entry.tier === 'string' ? entry.tier : 'project',
          weight:
            typeof entry.weight === 'number' && Number.isFinite(entry.weight) ? entry.weight : 1,
        },
      ];
    }),
  );
};

/**
 * Project a role-free package placement into the BR-internal roled union.
 * `kind` is pinned to BR's well-known type id per role (the union's
 * validation invariant) so component-tagged custom types resolve to the same
 * runtime meaning.
 */
const toObjectPlacement = (
  placement: RuntimeObjectPlacement,
  role: PlacementRole,
  mapPackage: RuntimeMapPackage,
): ObjectPlacement => {
  const base = { objectId: placement.objectId, x: placement.x, y: placement.y };
  const properties = placement.instanceProperties;
  switch (role) {
    case 'spawn-point':
      return {
        ...base,
        role,
        kind: SPAWN_POINT_KIND,
        properties: {
          team: readString(properties?.team, 'solo'),
          weight: readNumber(properties?.weight, 1),
        },
      };
    case 'shrink-zone-anchor':
      return {
        ...base,
        role,
        kind: SHRINK_ZONE_ANCHOR_KIND,
        properties: {
          initialRadiusTiles: readNumber(
            properties?.initialRadiusTiles,
            Math.max(mapPackage.map.size.width, mapPackage.map.size.height) / 2,
          ),
          finalRadiusTiles: readNumber(properties?.finalRadiusTiles, 4),
        },
      };
    case 'loot-crate':
      return {
        ...base,
        role,
        kind: LOOT_CRATE_KIND,
        properties: {
          itemKind: readString(properties?.itemKind, 'supply-crate'),
          tier: readString(properties?.tier, 'common'),
          weight: readNumber(properties?.weight, 1),
        },
      };
    case 'trap':
      return {
        ...base,
        role,
        kind: TRAP_KIND,
        properties: {
          radius: readNumber(properties?.radius, ABILITY.trap.radius),
          slowTicks: readNumber(properties?.slowTicks, ABILITY.trap.slowTicks),
          stunTicks: readNumber(properties?.stunTicks, ABILITY.trap.stunTicks),
          damageTicks: readNumber(properties?.damageTicks, ABILITY.trap.damageTicks),
        },
      };
    case 'decoy':
      return {
        ...base,
        role,
        kind: DECOY_KIND,
        properties: {
          radius: readNumber(properties?.radius, ABILITY.decoy.radius),
          durationTicks: readNumber(properties?.durationTicks, ABILITY.decoy.durationTicks),
        },
      };
  }
};

export interface BuildBattleRoyaleRuntimeStateOptions {
  /**
   * Per-session player→model selections, provided by the host session channel
   * (`RuntimePluginHost.getPlayerModelSelections`). The package deliberately
   * carries none.
   */
  readonly playerModelSelections?: readonly PlayerModelSelectionArtifact[];
}

/**
 * Decode an encoded `RuntimeMapPackage` and derive BR's runtime world state
 * from its typed sections.
 */
export const buildBattleRoyaleRuntimeState = (
  packageWire: unknown,
  options: BuildBattleRoyaleRuntimeStateOptions = {},
): BattleRoyaleArtifact => {
  const mapPackage = Schema.decodeUnknownSync(RuntimeMapPackage)(packageWire);

  const modeDataWire = mapPackage.modeData[PLUGIN_ID];
  if (modeDataWire === undefined) {
    throw new Error(
      `RuntimeMapPackage has no modeData section for "${PLUGIN_ID}"; ` +
        'the package was not assembled for the Battle Royale mode',
    );
  }
  const modeData = decodeBattleRoyaleModeData(modeDataWire);
  const projectContent = Schema.decodeUnknownSync(RuntimeProjectContent)(mapPackage.content);
  const authoredLoot = projectLootEntries(projectContent);
  const tileWidth = mapPackage.map.tileSize.width;
  const tileHeight = mapPackage.map.tileSize.height;
  const radialTileSize = Math.max(tileWidth, tileHeight);
  // RuntimeMapPackage is neutral tile-space. BR's established simulation and
  // projector contract is pixel-world, so adapt exactly once at the plugin
  // boundary before any spawn, collision, gameplay, or visual owner sees it.
  const worldPlacements = mapPackage.placements.map(
    (placement) =>
      new RuntimeObjectPlacement({
        objectId: placement.objectId,
        typeId: placement.typeId,
        x: placement.x * tileWidth,
        y: placement.y * tileHeight,
        ...(placement.instanceProperties === undefined
          ? {}
          : { instanceProperties: placement.instanceProperties }),
      }),
  );

  const resolveRole = buildRoleResolver(mapPackage);
  const grouped: Record<PlacementRole, ObjectPlacement[]> = {
    'spawn-point': [],
    'shrink-zone-anchor': [],
    'loot-crate': [],
    trap: [],
    decoy: [],
  };
  const spawnPoints: SpawnPointArtifact[] = [];
  for (const placement of worldPlacements) {
    const role = resolveRole(placement);
    if (role === undefined) {
      continue;
    }
    grouped[role].push(toObjectPlacement(placement, role, mapPackage));
    if (role === 'spawn-point') {
      spawnPoints.push(spawnPointFromPlacement(placement));
    }
  }
  // The runtime state carries at most one anchor; extra anchor placements
  // are ignored (first wins).
  const objectPlacements: readonly ObjectPlacement[] = [
    ...grouped['spawn-point'],
    ...grouped['shrink-zone-anchor'].slice(0, 1),
    ...grouped['loot-crate'],
    ...grouped.trap,
    ...grouped.decoy,
  ];

  // Collision on the package path comes from catalog-footprint object rects
  // only (the package carries no tileset pack for tile-mask collision).
  const objectCollisionRects = extractObjectCollisionRects(
    worldPlacements,
    mapPackage.catalog.map((entry) => entry.objectType),
  );

  const { playerModels, weaponVisuals, overlayVisuals } = mapPackage.visuals;
  const defaultPlayerModelId = playerModels[0]?.id;

  const artifact: BattleRoyaleArtifact = {
    schemaVersion: 1,
    maxPlayers: modeData.maxPlayers,
    spawnPoints,
    spawnAnchors: spawnPoints,
    shrinkSchedule: {
      ...modeData.shrinkSchedule,
      centerX: modeData.shrinkSchedule.centerX * tileWidth,
      centerY: modeData.shrinkSchedule.centerY * tileHeight,
      startRadiusTiles: modeData.shrinkSchedule.startRadiusTiles * radialTileSize,
      endRadiusTiles: modeData.shrinkSchedule.endRadiusTiles * radialTileSize,
    },
    // A project-authored loot table with valid item references is executable
    // game content and intentionally overrides the mode template. Empty or
    // unrelated project content preserves the plugin default.
    lootTables: authoredLoot.length === 0 ? modeData.lootTables : authoredLoot,
    objectPlacements,
    mapBounds: {
      minX: 0,
      minY: 0,
      maxX: mapPackage.map.size.width * tileWidth,
      maxY: mapPackage.map.size.height * tileHeight,
    },
    ...(objectCollisionRects.length === 0 ? {} : { objectCollisionRects }),
    ...(modeData.battleRoyale === undefined ? {} : { battleRoyale: modeData.battleRoyale }),
    ...(playerModels.length === 0
      ? {}
      : {
          playerModels: [...playerModels],
          ...(defaultPlayerModelId === undefined ? {} : { defaultPlayerModelId }),
          playerModelSelections: [...(options.playerModelSelections ?? [])],
        }),
    ...(weaponVisuals.length === 0 ? {} : { weaponVisuals: [...weaponVisuals] }),
    ...(overlayVisuals.length === 0 ? {} : { overlayVisuals: [...overlayVisuals] }),
  };

  return assertBattleRoyaleArtifact(artifact);
};
