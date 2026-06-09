import { GameObjectTypeId, ObjectId, PlayerModelRef, TileId, type GameObjectType } from "@tileborne/core";
import type { TilesetPack } from "@tileborne/sdk-tileset/schemas";
import { Schema } from "effect";

import { BattleRoyaleConfig } from "../battle-royale-config.js";
import {
  createValidationIssue,
  validateDecodedBattleRoyaleArtifact,
} from "./runtime-artifact-validation.js";

export const IssueSeveritySchema = Schema.Literals(["error", "warning"] as const);
export type IssueSeverity = typeof IssueSeveritySchema.Type;

export const ValidationIssueSchema = Schema.Struct({
  severity: IssueSeveritySchema,
  message: Schema.String,
  location: Schema.optional(Schema.String),
});
export type ValidationIssue = typeof ValidationIssueSchema.Type;

export const ValidationResultSchema = Schema.Struct({
  ok: Schema.Boolean,
  issues: Schema.Array(ValidationIssueSchema),
});
export type ValidationResult = typeof ValidationResultSchema.Type;

export const SpawnPointArtifactSchema = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  team: Schema.String,
  weight: Schema.Number,
});
export type SpawnPointArtifact = typeof SpawnPointArtifactSchema.Type;

export const ShrinkScheduleSchema = Schema.Struct({
  centerX: Schema.Number,
  centerY: Schema.Number,
  startRadiusTiles: Schema.Number,
  endRadiusTiles: Schema.Number,
  shrinkIntervalMs: Schema.Number,
  damagePerSecond: Schema.Number,
});
export type ShrinkSchedule = typeof ShrinkScheduleSchema.Type;

export const LootTableEntrySchema = Schema.Struct({
  itemKind: Schema.String,
  tier: Schema.String,
  weight: Schema.Number,
});
export type LootTableEntry = typeof LootTableEntrySchema.Type;

export const PlayerModelSelectionArtifactSchema = Schema.Struct({
  playerId: Schema.String,
  modelId: Schema.String,
});
export type PlayerModelSelectionArtifact = typeof PlayerModelSelectionArtifactSchema.Type;

export const ObjectPlacementRoleSchema = Schema.Literals([
  "spawn-point",
  "shrink-zone-anchor",
  "loot-crate",
  "trap",
  "decoy",
] as const);
export type ObjectPlacementRole = typeof ObjectPlacementRoleSchema.Type;

export const SpawnPointObjectPlacementSchema = Schema.Struct({
  objectId: ObjectId,
  role: Schema.Literal("spawn-point"),
  kind: GameObjectTypeId,
  x: Schema.Number,
  y: Schema.Number,
  properties: Schema.Struct({
    team: Schema.String,
    weight: Schema.Number,
  }),
});
export type SpawnPointObjectPlacement = typeof SpawnPointObjectPlacementSchema.Type;

export const ShrinkZoneAnchorObjectPlacementSchema = Schema.Struct({
  objectId: ObjectId,
  role: Schema.Literal("shrink-zone-anchor"),
  kind: GameObjectTypeId,
  x: Schema.Number,
  y: Schema.Number,
  properties: Schema.Struct({
    initialRadiusTiles: Schema.Number,
    finalRadiusTiles: Schema.Number,
  }),
});
export type ShrinkZoneAnchorObjectPlacement = typeof ShrinkZoneAnchorObjectPlacementSchema.Type;

export const LootCrateObjectPlacementSchema = Schema.Struct({
  objectId: ObjectId,
  role: Schema.Literal("loot-crate"),
  kind: GameObjectTypeId,
  x: Schema.Number,
  y: Schema.Number,
  properties: Schema.Struct({
    itemKind: Schema.String,
    tier: Schema.String,
    weight: Schema.Number,
  }),
});
export type LootCrateObjectPlacement = typeof LootCrateObjectPlacementSchema.Type;

export const TrapObjectPlacementSchema = Schema.Struct({
  objectId: ObjectId,
  role: Schema.Literal("trap"),
  kind: GameObjectTypeId,
  x: Schema.Number,
  y: Schema.Number,
  properties: Schema.Struct({
    radius: Schema.Number,
    slowTicks: Schema.Number,
    stunTicks: Schema.Number,
    damageTicks: Schema.Number,
  }),
});
export type TrapObjectPlacement = typeof TrapObjectPlacementSchema.Type;

export const DecoyObjectPlacementSchema = Schema.Struct({
  objectId: ObjectId,
  role: Schema.Literal("decoy"),
  kind: GameObjectTypeId,
  x: Schema.Number,
  y: Schema.Number,
  properties: Schema.Struct({
    radius: Schema.Number,
    durationTicks: Schema.Number,
  }),
});
export type DecoyObjectPlacement = typeof DecoyObjectPlacementSchema.Type;

export const ObjectPlacementSchema = Schema.Union([
  SpawnPointObjectPlacementSchema,
  ShrinkZoneAnchorObjectPlacementSchema,
  LootCrateObjectPlacementSchema,
  TrapObjectPlacementSchema,
  DecoyObjectPlacementSchema,
]);
export type ObjectPlacement = typeof ObjectPlacementSchema.Type;

export const CollisionChunkArtifactSchema = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
  tiles: Schema.Array(Schema.Number),
});
export type CollisionChunkArtifact = typeof CollisionChunkArtifactSchema.Type;

export const MapCollisionArtifactSchema = Schema.Struct({
  tileWidth: Schema.Number,
  tileHeight: Schema.Number,
  chunks: Schema.Array(CollisionChunkArtifactSchema),
  tileIdByIndex: Schema.Array(Schema.Union([TileId, Schema.Null])),
});
export type MapCollisionArtifact = typeof MapCollisionArtifactSchema.Type;

export const ObjectCollisionRectArtifactSchema = Schema.Struct({
  objectId: ObjectId,
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
  blocksMovement: Schema.Boolean,
  blocksProjectiles: Schema.Boolean,
  blocksVision: Schema.Boolean,
});
export type ObjectCollisionRectArtifact = typeof ObjectCollisionRectArtifactSchema.Type;

export const RuntimeTilesetPackSchema = Schema.Struct({
  tilesets: Schema.Array(
    Schema.Struct({
      tiles: Schema.Array(
        Schema.Struct({
          id: TileId,
          collisionMask: Schema.optional(Schema.Unknown),
        }),
      ),
    }),
  ),
});
export type RuntimeTilesetPack = typeof RuntimeTilesetPackSchema.Type;

export const BattleRoyaleArtifactSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  maxPlayers: Schema.Number,
  spawnPoints: Schema.Array(SpawnPointArtifactSchema),
  spawnAnchors: Schema.Array(SpawnPointArtifactSchema),
  shrinkSchedule: ShrinkScheduleSchema,
  lootTables: Schema.Array(LootTableEntrySchema),
  objectPlacements: Schema.Array(ObjectPlacementSchema),
  collision: Schema.optional(MapCollisionArtifactSchema),
  objectCollisionRects: Schema.optional(Schema.Array(ObjectCollisionRectArtifactSchema)),
  tilesetPack: Schema.optional(RuntimeTilesetPackSchema),
  battleRoyale: Schema.optional(BattleRoyaleConfig),
  playerModels: Schema.optional(Schema.Array(PlayerModelRef)),
  defaultPlayerModelId: Schema.optional(Schema.String),
  playerModelSelections: Schema.optional(Schema.Array(PlayerModelSelectionArtifactSchema)),
});
export type BattleRoyaleArtifact = typeof BattleRoyaleArtifactSchema.Type;

export type ExportedArtifact = BattleRoyaleArtifact;

export interface ExportArtifactOptions {
  readonly shrinkIntervalMs?: number;
  readonly damagePerSecond?: number;
  readonly tilesetPack?: TilesetPack;
  readonly objectTypes?: readonly GameObjectType[];
  readonly playerModels?: readonly PlayerModelRef[];
  readonly selectedPlayerModelId?: string;
  readonly defaultPlayerModelId?: string;
}

export interface GenerateMapOptions {
  readonly width: number;
  readonly height: number;
  readonly spawnCount: number;
  readonly lootDensity: number;
}

export const decodeBattleRoyaleArtifact = (input: unknown): BattleRoyaleArtifact =>
  Schema.decodeUnknownSync(BattleRoyaleArtifactSchema)(input);

export const validateBattleRoyaleArtifact = (input: unknown): ValidationResult => {
  let artifact: BattleRoyaleArtifact;
  try {
    artifact = decodeBattleRoyaleArtifact(input);
  } catch (error) {
    return {
      ok: false,
      issues: [
        createValidationIssue(
          error instanceof Error ? error.message : "artifact does not match BattleRoyaleArtifact schema",
          "artifact",
        ),
      ],
    };
  }

  const issues = validateDecodedBattleRoyaleArtifact(artifact);
  return { ok: issues.length === 0, issues };
};

export const assertBattleRoyaleArtifact = (input: unknown): BattleRoyaleArtifact => {
  const artifact = decodeBattleRoyaleArtifact(input);
  const issues = validateDecodedBattleRoyaleArtifact(artifact);
  if (issues.length > 0) {
    const detail = issues.map((issue) => `${issue.location}: ${issue.message}`).join("; ");
    throw new Error(`Invalid Battle Royale artifact: ${detail}`);
  }
  return artifact;
};
