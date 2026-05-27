import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  AssetPackManifest,
  AssetPackManifestAsset,
  assetPackManifestToJson,
  License,
} from "@tileborne/asset-pipeline";
import {
  AssetId,
  ContentHash,
  hashBytes,
  makeAssetId,
  makePackId,
  type PackId,
} from "@tileborne/core";
import { Option } from "effect";

import { expectCliJsonData } from "./run-cli.js";

const execFileAsync = promisify(execFile);

export interface HomeProjectContext {
  readonly projectSlug: string;
  readonly projectId: string;
  readonly projectPath: string;
}

export const initHomeProject = async (slug: string): Promise<HomeProjectContext> => {
  const init = await expectCliJsonData<{ readonly path: string; readonly manifest: { readonly id: string; readonly name: string } }>([
    "project",
    "init",
    slug,
  ]);
  const projectPath = path.join(path.dirname(init.path), init.manifest.id);
  await rename(init.path, projectPath);
  return {
    projectSlug: init.manifest.name,
    projectId: init.manifest.id,
    projectPath,
  };
};

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const license = new License({
  spdxId: "CC0-1.0",
  attribution: Option.none(),
  sourceUrl: Option.some("https://example.invalid/assets"),
  notes: Option.none(),
});

export const writePluginSource = async (
  directory: string,
  id = "@tileborne-plugins/e2e-plugin",
): Promise<void> => {
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "tileborne-plugin.json"),
    `{
  "schemaVersion": 1,
  "id": ${JSON.stringify(id)},
  "name": "e2e-plugin",
  "version": "0.1.0",
  "displayName": "E2E Plugin",
  "description": "E2E plugin fixture",
  "author": "Tileborne",
  "license": "MIT",
  "engines": { "tileborne": "^0.1.0" },
  "contributes": {},
  "permissions": [],
  "dependsOn": []
}
`,
  );
  await writeFile(path.join(directory, "README.md"), "e2e fixture\n");
};

export const writeAssetPackSource = async (
  directory: string,
  packId: PackId = makePackId("550e8400-e29b-41d4-a716-446655440010"),
): Promise<void> => {
  const manifest = new AssetPackManifest({
    id: packId,
    name: "E2E Pack",
    version: "1.0.0",
    license,
    assets: [
      new AssetPackManifestAsset({
        id: makeAssetId("550e8400-e29b-41d4-a716-446655440011") as AssetId,
        path: "tiles/terrain.png",
        mime: "image/png",
        size: png.byteLength,
        hash: hashBytes(png) as ContentHash,
        license: Option.some(license),
      }),
    ],
  });
  await mkdir(path.join(directory, "tiles"), { recursive: true });
  await writeFile(
    path.join(directory, "tileborne-asset-pack.json"),
    `${JSON.stringify(assetPackManifestToJson(manifest), null, 2)}\n`,
  );
  await writeFile(path.join(directory, "tiles", "terrain.png"), png);
};

export const writeBrokenMapFixture = async (): Promise<string> => {
  const brokenDir = await mkdtemp(path.join(tmpdir(), "tileborne-e2e-broken-map-"));
  const { emptyMapFixture } = await import("./paths.js");
  const raw = JSON.parse(await readFile(emptyMapFixture, "utf8")) as {
    layers: { chunks: { tiles: number[] }[] }[];
  };
  const layer = raw.layers[0];
  const chunk = layer?.chunks[0];
  if (!layer || !chunk) {
    throw new Error("empty-map fixture missing expected layer/chunk");
  }
  chunk.tiles = [0];
  await writeFile(path.join(brokenDir, "broken.json"), `${JSON.stringify(raw, null, 2)}\n`);
  return brokenDir;
};

export const packPluginTarball = async (
  source: string,
  archivePath: string,
): Promise<{ archive: string; integrity: string }> => {
  await mkdir(path.dirname(archivePath), { recursive: true });
  await execFileAsync("tar", ["-czf", archivePath, "-C", source, "."]);
  const bytes = await readFile(archivePath);
  const { createHash } = await import("node:crypto");
  const integrity = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  return { archive: archivePath, integrity };
};
