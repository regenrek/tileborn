import type { JsonObject } from "@tileborne/core";
import type { TileIdType, TilesetPack } from "@tileborne/sdk-tileset/schemas";

import type { BattleRoyaleConfigInput } from "../battle-royale-config.js";

export type IssueSeverity = "error" | "warning";

export interface ValidationIssue {
  readonly severity: IssueSeverity;
  readonly message: string;
  readonly location?: string;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly issues: readonly ValidationIssue[];
}

export interface SpawnPointArtifact {
  readonly x: number;
  readonly y: number;
  readonly team: string;
  readonly weight: number;
}

export interface ShrinkSchedule {
  readonly centerX: number;
  readonly centerY: number;
  readonly startRadiusTiles: number;
  readonly endRadiusTiles: number;
  readonly shrinkIntervalMs: number;
  readonly damagePerSecond: number;
}

export interface LootTableEntry {
  readonly itemKind: string;
  readonly tier: string;
  readonly weight: number;
}

export interface ObjectPlacement {
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly properties: JsonObject;
}

export interface CollisionChunkArtifact {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly tiles: readonly number[];
}

export interface MapCollisionArtifact {
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly chunks: readonly CollisionChunkArtifact[];
  readonly tileIdByIndex: readonly (TileIdType | null)[];
}

export interface BattleRoyaleArtifact {
  readonly schemaVersion: 1;
  readonly maxPlayers: number;
  readonly spawnPoints: readonly SpawnPointArtifact[];
  readonly spawnAnchors: readonly SpawnPointArtifact[];
  readonly shrinkSchedule: ShrinkSchedule;
  readonly lootTables: readonly LootTableEntry[];
  readonly objectPlacements: readonly ObjectPlacement[];
  readonly collision?: MapCollisionArtifact;
  readonly tilesetPack?: TilesetPack;
  /** Parsed `map.properties.battleRoyale` overrides for runtime merge. */
  readonly battleRoyale?: BattleRoyaleConfigInput;
}

export type ExportedArtifact = BattleRoyaleArtifact;

export interface ExportArtifactOptions {
  readonly shrinkIntervalMs?: number;
  readonly damagePerSecond?: number;
  readonly tilesetPack?: TilesetPack;
}

export interface GenerateMapOptions {
  readonly width: number;
  readonly height: number;
  readonly spawnCount: number;
  readonly lootDensity: number;
}
