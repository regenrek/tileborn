import { readdirSync, statSync, type Dirent } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(packageRoot, "..", "fixtures");

/** Top-level fixture categories shipped with `@tileborne/test-fixtures`. */
export const FIXTURE_CATEGORIES = ["maps", "asset-packs", "plugins", "projects"] as const;

export type FixtureCategory = (typeof FIXTURE_CATEGORIES)[number];

const normalizeRelative = (relativePath: string): string => {
  const normalized = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "");
  if (normalized.startsWith("..")) {
    throw new Error(`fixture path escapes fixtures root: ${relativePath}`);
  }
  return normalized;
};

/**
 * Resolve an absolute path to a bundled CC0 fixture.
 *
 * @param relativePath Path relative to `fixtures/`, e.g. `plugins/smoke-fixture`
 */
export const getFixturePath = (...segments: readonly string[]): string => {
  const relative = normalizeRelative(path.join(...segments));
  const absolute = path.join(fixturesRoot, relative);
  if (!absolute.startsWith(fixturesRoot)) {
    throw new Error(`fixture path escapes fixtures root: ${relativePathFromSegments(segments)}`);
  }
  return absolute;
};

const relativePathFromSegments = (segments: readonly string[]): string => path.join(...segments);

/**
 * List fixture entry names under a category directory.
 *
 * @param category One of `maps`, `asset-packs`, `plugins`, or `projects`
 */
export const listFixtures = (category: FixtureCategory): readonly string[] => {
  const directory = getFixturePath(category);
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry: Dirent) => entry.isDirectory())
    .map((entry: Dirent) => entry.name)
    .sort();
};

/** Returns true when the resolved fixture path exists on disk. */
export const fixtureExists = (...segments: readonly string[]): boolean => {
  try {
    const absolute = getFixturePath(...segments);
    return statSync(absolute).isDirectory() || statSync(absolute).isFile();
  } catch {
    return false;
  }
};

export const fixturesRootPath = (): string => fixturesRoot;

/** Bundled CC0 sample tileset used for editor first-launch seeding. */
export const SAMPLE_ASSET_PACK_ID = "pack:550e8400-e29b-41d4-a716-446655440099" as const;

/** Relative directory under `fixtures/asset-packs/`. */
export const SAMPLE_ASSET_PACK_DIR = "smoke-pack" as const;

/** Absolute path to the sample asset pack fixture root. */
export const getSampleAssetPackPath = (): string =>
  getFixturePath("asset-packs", SAMPLE_ASSET_PACK_DIR);
