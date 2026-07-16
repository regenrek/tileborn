import type { JsonObject } from '@tileborne/core';
import {
  ModeDataExportError,
  type ModeDataExportContext,
  type RuntimeModeDataExporter,
} from '@tileborne/plugin-api';
import { Result, Schema } from 'effect';

import { readBattleRoyaleMapSettings } from './authoring/map-settings.js';
import { decodeBattleRoyaleConfigOverride } from './battle-royale-config.js';
import { DEFAULT_MAX_PLAYERS, PLUGIN_ID, SHRINK_ZONE_ANCHOR_KIND, ZONE } from './constants.js';
import { makeIsLootSourceType, readNumber, readString } from './instance-reads.js';
import { BattleRoyaleModeData, normalizeLootTables } from './mode-data-schema.js';
import type { LootTableEntry, ShrinkSchedule } from './types/artifact.js';

export {
  BattleRoyaleModeData,
  decodeBattleRoyaleModeData,
  normalizeLootTables,
} from './mode-data-schema.js';

const isPositiveFinite = (value: number): boolean => Number.isFinite(value) && value > 0;

const isNonNegativeFinite = (value: number): boolean => Number.isFinite(value) && value >= 0;

/** BR invariants for the mode-data section (subset of the artifact validation). */
const collectInvariantViolations = (data: {
  readonly maxPlayers: number;
  readonly shrinkSchedule: ShrinkSchedule;
  readonly lootTables: readonly LootTableEntry[];
}): readonly string[] => {
  const issues: string[] = [];
  if (!Number.isInteger(data.maxPlayers) || data.maxPlayers <= 0) {
    issues.push('maxPlayers must be a positive integer');
  }
  const { shrinkSchedule } = data;
  if (!Number.isFinite(shrinkSchedule.centerX) || !Number.isFinite(shrinkSchedule.centerY)) {
    issues.push('shrink center must be finite');
  }
  if (!isPositiveFinite(shrinkSchedule.startRadiusTiles)) {
    issues.push('shrink start radius must be positive');
  }
  if (!isNonNegativeFinite(shrinkSchedule.endRadiusTiles)) {
    issues.push('shrink end radius must be non-negative');
  }
  if (shrinkSchedule.endRadiusTiles >= shrinkSchedule.startRadiusTiles) {
    issues.push('shrink end radius must be below start radius');
  }
  if (data.lootTables.length === 0) {
    issues.push('at least one loot table entry is required');
  }
  for (const entry of data.lootTables) {
    if (entry.itemKind.length === 0 || entry.tier.length === 0) {
      issues.push('loot entries require itemKind and tier');
    }
    if (!isPositiveFinite(entry.weight)) {
      issues.push('loot weight must be positive');
    }
  }
  return issues;
};

const deriveShrinkSchedule = (context: ModeDataExportContext): ShrinkSchedule => {
  // The anchor is matched by BR's well-known catalog type id; assembly already
  // guarantees every placement's typeId resolves in the merged catalog.
  const anchor = context.placements.find(
    (placement) => placement.typeId === SHRINK_ZONE_ANCHOR_KIND,
  );
  return {
    centerX: anchor?.x ?? context.map.size.width / 2,
    centerY: anchor?.y ?? context.map.size.height / 2,
    startRadiusTiles: readNumber(
      anchor?.instanceProperties?.initialRadiusTiles,
      Math.max(context.map.size.width, context.map.size.height) / 2,
    ),
    endRadiusTiles: readNumber(anchor?.instanceProperties?.finalRadiusTiles, 4),
    shrinkIntervalMs: ZONE.shrinkIntervalMs,
    damagePerSecond: ZONE.damagePerSecond,
  };
};

const deriveLootTables = (context: ModeDataExportContext): readonly LootTableEntry[] => {
  // Loot meaning is component-driven: any catalog type carrying `loot-source`
  // contributes, with the well-known loot-crate id kept as a direct match.
  const isLootSourceType = makeIsLootSourceType(context.catalog);
  const entries = context.placements
    .filter((placement) => isLootSourceType(placement.typeId))
    .map((placement) => ({
      itemKind: readString(placement.instanceProperties?.itemKind, 'supply-crate'),
      tier: readString(placement.instanceProperties?.tier, 'common'),
      weight: readNumber(placement.instanceProperties?.weight, 1),
    }));
  return normalizeLootTables(entries);
};

/**
 * The narrowed BR exporter (ADR-0030): derive only the engine-opaque BR
 * sections from the neutral projections and return the canonical wire shape.
 */
export const exportBattleRoyaleModeData: RuntimeModeDataExporter = (context) => {
  const settings = context.settings ?? readBattleRoyaleMapSettings(context.map);
  // `maxPlayers` is folded into the namespaced settings object; strip it
  // before decoding the `BattleRoyaleConfig` override.
  const { maxPlayers: settingsMaxPlayers, ...override } = settings;
  const battleRoyale =
    Object.keys(override).length > 0 ? decodeBattleRoyaleConfigOverride(override) : undefined;

  const maxPlayers = readNumber(settingsMaxPlayers, DEFAULT_MAX_PLAYERS);
  const shrinkSchedule = deriveShrinkSchedule(context);
  const lootTables = deriveLootTables(context);

  const issues = collectInvariantViolations({ maxPlayers, shrinkSchedule, lootTables });
  if (issues.length > 0) {
    return Result.fail(
      new ModeDataExportError({ pluginId: PLUGIN_ID, message: issues.join('; ') }),
    );
  }

  const modeData = new BattleRoyaleModeData({
    schemaVersion: 1,
    maxPlayers,
    shrinkSchedule,
    lootTables,
    ...(battleRoyale === undefined ? {} : { battleRoyale }),
  });
  return Result.succeed(Schema.encodeSync(BattleRoyaleModeData)(modeData) as JsonObject);
};
