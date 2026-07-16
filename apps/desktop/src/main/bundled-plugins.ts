import { accessSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Generic bundled-plugin discovery + path resolution (replaces the former
 * battle-royale-specific `battle-royale-path.ts`).
 *
 * The desktop app ships a SET of bundled example plugins (Battle Royale + the
 * example arena). The boot auto-seed (`seed-plugins.ts`) and the manual bundled
 * install IPC resolve each from this single list, so there is no per-plugin
 * hardcoded path/id path: adding another bundled genre = one more
 * {@link BundledPluginSpec} entry here, not a new resolver. Battle Royale stays
 * present only as ONE entry in this generic list.
 */

const manifestFileName = "tileborne-plugin.json";
const bundledPluginsDirectoryName = "bundled-plugins";

/** A single bundled example plugin: its id + how to locate it in dev/packaged. */
export interface BundledPluginSpec {
  /** Canonical plugin id (matches the plugin manifest `id`). */
  readonly id: string;
  /** Directory name under `resources/bundled-plugins/` in a packaged app. */
  readonly bundledDirName: string;
  /** Workspace package directory under `packages/` for dev resolution. */
  readonly workspacePackageDir: string;
}

/** Battle Royale plugin id — retained ONLY as one entry of the generic list. */
export const BATTLE_ROYALE_PLUGIN_ID = "@tileborne-plugins/battle-royale";

/**
 * The bundled example plugins the desktop app seeds + can install. Order is the
 * auto-seed order. A new bundled genre slots in here with zero other edits.
 */
export const BUNDLED_PLUGINS: readonly BundledPluginSpec[] = [
  {
    id: BATTLE_ROYALE_PLUGIN_ID,
    bundledDirName: "battle-royale",
    workspacePackageDir: "plugin-battle-royale",
  },
  {
    id: "@tileborne-plugins/example-arena",
    bundledDirName: "example-arena",
    workspacePackageDir: "plugin-example-arena",
  },
];

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const electronResourcesPath = (process as NodeJS.Process & { readonly resourcesPath?: string })
  .resourcesPath;
const resourcesPath =
  typeof electronResourcesPath === "string" && electronResourcesPath.length > 0
    ? electronResourcesPath
    : moduleDir;
const workspacePackagesRoot = path.resolve(moduleDir, "../../../../packages");

/** The packaged (resources/bundled-plugins/<dir>) root for a bundled plugin. */
export const packagedBundledPluginRoot = (spec: BundledPluginSpec): string =>
  path.resolve(resourcesPath, bundledPluginsDirectoryName, spec.bundledDirName);

/** The workspace (packages/<dir>) root for a bundled plugin, used in dev. */
export const workspaceBundledPluginRoot = (spec: BundledPluginSpec): string =>
  path.resolve(workspacePackagesRoot, spec.workspacePackageDir);

const hasPluginManifest = (directory: string): boolean => {
  try {
    accessSync(path.join(directory, manifestFileName));
    return true;
  } catch {
    return false;
  }
};

/**
 * Resolve the on-disk root for a bundled plugin: prefer the packaged copy, fall
 * back to the workspace package in dev. Throws when neither carries a manifest
 * (the plugin package must be built before desktop packaging).
 */
export const resolveBundledPluginPath = (spec: BundledPluginSpec): string => {
  const bundled = packagedBundledPluginRoot(spec);
  if (hasPluginManifest(bundled)) {
    return bundled;
  }
  const resolved = workspaceBundledPluginRoot(spec);
  if (!hasPluginManifest(resolved)) {
    throw new Error(
      `Bundled plugin ${spec.id} not found. Checked packaged plugin ${bundled} and workspace plugin ${resolved}. Build the plugin package before desktop packaging.`,
    );
  }
  return resolved;
};

/** Look up a bundled plugin spec by id (e.g. for the BR-named install IPC). */
export const bundledPluginSpec = (id: string): BundledPluginSpec | undefined =>
  BUNDLED_PLUGINS.find((spec) => spec.id === id);

/** Product-specific install adapter; neutral IPC orchestration does not own its concrete id. */
export const bundledBattleRoyalePluginSpec = (): BundledPluginSpec | undefined =>
  bundledPluginSpec(BATTLE_ROYALE_PLUGIN_ID);
