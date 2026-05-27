import path from "node:path";

import { ContentHash, MapId, PackCapability, PackId, ProjectId } from "@tileborne/core";
import { Schema } from "effect";

export class MapIntegrityEntry extends Schema.Class<MapIntegrityEntry>("MapIntegrityEntry")({
  id: MapId,
  path: Schema.String,
  hash: ContentHash,
}) {}

export class ProjectIntegrityLock extends Schema.Class<ProjectIntegrityLock>("ProjectIntegrityLock")({
  schemaVersion: Schema.Literal(1),
  projectHash: ContentHash,
  maps: Schema.Array(MapIntegrityEntry),
}) {}

export class AssetFileIntegrityEntry extends Schema.Class<AssetFileIntegrityEntry>(
  "AssetFileIntegrityEntry",
)({
  path: Schema.String,
  hash: ContentHash,
}) {}

export class AssetPackCapabilityLock extends Schema.Class<AssetPackCapabilityLock>(
  "AssetPackCapabilityLock",
)({
  integrityHash: ContentHash,
  capability: PackCapability,
}) {}

export class AssetPackIntegrityLock extends Schema.Class<AssetPackIntegrityLock>(
  "AssetPackIntegrityLock",
)({
  schemaVersion: Schema.Literal(1),
  packId: PackId,
  version: Schema.String,
  manifestHash: ContentHash,
  files: Schema.Array(AssetFileIntegrityEntry),
  capability: Schema.OptionFromOptional(AssetPackCapabilityLock),
}) {}

export const projectDirectory = (projectsRoot: string, projectId: ProjectId): string =>
  path.join(projectsRoot, projectId);

export const projectManifestPath = (projectDir: string): string => path.join(projectDir, "project.json");

export const projectLockPath = (projectDir: string): string => path.join(projectDir, "project.lock.json");

export const projectMapsDirectory = (projectDir: string): string => path.join(projectDir, "maps");

export const mapPath = (projectDir: string, mapId: MapId): string =>
  path.join(projectMapsDirectory(projectDir), `${mapId}.json`);

export const relativeMapPath = (mapId: MapId): string => `maps/${mapId}.json`;

export const packsRoot = (assetsRoot: string): string => path.join(assetsRoot, "packs");

export const packDirectoryName = (packId: PackId, version: string): string => `${packId}-${version}`;

export const packDirectory = (assetsRoot: string, packId: PackId, version: string): string =>
  path.join(packsRoot(assetsRoot), packDirectoryName(packId, version));

export const packManifestPath = (packDir: string): string =>
  path.join(packDir, "tileborne-asset-pack.json");

export const packLockPath = (packDir: string): string => path.join(packDir, "lock.json");
