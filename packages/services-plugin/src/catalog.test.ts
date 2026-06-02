import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { gameObjectTypeIdForKey } from "@tileborne/core";
import { mergeGameObjectCatalogs, PluginManifest } from "@tileborne/plugin-api";
import { Effect, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { resolvePluginGameObjectCatalogs } from "./catalog.js";
import { materializePluginManifestInput } from "./filesystem.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const battleRoyaleRoot = path.join(repoRoot, "packages/plugin-battle-royale");

/** Decode the shipped Battle Royale manifest the same way the registry does. */
const battleRoyaleManifest = (): PluginManifest => {
  const raw: unknown = JSON.parse(
    readFileSync(path.join(battleRoyaleRoot, "tileborne-plugin.json"), "utf8"),
  );
  return Schema.decodeUnknownSync(PluginManifest)(materializePluginManifestInput(raw));
};

describe("resolvePluginGameObjectCatalogs (real Battle Royale manifest)", () => {
  it("resolves the contribution's `data.indexPath` into a decoded catalog", async () => {
    const manifest = battleRoyaleManifest();

    const contributions = await Effect.runPromise(
      resolvePluginGameObjectCatalogs(battleRoyaleRoot, manifest),
    );

    expect(contributions).toHaveLength(1);
    expect(contributions[0]?.contributionId).toBe("br-game-object-catalog");
    expect(contributions[0]?.catalog.objectTypes).toHaveLength(3);
  });

  it("merges the resolved catalog with the expected object-type ids", async () => {
    const manifest = battleRoyaleManifest();
    const contributions = await Effect.runPromise(
      resolvePluginGameObjectCatalogs(battleRoyaleRoot, manifest),
    );

    const merged = mergeGameObjectCatalogs(contributions);
    expect(Result.isSuccess(merged)).toBe(true);
    if (Result.isSuccess(merged)) {
      expect(merged.success.byId.has(gameObjectTypeIdForKey("spawn-point"))).toBe(true);
      expect(merged.success.byId.has(gameObjectTypeIdForKey("shrink-zone-anchor"))).toBe(true);
      expect(merged.success.byId.has(gameObjectTypeIdForKey("loot-crate"))).toBe(true);
    }
  });
});
