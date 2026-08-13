import { PlayerModelRef, validatePlayerModelRef } from '@tileborne/core';
import { Schema } from 'effect';

import {
  DECOY_KIND,
  LOOT_CRATE_KIND,
  SHRINK_ZONE_ANCHOR_KIND,
  SPAWN_POINT_KIND,
  TRAP_KIND,
} from '../constants.js';
import type {
  BattleRoyaleArtifact,
  LootTableEntry,
  ObjectCollisionRectArtifact,
  ObjectPlacement,
  PlayerModelSelectionArtifact,
  SpawnPointArtifact,
  ValidationIssue,
} from './artifact.js';

type UnknownRecord = Record<string, unknown>;

export const createValidationIssue = (
  message: string,
  location: string,
  severity: ValidationIssue['severity'] = 'error',
): ValidationIssue => ({
  severity,
  message,
  location,
});

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null;

const isPositiveFinite = (value: number): boolean => Number.isFinite(value) && value > 0;

const isNonNegativeFinite = (value: number): boolean => Number.isFinite(value) && value >= 0;

const schemaError = (message: string, location: string): Error =>
  new Error(`Invalid Battle Royale artifact: ${location}: ${message}`);

const readRecord = (input: unknown, location: string): UnknownRecord => {
  if (!isRecord(input)) {
    throw schemaError('expected object', location);
  }
  return input;
};

const readArray = (input: unknown, location: string): readonly unknown[] => {
  if (!Array.isArray(input)) {
    throw schemaError('expected array', location);
  }
  return input;
};

const readNumber = (record: UnknownRecord, key: string, location: string): number => {
  const value = record[key];
  if (typeof value !== 'number') {
    throw schemaError('expected number', `${location}.${key}`);
  }
  return value;
};

const readString = (record: UnknownRecord, key: string, location: string): string => {
  const value = record[key];
  if (typeof value !== 'string') {
    throw schemaError('expected string', `${location}.${key}`);
  }
  return value;
};

const decodeSpawnPoint = (input: unknown, location: string): SpawnPointArtifact => {
  const record = readRecord(input, location);
  return {
    x: readNumber(record, 'x', location),
    y: readNumber(record, 'y', location),
    team: readString(record, 'team', location),
    weight: readNumber(record, 'weight', location),
  };
};

const decodeLootTableEntry = (input: unknown, location: string): LootTableEntry => {
  const record = readRecord(input, location);
  return {
    itemKind: readString(record, 'itemKind', location),
    tier: readString(record, 'tier', location),
    weight: readNumber(record, 'weight', location),
  };
};

const PlayerModelArray = Schema.Array(PlayerModelRef);

const decodePlayerModels = (input: unknown, location: string): readonly PlayerModelRef[] => {
  try {
    return Schema.decodeUnknownSync(PlayerModelArray)(input);
  } catch (cause) {
    throw schemaError(
      cause instanceof Error ? cause.message : 'invalid player model roster',
      location,
    );
  }
};

const decodePlayerModelSelection = (
  input: unknown,
  location: string,
): PlayerModelSelectionArtifact => {
  const record = readRecord(input, location);
  return {
    playerId: readString(record, 'playerId', location),
    modelId: readString(record, 'modelId', location),
  };
};

const decodeObjectPlacement = (input: unknown, location: string): ObjectPlacement => {
  const record = readRecord(input, location);
  const role = readString(record, 'role', location);
  const base = {
    objectId: readString(record, 'objectId', location) as ObjectPlacement['objectId'],
    kind: readString(record, 'kind', location),
    x: readNumber(record, 'x', location),
    y: readNumber(record, 'y', location),
  };
  const properties = readRecord(record.properties, `${location}.properties`);

  switch (role) {
    case 'spawn-point':
      return {
        ...base,
        role,
        properties: {
          team: readString(properties, 'team', `${location}.properties`),
          weight: readNumber(properties, 'weight', `${location}.properties`),
        },
      } as ObjectPlacement;
    case 'shrink-zone-anchor':
      return {
        ...base,
        role,
        properties: {
          initialRadiusTiles: readNumber(
            properties,
            'initialRadiusTiles',
            `${location}.properties`,
          ),
          finalRadiusTiles: readNumber(properties, 'finalRadiusTiles', `${location}.properties`),
        },
      } as ObjectPlacement;
    case 'loot-crate':
      return {
        ...base,
        role,
        properties: {
          itemKind: readString(properties, 'itemKind', `${location}.properties`),
          tier: readString(properties, 'tier', `${location}.properties`),
          weight: readNumber(properties, 'weight', `${location}.properties`),
        },
      } as ObjectPlacement;
    case 'trap':
      return {
        ...base,
        role,
        properties: {
          radius: readNumber(properties, 'radius', `${location}.properties`),
          slowTicks: readNumber(properties, 'slowTicks', `${location}.properties`),
          stunTicks: readNumber(properties, 'stunTicks', `${location}.properties`),
          damageTicks: readNumber(properties, 'damageTicks', `${location}.properties`),
        },
      } as ObjectPlacement;
    case 'decoy':
      return {
        ...base,
        role,
        properties: {
          radius: readNumber(properties, 'radius', `${location}.properties`),
          durationTicks: readNumber(properties, 'durationTicks', `${location}.properties`),
        },
      } as ObjectPlacement;
    default:
      throw schemaError('unknown object placement role', `${location}.role`);
  }
};

const decodeCollision = (input: unknown): BattleRoyaleArtifact['collision'] => {
  const record = readRecord(input, 'collision');
  const chunks = readArray(record.chunks, 'collision.chunks').map((chunk, index) => {
    const chunkRecord = readRecord(chunk, `collision.chunks[${index}]`);
    return {
      x: readNumber(chunkRecord, 'x', `collision.chunks[${index}]`),
      y: readNumber(chunkRecord, 'y', `collision.chunks[${index}]`),
      width: readNumber(chunkRecord, 'width', `collision.chunks[${index}]`),
      height: readNumber(chunkRecord, 'height', `collision.chunks[${index}]`),
      tiles: readArray(chunkRecord.tiles, `collision.chunks[${index}].tiles`).map(
        (tile, tileIndex) => {
          if (typeof tile !== 'number') {
            throw schemaError('expected number', `collision.chunks[${index}].tiles[${tileIndex}]`);
          }
          return tile;
        },
      ),
    };
  });

  return {
    tileWidth: readNumber(record, 'tileWidth', 'collision'),
    tileHeight: readNumber(record, 'tileHeight', 'collision'),
    chunks,
    tileIdByIndex: [...readArray(record.tileIdByIndex, 'collision.tileIdByIndex')] as never,
  };
};

const decodeObjectCollisionRect = (
  input: unknown,
  location: string,
): ObjectCollisionRectArtifact => {
  const record = readRecord(input, location);
  const readBoolean = (key: string): boolean => {
    const value = record[key];
    if (typeof value !== 'boolean') {
      throw schemaError('expected boolean', `${location}.${key}`);
    }
    return value;
  };
  return {
    objectId: readString(record, 'objectId', location) as ObjectCollisionRectArtifact['objectId'],
    x: readNumber(record, 'x', location),
    y: readNumber(record, 'y', location),
    width: readNumber(record, 'width', location),
    height: readNumber(record, 'height', location),
    blocksMovement: readBoolean('blocksMovement'),
    blocksProjectiles: readBoolean('blocksProjectiles'),
    blocksVision: readBoolean('blocksVision'),
  };
};

const decodeRuntimeBattleRoyaleArtifact = (input: unknown): BattleRoyaleArtifact => {
  const record = readRecord(input, 'artifact');
  if (record.schemaVersion !== 1) {
    throw schemaError('schemaVersion must be 1', 'schemaVersion');
  }
  const shrinkSchedule = readRecord(record.shrinkSchedule, 'shrinkSchedule');
  const mapBounds =
    record.mapBounds === undefined ? undefined : readRecord(record.mapBounds, 'mapBounds');
  const artifact: BattleRoyaleArtifact = {
    schemaVersion: 1,
    maxPlayers: readNumber(record, 'maxPlayers', 'artifact'),
    spawnPoints: readArray(record.spawnPoints, 'spawnPoints').map((point, index) =>
      decodeSpawnPoint(point, `spawnPoints[${index}]`),
    ),
    spawnAnchors: readArray(record.spawnAnchors, 'spawnAnchors').map((point, index) =>
      decodeSpawnPoint(point, `spawnAnchors[${index}]`),
    ),
    shrinkSchedule: {
      centerX: readNumber(shrinkSchedule, 'centerX', 'shrinkSchedule'),
      centerY: readNumber(shrinkSchedule, 'centerY', 'shrinkSchedule'),
      startRadiusTiles: readNumber(shrinkSchedule, 'startRadiusTiles', 'shrinkSchedule'),
      endRadiusTiles: readNumber(shrinkSchedule, 'endRadiusTiles', 'shrinkSchedule'),
      shrinkIntervalMs: readNumber(shrinkSchedule, 'shrinkIntervalMs', 'shrinkSchedule'),
      damagePerSecond: readNumber(shrinkSchedule, 'damagePerSecond', 'shrinkSchedule'),
    },
    lootTables: readArray(record.lootTables, 'lootTables').map((entry, index) =>
      decodeLootTableEntry(entry, `lootTables[${index}]`),
    ),
    objectPlacements: readArray(record.objectPlacements, 'objectPlacements').map(
      (placement, index) => decodeObjectPlacement(placement, `objectPlacements[${index}]`),
    ),
    ...(mapBounds === undefined
      ? {}
      : {
          mapBounds: {
            minX: readNumber(mapBounds, 'minX', 'mapBounds'),
            minY: readNumber(mapBounds, 'minY', 'mapBounds'),
            maxX: readNumber(mapBounds, 'maxX', 'mapBounds'),
            maxY: readNumber(mapBounds, 'maxY', 'mapBounds'),
          },
        }),
    ...(record.collision === undefined ? {} : { collision: decodeCollision(record.collision) }),
    ...(record.objectCollisionRects === undefined
      ? {}
      : {
          objectCollisionRects: readArray(record.objectCollisionRects, 'objectCollisionRects').map(
            (rect, index) => decodeObjectCollisionRect(rect, `objectCollisionRects[${index}]`),
          ),
        }),
    ...(record.tilesetPack === undefined ? {} : { tilesetPack: record.tilesetPack as never }),
    ...(record.battleRoyale === undefined ? {} : { battleRoyale: record.battleRoyale as never }),
    ...(record.playerModels === undefined
      ? {}
      : { playerModels: decodePlayerModels(record.playerModels, 'playerModels') }),
    ...(record.defaultPlayerModelId === undefined
      ? {}
      : { defaultPlayerModelId: readString(record, 'defaultPlayerModelId', 'artifact') }),
    ...(record.playerModelSelections === undefined
      ? {}
      : {
          playerModelSelections: readArray(
            record.playerModelSelections,
            'playerModelSelections',
          ).map((selection, index) =>
            decodePlayerModelSelection(selection, `playerModelSelections[${index}]`),
          ),
        }),
  };
  return artifact;
};

const validateSpawnPoint = (
  point: SpawnPointArtifact,
  location: string,
  issues: ValidationIssue[],
): void => {
  if (!Number.isFinite(point.x)) {
    issues.push(createValidationIssue('spawn x must be finite', `${location}.x`));
  }
  if (!Number.isFinite(point.y)) {
    issues.push(createValidationIssue('spawn y must be finite', `${location}.y`));
  }
  if (point.team.length === 0) {
    issues.push(createValidationIssue('spawn team is required', `${location}.team`));
  }
  if (!isPositiveFinite(point.weight)) {
    issues.push(createValidationIssue('spawn weight must be positive', `${location}.weight`));
  }
};

const validateObjectPlacement = (
  placement: ObjectPlacement,
  index: number,
  issues: ValidationIssue[],
): void => {
  const location = `objectPlacements[${index}]`;
  if (!Number.isFinite(placement.x)) {
    issues.push(createValidationIssue('object placement x must be finite', `${location}.x`));
  }
  if (!placement.objectId.startsWith('object:')) {
    issues.push(
      createValidationIssue('object placement id must be an ObjectId', `${location}.objectId`),
    );
  }
  if (!Number.isFinite(placement.y)) {
    issues.push(createValidationIssue('object placement y must be finite', `${location}.y`));
  }

  switch (placement.role) {
    case 'spawn-point':
      if (placement.kind !== SPAWN_POINT_KIND) {
        issues.push(
          createValidationIssue(
            'spawn placement kind must match the BR spawn object type',
            `${location}.kind`,
          ),
        );
      }
      if (placement.properties.team.length === 0) {
        issues.push(
          createValidationIssue('spawn placement team is required', `${location}.properties.team`),
        );
      }
      if (!isPositiveFinite(placement.properties.weight)) {
        issues.push(
          createValidationIssue(
            'spawn placement weight must be positive',
            `${location}.properties.weight`,
          ),
        );
      }
      break;
    case 'shrink-zone-anchor':
      if (placement.kind !== SHRINK_ZONE_ANCHOR_KIND) {
        issues.push(
          createValidationIssue(
            'shrink placement kind must match the BR shrink-anchor object type',
            `${location}.kind`,
          ),
        );
      }
      if (!isPositiveFinite(placement.properties.initialRadiusTiles)) {
        issues.push(
          createValidationIssue(
            'shrink placement initial radius must be positive',
            `${location}.properties.initialRadiusTiles`,
          ),
        );
      }
      if (!isNonNegativeFinite(placement.properties.finalRadiusTiles)) {
        issues.push(
          createValidationIssue(
            'shrink placement final radius must be non-negative',
            `${location}.properties.finalRadiusTiles`,
          ),
        );
      }
      break;
    case 'loot-crate':
      if (placement.kind !== LOOT_CRATE_KIND) {
        issues.push(
          createValidationIssue(
            'loot placement kind must match the BR loot object type',
            `${location}.kind`,
          ),
        );
      }
      if (placement.properties.itemKind.length === 0) {
        issues.push(
          createValidationIssue(
            'loot placement item kind is required',
            `${location}.properties.itemKind`,
          ),
        );
      }
      if (placement.properties.tier.length === 0) {
        issues.push(
          createValidationIssue('loot placement tier is required', `${location}.properties.tier`),
        );
      }
      if (!isPositiveFinite(placement.properties.weight)) {
        issues.push(
          createValidationIssue(
            'loot placement weight must be positive',
            `${location}.properties.weight`,
          ),
        );
      }
      break;
    case 'trap':
      if (placement.kind !== TRAP_KIND) {
        issues.push(
          createValidationIssue(
            'trap placement kind must match the BR trap object type',
            `${location}.kind`,
          ),
        );
      }
      if (!isPositiveFinite(placement.properties.radius)) {
        issues.push(
          createValidationIssue('trap radius must be positive', `${location}.properties.radius`),
        );
      }
      if (!isNonNegativeFinite(placement.properties.slowTicks)) {
        issues.push(
          createValidationIssue(
            'trap slow ticks must be non-negative',
            `${location}.properties.slowTicks`,
          ),
        );
      }
      if (!isNonNegativeFinite(placement.properties.stunTicks)) {
        issues.push(
          createValidationIssue(
            'trap stun ticks must be non-negative',
            `${location}.properties.stunTicks`,
          ),
        );
      }
      if (!isNonNegativeFinite(placement.properties.damageTicks)) {
        issues.push(
          createValidationIssue(
            'trap damage ticks must be non-negative',
            `${location}.properties.damageTicks`,
          ),
        );
      }
      break;
    case 'decoy':
      if (placement.kind !== DECOY_KIND) {
        issues.push(
          createValidationIssue(
            'decoy placement kind must match the BR decoy object type',
            `${location}.kind`,
          ),
        );
      }
      if (!isPositiveFinite(placement.properties.radius)) {
        issues.push(
          createValidationIssue('decoy radius must be positive', `${location}.properties.radius`),
        );
      }
      if (!isPositiveFinite(placement.properties.durationTicks)) {
        issues.push(
          createValidationIssue(
            'decoy duration must be positive',
            `${location}.properties.durationTicks`,
          ),
        );
      }
      break;
  }
};

const validatePlayerModels = (
  artifact: BattleRoyaleArtifact,
  issues: ValidationIssue[],
  requirePlayerModels: boolean,
): void => {
  const hasPlayerModelData =
    artifact.playerModels !== undefined ||
    artifact.defaultPlayerModelId !== undefined ||
    artifact.playerModelSelections !== undefined;

  if (!hasPlayerModelData && !requirePlayerModels) {
    return;
  }

  const models = artifact.playerModels ?? [];
  if (models.length === 0) {
    issues.push(createValidationIssue('at least one player model is required', 'playerModels'));
  }

  const modelIds = new Set<string>();
  models.forEach((model, index) => {
    if (modelIds.has(model.id)) {
      issues.push(
        createValidationIssue('player model ids must be unique', `playerModels[${index}].id`),
      );
    }
    modelIds.add(model.id);
    for (const issue of validatePlayerModelRef(model)) {
      issues.push(createValidationIssue(issue.message, `playerModels[${index}].${issue.path}`));
    }
  });

  const defaultModelId = artifact.defaultPlayerModelId;
  if (defaultModelId === undefined || defaultModelId.length === 0) {
    issues.push(
      createValidationIssue('default player model id is required', 'defaultPlayerModelId'),
    );
  } else if (!modelIds.has(defaultModelId)) {
    issues.push(
      createValidationIssue(
        'default player model id must exist in playerModels',
        'defaultPlayerModelId',
      ),
    );
  }

  (artifact.playerModelSelections ?? []).forEach((selection, index) => {
    const location = `playerModelSelections[${index}]`;
    if (selection.playerId.length === 0) {
      issues.push(createValidationIssue('player id is required', `${location}.playerId`));
    }
    if (!modelIds.has(selection.modelId)) {
      issues.push(
        createValidationIssue(
          'selected player model id must exist in playerModels',
          `${location}.modelId`,
        ),
      );
    }
  });
};

const validateObjectCollisionRect = (
  rect: ObjectCollisionRectArtifact,
  index: number,
  issues: ValidationIssue[],
): void => {
  const location = `objectCollisionRects[${index}]`;
  if (!rect.objectId.startsWith('object:')) {
    issues.push(
      createValidationIssue(
        'object collision objectId must be an ObjectId',
        `${location}.objectId`,
      ),
    );
  }
  if (!Number.isFinite(rect.x)) {
    issues.push(createValidationIssue('object collision x must be finite', `${location}.x`));
  }
  if (!Number.isFinite(rect.y)) {
    issues.push(createValidationIssue('object collision y must be finite', `${location}.y`));
  }
  if (!isPositiveFinite(rect.width)) {
    issues.push(
      createValidationIssue('object collision width must be positive', `${location}.width`),
    );
  }
  if (!isPositiveFinite(rect.height)) {
    issues.push(
      createValidationIssue('object collision height must be positive', `${location}.height`),
    );
  }
  if (!rect.blocksMovement && !rect.blocksProjectiles && !rect.blocksVision) {
    issues.push(
      createValidationIssue('object collision rect must block at least one channel', location),
    );
  }
};

export const validateDecodedBattleRoyaleArtifact = (
  artifact: BattleRoyaleArtifact,
  options: { readonly requirePlayerModels?: boolean } = {},
): readonly ValidationIssue[] => {
  const issues: ValidationIssue[] = [];

  if (!Number.isInteger(artifact.maxPlayers) || artifact.maxPlayers <= 0) {
    issues.push(createValidationIssue('maxPlayers must be a positive integer', 'maxPlayers'));
  }
  if (artifact.spawnAnchors.length === 0) {
    issues.push(createValidationIssue('at least one spawn anchor is required', 'spawnAnchors'));
  }
  if (artifact.spawnPoints.length !== artifact.spawnAnchors.length) {
    issues.push(
      createValidationIssue('spawnPoints and spawnAnchors must be index-aligned', 'spawnPoints'),
    );
  }
  artifact.spawnAnchors.forEach((point, index) =>
    validateSpawnPoint(point, `spawnAnchors[${index}]`, issues),
  );
  artifact.spawnPoints.forEach((point, index) =>
    validateSpawnPoint(point, `spawnPoints[${index}]`, issues),
  );

  const { shrinkSchedule } = artifact;
  if (!Number.isFinite(shrinkSchedule.centerX)) {
    issues.push(createValidationIssue('shrink centerX must be finite', 'shrinkSchedule.centerX'));
  }
  if (!Number.isFinite(shrinkSchedule.centerY)) {
    issues.push(createValidationIssue('shrink centerY must be finite', 'shrinkSchedule.centerY'));
  }
  if (!isPositiveFinite(shrinkSchedule.startRadiusTiles)) {
    issues.push(
      createValidationIssue(
        'shrink start radius must be positive',
        'shrinkSchedule.startRadiusTiles',
      ),
    );
  }
  if (!isNonNegativeFinite(shrinkSchedule.endRadiusTiles)) {
    issues.push(
      createValidationIssue(
        'shrink end radius must be non-negative',
        'shrinkSchedule.endRadiusTiles',
      ),
    );
  }
  if (shrinkSchedule.endRadiusTiles >= shrinkSchedule.startRadiusTiles) {
    issues.push(
      createValidationIssue(
        'shrink end radius must be below start radius',
        'shrinkSchedule.endRadiusTiles',
      ),
    );
  }
  if (!isPositiveFinite(shrinkSchedule.shrinkIntervalMs)) {
    issues.push(
      createValidationIssue('shrink interval must be positive', 'shrinkSchedule.shrinkIntervalMs'),
    );
  }
  if (!isNonNegativeFinite(shrinkSchedule.damagePerSecond)) {
    issues.push(
      createValidationIssue('shrink damage must be non-negative', 'shrinkSchedule.damagePerSecond'),
    );
  }

  if (artifact.mapBounds !== undefined) {
    const { minX, minY, maxX, maxY } = artifact.mapBounds;
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
      issues.push(createValidationIssue('map bounds must be finite', 'mapBounds'));
    } else {
      if (maxX <= minX) {
        issues.push(createValidationIssue('map maxX must exceed minX', 'mapBounds.maxX'));
      }
      if (maxY <= minY) {
        issues.push(createValidationIssue('map maxY must exceed minY', 'mapBounds.maxY'));
      }
    }
  }

  if (artifact.lootTables.length === 0) {
    issues.push(createValidationIssue('at least one loot table entry is required', 'lootTables'));
  }
  artifact.lootTables.forEach((entry, index) => {
    const location = `lootTables[${index}]`;
    if (entry.itemKind.length === 0) {
      issues.push(createValidationIssue('loot item kind is required', `${location}.itemKind`));
    }
    if (entry.tier.length === 0) {
      issues.push(createValidationIssue('loot tier is required', `${location}.tier`));
    }
    if (!isPositiveFinite(entry.weight)) {
      issues.push(createValidationIssue('loot weight must be positive', `${location}.weight`));
    }
  });

  artifact.objectPlacements.forEach((placement, index) =>
    validateObjectPlacement(placement, index, issues),
  );
  (artifact.objectCollisionRects ?? []).forEach((rect, index) =>
    validateObjectCollisionRect(rect, index, issues),
  );

  if (artifact.collision) {
    if (!artifact.tilesetPack) {
      issues.push(createValidationIssue('collision data requires a tileset pack', 'tilesetPack'));
    }
    if (!isPositiveFinite(artifact.collision.tileWidth)) {
      issues.push(
        createValidationIssue('collision tileWidth must be positive', 'collision.tileWidth'),
      );
    }
    if (!isPositiveFinite(artifact.collision.tileHeight)) {
      issues.push(
        createValidationIssue('collision tileHeight must be positive', 'collision.tileHeight'),
      );
    }
    if (artifact.collision.chunks.length === 0) {
      issues.push(
        createValidationIssue(
          'collision chunks are required when collision is present',
          'collision.chunks',
        ),
      );
    }
    if (artifact.collision.tileIdByIndex.length === 0) {
      issues.push(
        createValidationIssue(
          'collision tileIdByIndex must not be empty',
          'collision.tileIdByIndex',
        ),
      );
    }
    artifact.collision.chunks.forEach((chunk, index) => {
      const location = `collision.chunks[${index}]`;
      if (!isPositiveFinite(chunk.width)) {
        issues.push(
          createValidationIssue('collision chunk width must be positive', `${location}.width`),
        );
      }
      if (!isPositiveFinite(chunk.height)) {
        issues.push(
          createValidationIssue('collision chunk height must be positive', `${location}.height`),
        );
      }
      if (chunk.tiles.length !== chunk.width * chunk.height) {
        issues.push(
          createValidationIssue(
            'collision chunk tiles must match width * height',
            `${location}.tiles`,
          ),
        );
      }
      chunk.tiles.forEach((tile, tileIndex) => {
        if (!Number.isInteger(tile) || tile < 0) {
          issues.push(
            createValidationIssue(
              'collision tile index must be a non-negative integer',
              `${location}.tiles[${tileIndex}]`,
            ),
          );
        }
      });
    });
  }

  validatePlayerModels(artifact, issues, options.requirePlayerModels ?? false);

  return issues;
};

export const assertRuntimeBattleRoyaleArtifact = (input: unknown): BattleRoyaleArtifact => {
  const artifact = decodeRuntimeBattleRoyaleArtifact(input);
  const issues = validateDecodedBattleRoyaleArtifact(artifact, { requirePlayerModels: true });
  if (issues.length > 0) {
    const detail = issues.map((issue) => `${issue.location}: ${issue.message}`).join('; ');
    throw new Error(`Invalid Battle Royale artifact: ${detail}`);
  }
  return artifact;
};
