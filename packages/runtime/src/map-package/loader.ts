import {
  JsonObject,
  RuntimeBehaviorPackage,
  RUNTIME_MAP_PACKAGE_SCHEMA_VERSION,
  RuntimeCatalogEntry,
  RuntimeMapPackage,
  RuntimeMapPackageAssetEntry,
  RuntimeMapPackageInvalidError,
  RuntimeMapPackageManifest,
  RuntimeMapPackageVisuals,
  RuntimeObjectPlacement,
  decodePersistedTileborneMapJson,
} from '@tileborne/core';
import { Option, Result, Schema } from 'effect';

/**
 * Worker-safe runtime map package loader (ADR-0030).
 *
 * The ONE load path every host shares (desktop playtest host, local
 * multiplayer host, `apps/game-host` rooms, shipped game build). IO is
 * injected as a {@link RuntimeMapPackageEntryReader} so the same loader runs
 * against `node:fs` at the host edge, `fetch` in a browser, or an in-memory
 * map in tests — this module itself imports no Node APIs (the
 * import-boundaries rule for `packages/runtime`). Hashing uses the WebCrypto
 * `crypto.subtle` global (Node 18+/workers/browsers).
 */

/** Reads one package-relative entry; `undefined` when the entry is missing. */
export type RuntimeMapPackageEntryReader = (entryPath: string) => Promise<Uint8Array | undefined>;

/** Canonical on-disk layout: one JSON file per package section + manifest. */
export const RUNTIME_MAP_PACKAGE_MANIFEST_FILE = 'manifest.json';
export const RUNTIME_MAP_PACKAGE_ENTRY_FILES = {
  map: 'map.json',
  catalog: 'catalog.json',
  placements: 'placements.json',
  settings: 'settings.json',
  content: 'content.json',
  behaviors: 'behaviors.json',
  visuals: 'visuals.json',
  assets: 'assets.json',
  modeData: 'mode-data.json',
} as const;
export type RuntimeMapPackageEntryName = keyof typeof RUNTIME_MAP_PACKAGE_ENTRY_FILES;

/** Internal control flow: unwound at the `loadRuntimeMapPackage` boundary. */
class LoadFailure extends Error {
  constructor(readonly error: RuntimeMapPackageInvalidError) {
    super(error.message);
  }
}

const fail = (reason: 'schema' | 'version' | 'integrity', message: string): never => {
  throw new LoadFailure(new RuntimeMapPackageInvalidError({ reason, message }));
};

const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const buffer = new Uint8Array(bytes).buffer;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

/** Hash one entry payload into the manifest's `sha256:<hex>` format. */
export const hashRuntimeMapPackageEntry = async (bytes: Uint8Array): Promise<string> =>
  `sha256:${await sha256Hex(bytes)}`;

const parseJson = (entryName: string, bytes: Uint8Array): unknown => {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch (error) {
    return fail('schema', `entry ${entryName} is not valid JSON: ${String(error)}`);
  }
};

const decodeEntry = <A, I>(entryName: string, schema: Schema.Codec<A, I>, value: unknown): A => {
  const decoded = Schema.decodeUnknownOption(schema)(value);
  return Option.isSome(decoded)
    ? decoded.value
    : fail('schema', `entry ${entryName} does not match the package schema`);
};

const CatalogEntries = Schema.Array(RuntimeCatalogEntry);
const Placements = Schema.Array(RuntimeObjectPlacement);
const AssetEntries = Schema.Array(RuntimeMapPackageAssetEntry);
const NamespacedSections = Schema.Record(Schema.String, JsonObject);

/**
 * Load + verify + decode a runtime map package through an injected reader.
 * Fails with a typed {@link RuntimeMapPackageInvalidError}:
 * - `schema` — missing/undecodable entries or manifest,
 * - `version` — the package was written by a different schema version,
 * - `integrity` — an entry's content hash does not match the manifest.
 *
 * Asset payloads (`assets/**`) are NOT read here; hosts stream them on demand
 * and can verify against `manifest.entryHashes` using
 * {@link hashRuntimeMapPackageEntry}.
 */
export const loadRuntimeMapPackage = async (
  readEntry: RuntimeMapPackageEntryReader,
): Promise<Result.Result<RuntimeMapPackage, RuntimeMapPackageInvalidError>> => {
  try {
    const manifestBytes = await readEntry(RUNTIME_MAP_PACKAGE_MANIFEST_FILE);
    if (manifestBytes === undefined) {
      return fail('schema', `package has no ${RUNTIME_MAP_PACKAGE_MANIFEST_FILE}`);
    }
    const manifestJson = parseJson(RUNTIME_MAP_PACKAGE_MANIFEST_FILE, manifestBytes);
    if (
      typeof manifestJson === 'object' &&
      manifestJson !== null &&
      'schemaVersion' in manifestJson &&
      typeof manifestJson.schemaVersion === 'number' &&
      Number.isSafeInteger(manifestJson.schemaVersion) &&
      manifestJson.schemaVersion !== RUNTIME_MAP_PACKAGE_SCHEMA_VERSION
    ) {
      return fail(
        'version',
        `package schema version ${String(manifestJson.schemaVersion)} is not the supported version ${RUNTIME_MAP_PACKAGE_SCHEMA_VERSION}`,
      );
    }
    const manifest = decodeEntry(
      RUNTIME_MAP_PACKAGE_MANIFEST_FILE,
      RuntimeMapPackageManifest,
      manifestJson,
    );

    const readVerified = async (entryName: RuntimeMapPackageEntryName): Promise<unknown> => {
      const fileName = RUNTIME_MAP_PACKAGE_ENTRY_FILES[entryName];
      const bytes = await readEntry(fileName);
      if (bytes === undefined) {
        return fail('schema', `package is missing entry ${fileName}`);
      }
      // Integrity is MANDATORY (M2 review, N2): every section entry the
      // loader reads must be pinned in the manifest — a missing hash is an
      // integrity failure, never a silent skip.
      const expected = manifest.entryHashes[entryName];
      if (expected === undefined) {
        return fail(
          'integrity',
          `manifest has no entry hash for ${fileName} — every package section must be hashed`,
        );
      }
      const actual = await hashRuntimeMapPackageEntry(bytes);
      if (actual !== expected) {
        return fail(
          'integrity',
          `entry ${fileName} hash ${actual} does not match manifest ${expected}`,
        );
      }
      return parseJson(fileName, bytes);
    };

    let map: RuntimeMapPackage['map'];
    const mapJson = await readVerified('map');
    try {
      map = decodePersistedTileborneMapJson(mapJson);
    } catch (error) {
      if (error instanceof LoadFailure) {
        throw error;
      }
      return fail('schema', `entry map.json is not a valid map: ${String(error)}`);
    }

    return Result.succeed(
      new RuntimeMapPackage({
        manifest,
        map,
        catalog: decodeEntry('catalog.json', CatalogEntries, await readVerified('catalog')),
        placements: decodeEntry('placements.json', Placements, await readVerified('placements')),
        settings: decodeEntry('settings.json', NamespacedSections, await readVerified('settings')),
        content: decodeEntry('content.json', JsonObject, await readVerified('content')),
        behaviors: decodeEntry(
          'behaviors.json',
          RuntimeBehaviorPackage,
          await readVerified('behaviors'),
        ),
        visuals: decodeEntry(
          'visuals.json',
          RuntimeMapPackageVisuals,
          await readVerified('visuals'),
        ),
        assets: decodeEntry('assets.json', AssetEntries, await readVerified('assets')),
        modeData: decodeEntry('mode-data.json', NamespacedSections, await readVerified('modeData')),
      }),
    );
  } catch (error) {
    if (error instanceof LoadFailure) {
      return Result.fail(error.error);
    }
    throw error;
  }
};
