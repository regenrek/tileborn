import { Schema } from 'effect';

import { BattleRoyaleConfig } from './battle-royale-config.js';
import { DEFAULT_LOOT_TABLE } from './constants.js';
import {
  LootTableEntrySchema,
  ShrinkScheduleSchema,
  type LootTableEntry,
} from './types/artifact.js';

/**
 * BR's engine-opaque `modeData.<pluginId>` section (ADR-0030 slice 5).
 *
 * Carries ONLY what the engine cannot represent neutrally: the zone shrink
 * schedule, the loot table config, the player cap, and the optional
 * `BattleRoyaleConfig` gameplay override. Neutral package sections (spawn
 * points, placements, visuals, player models, collision, tileset data) must
 * NOT be duplicated in here — that boundary is what retires the monolithic
 * `ExportedArtifact`.
 *
 * This module is WORKER-SAFE (no `@tileborne/plugin-api`): the runtime bundle
 * decodes the section, the Node-only exporter in `mode-data.ts` produces it.
 */
export class BattleRoyaleModeData extends Schema.Class<BattleRoyaleModeData>(
  'BattleRoyaleModeData',
)({
  schemaVersion: Schema.Literal(1),
  maxPlayers: Schema.Number,
  shrinkSchedule: ShrinkScheduleSchema,
  lootTables: Schema.Array(LootTableEntrySchema),
  battleRoyale: Schema.optional(BattleRoyaleConfig),
}) {}

/** Normalize authored loot weights to a unit sum; defaults when nothing usable. */
export const normalizeLootTables = (
  entries: readonly LootTableEntry[],
): readonly LootTableEntry[] => {
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

/** Decode the wire `modeData.<pluginId>` section back into the typed shape. */
export const decodeBattleRoyaleModeData = (input: unknown): BattleRoyaleModeData =>
  Schema.decodeUnknownSync(BattleRoyaleModeData)(input);
