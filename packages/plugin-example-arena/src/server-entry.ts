import type { JsonObject, TileborneMap } from '@tileborne/core';
import { ModeDataExportError, type RuntimeModeDataExporter } from '@tileborne/plugin-api';
import { Result } from 'effect';

import { ARENA_PLUGIN_ID } from './constants.js';

const readNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export const validateMap = (map: TileborneMap) => {
  const settings = map.properties[ARENA_PLUGIN_ID];
  const record =
    typeof settings === 'object' && settings !== null && !Array.isArray(settings)
      ? (settings as JsonObject)
      : undefined;
  const arenaRadius = readNumber(record?.arenaRadius, 32);
  const enemyCount = readNumber(record?.enemyCount, 8);
  const issues = [
    ...(arenaRadius < 4 || arenaRadius > 256
      ? [{ severity: 'error' as const, message: 'Arena radius must be between 4 and 256.', location: 'properties.arenaRadius' }]
      : []),
    ...(enemyCount < 0 || enemyCount > 64
      ? [{ severity: 'error' as const, message: 'Enemy count must be between 0 and 64.', location: 'properties.enemyCount' }]
      : []),
  ];
  return { ok: issues.length === 0, issues };
};

/** Minimal engine-opaque package data proving the generic Ship exporter path. */
export const exportModeData: RuntimeModeDataExporter = ({ settings }) => {
  const arenaRadius = readNumber(settings?.arenaRadius, 32);
  const enemyCount = readNumber(settings?.enemyCount, 8);
  if (arenaRadius < 4 || arenaRadius > 256 || enemyCount < 0 || enemyCount > 64) {
    return Result.fail(
      new ModeDataExportError({
        pluginId: ARENA_PLUGIN_ID,
        message: 'Example Arena settings are outside the declared schema range.',
      }),
    );
  }
  return Result.succeed({ schemaVersion: 1, arenaRadius, enemyCount });
};
