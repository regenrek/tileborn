import { readFile } from "node:fs/promises";

import {
  type CatalogContributionInput,
  decodeGameObjectCatalog,
  type PluginManifest,
  type RuntimeGameObjectCatalogContribution,
} from "@tileborne/plugin-api";
import { Effect, Option, Result } from "effect";

import { resolvePluginManifestPath } from "./filesystem.js";
import { PluginValidationError } from "./model.js";

const toMessage = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Materialize the raw catalog JSON a `gameObjectCatalogs` contribution points
 * at (ADR-0019). Following the ADR-0015 bundled-data precedent, declarative
 * contribution `data` may either embed the catalog inline or carry an
 * `{ indexPath }` that resolves to a JSON file relative to the plugin root —
 * resolved through {@link resolvePluginManifestPath} so it can never escape the
 * plugin sandbox.
 */
const materializeCatalogData = (
  rootPath: string,
  contribution: RuntimeGameObjectCatalogContribution,
): Effect.Effect<unknown, PluginValidationError> =>
  Effect.gen(function* () {
    const data: unknown = contribution.data;
    const indexPath =
      isRecord(data) && typeof data.indexPath === "string" ? data.indexPath : undefined;
    if (indexPath === undefined) {
      // No indirection: the contribution embeds the catalog content pack inline.
      return data;
    }
    const resolvedPath = yield* Effect.tryPromise({
      try: () => resolvePluginManifestPath(rootPath, indexPath),
      catch: (cause) =>
        cause instanceof PluginValidationError
          ? cause
          : new PluginValidationError({ path: indexPath, message: toMessage(cause) }),
    });
    const raw = yield* Effect.tryPromise({
      try: () => readFile(resolvedPath, "utf8"),
      catch: (cause) => new PluginValidationError({ path: resolvedPath, message: toMessage(cause) }),
    });
    return yield* Effect.try({
      try: (): unknown => JSON.parse(raw),
      catch: (cause) => new PluginValidationError({ path: resolvedPath, message: toMessage(cause) }),
    });
  });

/**
 * Resolve a plugin's `RuntimeGameObjectCatalog` contributions into decoded
 * {@link CatalogContributionInput}s ready for `mergeGameObjectCatalogs`
 * (ADR-0019). This is the production registration path that makes the public
 * catalog slot operational: it resolves each contribution's `data.indexPath`
 * (or inline data) relative to `rootPath`, then decodes it against the core
 * `GameObjectCatalog` schema via {@link decodeGameObjectCatalog}.
 */
export const resolveGameObjectCatalogContributions = (
  rootPath: string,
  contributions: readonly RuntimeGameObjectCatalogContribution[],
): Effect.Effect<readonly CatalogContributionInput[], PluginValidationError> =>
  Effect.gen(function* () {
    const resolved: CatalogContributionInput[] = [];
    for (const contribution of contributions) {
      const materialized = yield* materializeCatalogData(rootPath, contribution);
      const decoded = decodeGameObjectCatalog(contribution.id, materialized);
      if (Result.isFailure(decoded)) {
        return yield* new PluginValidationError({
          path: rootPath,
          message: decoded.failure.message,
        });
      }
      resolved.push({ contributionId: contribution.id, catalog: decoded.success });
    }
    return resolved;
  });

/**
 * Extract and resolve the `gameObjectCatalogs` contributions from a decoded
 * plugin manifest. Returns an empty list when the plugin contributes none. The
 * caller merges the result across plugins with `mergeGameObjectCatalogs`.
 */
export const resolvePluginGameObjectCatalogs = (
  rootPath: string,
  manifest: PluginManifest,
): Effect.Effect<readonly CatalogContributionInput[], PluginValidationError> => {
  const runtime = manifest.contributes.runtime;
  if (Option.isNone(runtime)) {
    return Effect.succeed([]);
  }
  const catalogs = runtime.value.gameObjectCatalogs;
  if (Option.isNone(catalogs)) {
    return Effect.succeed([]);
  }
  return resolveGameObjectCatalogContributions(rootPath, catalogs.value);
};
