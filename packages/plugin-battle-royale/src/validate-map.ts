import type { TileborneMap } from "@tileborne/core";

import {
  LOOT_CRATE_KIND,
  MIN_LOOT_CRATES,
  MIN_SPAWN_POINTS,
  REQUIRED_SHRINK_ANCHORS,
  SHRINK_ZONE_ANCHOR_KIND,
  SPAWN_POINT_KIND,
} from "./constants.js";
import type { ValidationIssue, ValidationResult } from "./types/artifact.js";

const countByKind = (map: TileborneMap): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const object of map.objects) {
    counts.set(object.kind, (counts.get(object.kind) ?? 0) + 1);
  }
  return counts;
};

const issue = (severity: ValidationIssue["severity"], message: string, location?: string): ValidationIssue => ({
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
        "error",
        `Expected at least ${MIN_SPAWN_POINTS} ${SPAWN_POINT_KIND} objects, found ${spawnCount}`,
        "objects",
      ),
    );
  }

  const anchorCount = counts.get(SHRINK_ZONE_ANCHOR_KIND) ?? 0;
  if (anchorCount !== REQUIRED_SHRINK_ANCHORS) {
    issues.push(
      issue(
        "error",
        `Expected exactly ${REQUIRED_SHRINK_ANCHORS} ${SHRINK_ZONE_ANCHOR_KIND}, found ${anchorCount}`,
        "objects",
      ),
    );
  }

  const lootCount = counts.get(LOOT_CRATE_KIND) ?? 0;
  if (lootCount < MIN_LOOT_CRATES) {
    issues.push(
      issue(
        "error",
        `Expected at least ${MIN_LOOT_CRATES} ${LOOT_CRATE_KIND} spawn region(s), found ${lootCount}`,
        "objects",
      ),
    );
  }

  return { ok: issues.length === 0, issues };
};
