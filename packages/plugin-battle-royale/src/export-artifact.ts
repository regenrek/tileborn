import type { TileborneMap } from "@tileborne/core";
import type { TileIdType, TilesetPack } from "@tileborne/sdk-tileset/schemas";

import {
  DEFAULT_LOOT_TABLE,
  DEFAULT_MAX_PLAYERS,
  LOOT_CRATE_KIND,
  SHRINK_ZONE_ANCHOR_KIND,
  SPAWN_POINT_KIND,
  ZONE,
} from "./constants.js";
import { decodeBattleRoyaleConfigOverride } from "./battle-royale-config.js";
import type {
  BattleRoyaleArtifact,
  CollisionChunkArtifact,
  ExportArtifactOptions,
  ExportedArtifact,
  LootTableEntry,
  MapCollisionArtifact,
} from "./types/artifact.js";

const readNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const readString = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.length > 0 ? value : fallback;

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
    if (tag !== "tile" || !("chunks" in layer) || !Array.isArray(layer.chunks)) {
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

export const exportArtifact = (map: TileborneMap, opts: ExportArtifactOptions = {}): ExportedArtifact => {
  const shrinkIntervalMs = opts.shrinkIntervalMs ?? ZONE.shrinkIntervalMs;
  const damagePerSecond = opts.damagePerSecond ?? ZONE.damagePerSecond;
  const battleRoyale = decodeBattleRoyaleConfigOverride(map.properties.battleRoyale);

  const spawnPoints = map.objects
    .filter((object) => object.kind === SPAWN_POINT_KIND)
    .map((object) => ({
      x: object.x,
      y: object.y,
      team: readString(object.properties.team, "solo"),
      weight: readNumber(object.properties.weight, 1),
    }));

  const anchor = map.objects.find((object) => object.kind === SHRINK_ZONE_ANCHOR_KIND);
  const centerX = anchor?.x ?? map.size.width / 2;
  const centerY = anchor?.y ?? map.size.height / 2;
  const startRadiusTiles = readNumber(
    anchor?.properties.initialRadiusTiles,
    Math.max(map.size.width, map.size.height) / 2,
  );
  const endRadiusTiles = readNumber(anchor?.properties.finalRadiusTiles, 4);

  const lootTables = normalizeLootTables(
    map.objects
      .filter((object) => object.kind === LOOT_CRATE_KIND)
      .map((object) => ({
        itemKind: readString(object.properties.itemKind, "supply-crate"),
        tier: readString(object.properties.tier, "common"),
        weight: readNumber(object.properties.weight, 1),
      })),
  );

  const resolvedLootTables = lootTables.length > 0 ? lootTables : DEFAULT_LOOT_TABLE.map((entry) => ({ ...entry }));

  const objectPlacements = map.objects.map((object) => ({
    kind: object.kind,
    x: object.x,
    y: object.y,
    properties: { ...object.properties },
  }));

  const maxPlayers = readNumber(map.properties.maxPlayers, DEFAULT_MAX_PLAYERS);
  const collision = extractCollisionArtifact(map, opts.tilesetPack);

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
    ...(opts.tilesetPack ? { tilesetPack: opts.tilesetPack } : {}),
    ...(battleRoyale ? { battleRoyale } : {}),
  };

  return artifact;
};
