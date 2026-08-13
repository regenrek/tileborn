import type { TileborneMap } from '@tileborne/core';

import {
  ABILITY,
  BARRIER_KIND,
  LOOT_CRATE_KEY,
  LOOT_CRATE_KIND,
  MIN_LOOT_CRATES,
  MIN_SPAWN_POINTS,
  REQUIRED_SHRINK_ANCHORS,
  SHRINK_ZONE_ANCHOR_KEY,
  SHRINK_ZONE_ANCHOR_KIND,
  MOVEMENT,
  SPAWN_OPENING_BUFFER,
  SPAWN_POINT_KEY,
  SPAWN_POINT_KIND,
  TRAP_KIND,
} from './constants.js';
import { MIN_SPAWN_CLEARANCE, findClosestSpawnPair, isSpawnPointSafe } from './spawn-layout.js';
import type { ValidationIssue, ValidationResult } from './types/artifact.js';

const countByKind = (map: TileborneMap): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const object of map.objects) {
    counts.set(object.kind, (counts.get(object.kind) ?? 0) + 1);
  }
  return counts;
};

const objectsByKind = (map: TileborneMap, kind: string) =>
  map.objects.filter((object) => object.kind === kind);

const issue = (
  severity: ValidationIssue['severity'],
  message: string,
  location?: string,
): ValidationIssue => ({
  severity,
  message,
  ...(location === undefined ? {} : { location }),
});

export const validateMap = (map: TileborneMap): ValidationResult => {
  const issues: ValidationIssue[] = [];
  const counts = countByKind(map);

  const spawnCount = counts.get(SPAWN_POINT_KIND) ?? 0;
  if (spawnCount < MIN_SPAWN_POINTS) {
    issues.push(
      issue(
        'error',
        `Expected at least ${MIN_SPAWN_POINTS} ${SPAWN_POINT_KEY} objects, found ${spawnCount}`,
        'objects',
      ),
    );
  }
  const spawnObjects = objectsByKind(map, SPAWN_POINT_KIND);
  const closestSpawnPair = findClosestSpawnPair(spawnObjects);
  if (closestSpawnPair !== undefined && closestSpawnPair.distance < MIN_SPAWN_CLEARANCE) {
    issues.push(
      issue(
        'warning',
        `Closest spawn points are ${closestSpawnPair.distance.toFixed(
          1,
        )} world units apart; keep at least ${MIN_SPAWN_CLEARANCE} for player clearance`,
        'objects',
      ),
    );
  }

  const hazards = objectsByKind(map, TRAP_KIND).map((trap) => ({
    x: trap.x,
    y: trap.y,
    radius:
      typeof trap.properties.radius === 'number' ? trap.properties.radius : ABILITY.trap.radius,
  }));
  const blockers = objectsByKind(map, BARRIER_KIND).map((barrier) => ({
    x: barrier.x,
    y: barrier.y,
    width:
      typeof barrier.properties.width === 'number' ? barrier.properties.width : map.tileSize.width,
    height:
      typeof barrier.properties.height === 'number'
        ? barrier.properties.height
        : map.tileSize.height,
  }));
  const unsafeSpawn = spawnObjects.find(
    (spawn) =>
      !isSpawnPointSafe(spawn, {
        playerRadius: MOVEMENT.radius,
        openingBuffer: SPAWN_OPENING_BUFFER,
        hazards,
        blockers,
      }),
  );
  if (unsafeSpawn !== undefined) {
    issues.push(
      issue(
        'error',
        'Spawn points must keep opening clearance from traps and blocking objects',
        `objects.${unsafeSpawn.id}`,
      ),
    );
  }

  const anchorCount = counts.get(SHRINK_ZONE_ANCHOR_KIND) ?? 0;
  if (anchorCount !== REQUIRED_SHRINK_ANCHORS) {
    issues.push(
      issue(
        'error',
        `Expected exactly ${REQUIRED_SHRINK_ANCHORS} ${SHRINK_ZONE_ANCHOR_KEY}, found ${anchorCount}`,
        'objects',
      ),
    );
  }

  const lootCount = counts.get(LOOT_CRATE_KIND) ?? 0;
  if (lootCount < MIN_LOOT_CRATES) {
    issues.push(
      issue(
        'error',
        `Expected at least ${MIN_LOOT_CRATES} ${LOOT_CRATE_KEY} spawn region(s), found ${lootCount}`,
        'objects',
      ),
    );
  }

  return { ok: issues.every((entry) => entry.severity !== 'error'), issues };
};
