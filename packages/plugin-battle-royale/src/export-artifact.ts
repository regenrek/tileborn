import {
  readCollisionFootprintOffset,
  type CollisionFootprintComponent,
  type CollisionFootprintPart,
  type GameObjectType,
  type ObjectId,
  type TileborneMap,
} from "@tileborne/core";
import type { TileIdType, TilesetPack } from "@tileborne/sdk-tileset/schemas";

import {
  ABILITY,
  DEFAULT_LOOT_TABLE,
  DEFAULT_MAX_PLAYERS,
  DECOY_KIND,
  LOOT_CRATE_KIND,
  SHRINK_ZONE_ANCHOR_KIND,
  SPAWN_POINT_KIND,
  TRAP_KIND,
  ZONE,
} from "./constants.js";
import { decodeBattleRoyaleConfigOverride } from "./battle-royale-config.js";
import { readBattleRoyaleMapSettings } from "./authoring/map-settings.js";
import {
  assertBattleRoyaleArtifact,
  type ObjectPlacement,
  BattleRoyaleArtifact,
  CollisionChunkArtifact,
  ExportArtifactOptions,
  ExportedArtifact,
  LootTableEntry,
  MapCollisionArtifact,
  ObjectCollisionRectArtifact,
} from "./types/artifact.js";

interface AuthoredSpawnPoint {
  readonly objectId: ObjectId;
  readonly x: number;
  readonly y: number;
  readonly team: string;
  readonly weight: number;
}

interface AuthoredLootCrate {
  readonly objectId: ObjectId;
  readonly x: number;
  readonly y: number;
  readonly itemKind: string;
  readonly tier: string;
  readonly weight: number;
}

interface AuthoredShrinkAnchor {
  readonly objectId: ObjectId;
  readonly x: number;
  readonly y: number;
  readonly initialRadiusTiles: number;
  readonly finalRadiusTiles: number;
}

interface AuthoredTrap {
  readonly objectId: ObjectId;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly slowTicks: number;
  readonly stunTicks: number;
  readonly damageTicks: number;
}

interface AuthoredDecoy {
  readonly objectId: ObjectId;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly durationTicks: number;
}

const readNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const readString = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.length > 0 ? value : fallback;

const readAuthoredSpawnPoints = (map: TileborneMap): readonly AuthoredSpawnPoint[] =>
  map.objects
    .filter((object) => object.kind === SPAWN_POINT_KIND)
    .map((object) => ({
      objectId: object.id,
      x: object.x,
      y: object.y,
      team: readString(object.properties.team, "solo"),
      weight: readNumber(object.properties.weight, 1),
    }));

const readAuthoredLootCrates = (map: TileborneMap): readonly AuthoredLootCrate[] =>
  map.objects
    .filter((object) => object.kind === LOOT_CRATE_KIND)
    .map((object) => ({
      objectId: object.id,
      x: object.x,
      y: object.y,
      itemKind: readString(object.properties.itemKind, "supply-crate"),
      tier: readString(object.properties.tier, "common"),
      weight: readNumber(object.properties.weight, 1),
    }));

const readAuthoredTraps = (map: TileborneMap): readonly AuthoredTrap[] =>
  map.objects
    .filter((object) => object.kind === TRAP_KIND)
    .map((object) => ({
      objectId: object.id,
      x: object.x,
      y: object.y,
      radius: readNumber(object.properties.radius, ABILITY.trap.radius),
      slowTicks: readNumber(object.properties.slowTicks, ABILITY.trap.slowTicks),
      stunTicks: readNumber(object.properties.stunTicks, ABILITY.trap.stunTicks),
      damageTicks: readNumber(object.properties.damageTicks, ABILITY.trap.damageTicks),
    }));

const readAuthoredDecoys = (map: TileborneMap): readonly AuthoredDecoy[] =>
  map.objects
    .filter((object) => object.kind === DECOY_KIND)
    .map((object) => ({
      objectId: object.id,
      x: object.x,
      y: object.y,
      radius: readNumber(object.properties.radius, ABILITY.decoy.radius),
      durationTicks: readNumber(object.properties.durationTicks, ABILITY.decoy.durationTicks),
    }));

const readAuthoredShrinkAnchor = (map: TileborneMap): AuthoredShrinkAnchor | undefined => {
  const anchor = map.objects.find((object) => object.kind === SHRINK_ZONE_ANCHOR_KIND);
  if (!anchor) {
    return undefined;
  }

  return {
    objectId: anchor.id,
    x: anchor.x,
    y: anchor.y,
    initialRadiusTiles: readNumber(
      anchor.properties.initialRadiusTiles,
      Math.max(map.size.width, map.size.height) / 2,
    ),
    finalRadiusTiles: readNumber(anchor.properties.finalRadiusTiles, 4),
  };
};

const buildObjectPlacements = (
  spawnPoints: readonly AuthoredSpawnPoint[],
  shrinkAnchor: AuthoredShrinkAnchor | undefined,
  lootCrates: readonly AuthoredLootCrate[],
  traps: readonly AuthoredTrap[],
  decoys: readonly AuthoredDecoy[],
): readonly ObjectPlacement[] => [
  ...spawnPoints.map((spawn) => ({
    objectId: spawn.objectId,
    role: "spawn-point" as const,
    kind: SPAWN_POINT_KIND,
    x: spawn.x,
    y: spawn.y,
    properties: {
      team: spawn.team,
      weight: spawn.weight,
    },
  })),
  ...(shrinkAnchor
    ? [
        {
          objectId: shrinkAnchor.objectId,
          role: "shrink-zone-anchor" as const,
          kind: SHRINK_ZONE_ANCHOR_KIND,
          x: shrinkAnchor.x,
          y: shrinkAnchor.y,
          properties: {
            initialRadiusTiles: shrinkAnchor.initialRadiusTiles,
            finalRadiusTiles: shrinkAnchor.finalRadiusTiles,
          },
        },
      ]
    : []),
  ...lootCrates.map((loot) => ({
    objectId: loot.objectId,
    role: "loot-crate" as const,
    kind: LOOT_CRATE_KIND,
    x: loot.x,
    y: loot.y,
    properties: {
      itemKind: loot.itemKind,
      tier: loot.tier,
      weight: loot.weight,
    },
  })),
  ...traps.map((trap) => ({
    objectId: trap.objectId,
    role: "trap" as const,
    kind: TRAP_KIND,
    x: trap.x,
    y: trap.y,
    properties: {
      radius: trap.radius,
      slowTicks: trap.slowTicks,
      stunTicks: trap.stunTicks,
      damageTicks: trap.damageTicks,
    },
  })),
  ...decoys.map((decoy) => ({
    objectId: decoy.objectId,
    role: "decoy" as const,
    kind: DECOY_KIND,
    x: decoy.x,
    y: decoy.y,
    properties: {
      radius: decoy.radius,
      durationTicks: decoy.durationTicks,
    },
  })),
];

const normalizeLootTables = (entries: readonly LootTableEntry[]): readonly LootTableEntry[] => {
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) {
    return DEFAULT_LOOT_TABLE.map((entry) => ({ ...entry }));
  }
  return entries.map((entry) => ({
    itemKind: entry.itemKind,
    tier: entry.tier,
    weight: Math.round((entry.weight / totalWeight) * 1000) / 1000,
  }));
};

const tileIdByTileIndex = (pack: TilesetPack): readonly (TileIdType | null)[] => {
  const tileIds: Array<TileIdType | null> = [null];
  for (const tileset of pack.tilesets) {
    for (const tile of tileset.tiles) {
      tileIds.push(tile.id);
    }
  }
  return tileIds;
};

const extractCollisionArtifact = (
  map: TileborneMap,
  tilesetPack: TilesetPack | undefined,
): MapCollisionArtifact | undefined => {
  if (tilesetPack === undefined) {
    return undefined;
  }

  const chunks: CollisionChunkArtifact[] = [];
  for (const layer of map.layers) {
    const tag =
      "_tag" in layer && typeof layer._tag === "string"
        ? layer._tag
        : (layer as { kind?: string }).kind;
    if ((tag !== "tile" && tag !== "collision") || !("chunks" in layer) || !Array.isArray(layer.chunks)) {
      continue;
    }
    for (const chunk of layer.chunks) {
      chunks.push({
        x: chunk.x,
        y: chunk.y,
        width: chunk.width,
        height: chunk.height,
        tiles: [...chunk.tiles],
      });
    }
  }

  if (chunks.length === 0) {
    return undefined;
  }

  return {
    tileWidth: map.tileSize.width,
    tileHeight: map.tileSize.height,
    chunks,
    tileIdByIndex: tileIdByTileIndex(tilesetPack),
  };
};

const findCollisionFootprint = (
  objectType: GameObjectType,
): CollisionFootprintComponent | undefined =>
  objectType.components.find(
    (component): component is CollisionFootprintComponent =>
      component._tag === "collision-footprint",
  );

const placeFootprintPart = (
  object: TileborneMap["objects"][number],
  part: CollisionFootprintPart,
): ObjectCollisionRectArtifact | undefined => {
  if (part.width <= 0 || part.height <= 0) {
    return undefined;
  }
  const offset = readCollisionFootprintOffset(object.properties);
  return {
    objectId: object.id,
    x: object.x + offset.x + part.x,
    y: object.y + offset.y + part.y,
    width: part.width,
    height: part.height,
    blocksMovement: part.blocksMovement,
    blocksProjectiles: part.blocksProjectiles,
    blocksVision: part.blocksVision,
  };
};

const extractObjectCollisionRects = (
  map: TileborneMap,
  objectTypes: readonly GameObjectType[] | undefined,
): readonly ObjectCollisionRectArtifact[] => {
  if (objectTypes === undefined || objectTypes.length === 0) {
    return [];
  }
  const footprintByKind = new Map(
    objectTypes.flatMap((objectType) => {
      const footprint = findCollisionFootprint(objectType);
      return footprint === undefined ? [] : [[String(objectType.id), footprint] as const];
    }),
  );
  const rects: ObjectCollisionRectArtifact[] = [];
  for (const object of map.objects) {
    const footprint = footprintByKind.get(String(object.kind));
    if (footprint === undefined) {
      continue;
    }
    for (const part of footprint.parts) {
      const rect = placeFootprintPart(object, part);
      if (rect !== undefined) {
        rects.push(rect);
      }
    }
  }
  return rects.sort((left, right) =>
    left.objectId.localeCompare(right.objectId) || left.y - right.y || left.x - right.x || left.width - right.width,
  );
};

export const exportArtifact = (map: TileborneMap, opts: ExportArtifactOptions = {}): ExportedArtifact => {
  const shrinkIntervalMs = opts.shrinkIntervalMs ?? ZONE.shrinkIntervalMs;
  const damagePerSecond = opts.damagePerSecond ?? ZONE.damagePerSecond;
  // ADR-0023 A: read BR settings from the neutral `map.properties.<pluginId>`
  // namespace (with load-time migration from the legacy `battleRoyale` +
  // `maxPlayers` keys). `maxPlayers` is folded into the namespaced object, so
  // strip it before decoding the `BattleRoyaleConfig` override; an empty
  // override decodes to `undefined` (artifact omits `battleRoyale`) as before.
  const settings = readBattleRoyaleMapSettings(map);
  const { maxPlayers: settingsMaxPlayers, ...override } = settings;
  const battleRoyale =
    Object.keys(override).length > 0 ? decodeBattleRoyaleConfigOverride(override) : undefined;

  const spawnPoints = readAuthoredSpawnPoints(map);
  const shrinkAnchor = readAuthoredShrinkAnchor(map);
  const centerX = shrinkAnchor?.x ?? map.size.width / 2;
  const centerY = shrinkAnchor?.y ?? map.size.height / 2;
  const startRadiusTiles = shrinkAnchor?.initialRadiusTiles ?? Math.max(map.size.width, map.size.height) / 2;
  const endRadiusTiles = shrinkAnchor?.finalRadiusTiles ?? 4;
  const lootCrates = readAuthoredLootCrates(map);
  const traps = readAuthoredTraps(map);
  const decoys = readAuthoredDecoys(map);

  const lootTables = normalizeLootTables(lootCrates);

  const resolvedLootTables = lootTables.length > 0 ? lootTables : DEFAULT_LOOT_TABLE.map((entry) => ({ ...entry }));
  const objectPlacements = buildObjectPlacements(spawnPoints, shrinkAnchor, lootCrates, traps, decoys);

  const maxPlayers = readNumber(settingsMaxPlayers, DEFAULT_MAX_PLAYERS);
  const collision = extractCollisionArtifact(map, opts.tilesetPack);
  const objectCollisionRects = extractObjectCollisionRects(map, opts.objectTypes);
  const playerModels = opts.playerModels ?? [];
  const defaultPlayerModelId =
    opts.defaultPlayerModelId ?? playerModels[0]?.id;
  const playerModelSelections =
    opts.selectedPlayerModelId === undefined
      ? []
      : [{ playerId: "player-1", modelId: opts.selectedPlayerModelId }];

  const artifact: BattleRoyaleArtifact = {
    schemaVersion: 1,
    maxPlayers,
    spawnPoints,
    spawnAnchors: spawnPoints,
    shrinkSchedule: {
      centerX,
      centerY,
      startRadiusTiles,
      endRadiusTiles,
      shrinkIntervalMs,
      damagePerSecond,
    },
    lootTables: resolvedLootTables,
    objectPlacements,
    ...(collision ? { collision } : {}),
    ...(objectCollisionRects.length === 0 ? {} : { objectCollisionRects }),
    ...(opts.tilesetPack ? { tilesetPack: opts.tilesetPack } : {}),
    ...(battleRoyale ? { battleRoyale } : {}),
    ...(playerModels.length === 0
      ? {}
      : {
          playerModels: [...playerModels],
          ...(defaultPlayerModelId === undefined ? {} : { defaultPlayerModelId }),
          playerModelSelections,
        }),
  };

  return assertBattleRoyaleArtifact(artifact);
};
