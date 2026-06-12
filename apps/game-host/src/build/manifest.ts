import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { type ContentHash, hashBytes, hashJsonStable } from "@tileborne/core";
import { PROTOCOL_VERSION } from "@tileborne/runtime";

import type {
  BundledAssetPackSummary,
  BundledManifest,
  BundledManifestFileEntry,
  BundledMapPackageSummary,
  BundledPluginSummary,
} from "../types.js";

export interface BuildManifestInput {
  readonly plugin: BundledPluginSummary;
  readonly assetPacks: readonly BundledAssetPackSummary[];
  readonly maps: readonly BundledMapPackageSummary[];
  readonly runtimeVersion: string;
  readonly workerFiles: readonly BundledManifestFileEntry[];
  readonly createdAt: string;
}

export const hashFileSha256 = async (filePath: string): Promise<ContentHash> => {
  const bytes = await readFile(filePath);
  return hashBytes(bytes);
};

export const fileEntryFromPath = async (root: string, relativePath: string): Promise<BundledManifestFileEntry> => {
  const absolute = path.join(root, relativePath);
  const bytes = await readFile(absolute);
  const fileStat = await stat(absolute);
  return {
    path: relativePath.replace(/\\/g, "/"),
    hash: hashBytes(bytes),
    size: fileStat.size,
  };
};

export const hashManifestPayload = (payload: Omit<BundledManifest, "buildId">): ContentHash =>
  hashJsonStable({
    schemaVersion: payload.schemaVersion,
    plugin: payload.plugin,
    assetPacks: payload.assetPacks,
    maps: payload.maps,
    runtimeVersion: payload.runtimeVersion,
    protocolVersion: payload.protocolVersion,
    workerFiles: payload.workerFiles,
    createdAt: payload.createdAt,
  });

export const buildBundledManifest = (input: BuildManifestInput): BundledManifest => {
  const withoutBuildId = {
    schemaVersion: 1 as const,
    plugin: input.plugin,
    assetPacks: input.assetPacks,
    maps: input.maps,
    runtimeVersion: input.runtimeVersion,
    protocolVersion: PROTOCOL_VERSION,
    workerFiles: input.workerFiles,
    createdAt: input.createdAt,
  };
  const buildId = hashManifestPayload(withoutBuildId);
  return { ...withoutBuildId, buildId };
};

export const digestHex = (input: string): string => createHash("sha256").update(input).digest("hex");
