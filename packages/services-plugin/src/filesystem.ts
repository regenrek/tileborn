import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, cp, lstat, readdir, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  AssetPathSecurityError,
  assertWithinRoot,
  rejectPathTraversal,
  rejectSymlinkEscape,
} from "@tileborne/asset-pipeline";
import { ContentHash, hashBytes } from "@tileborne/core";
import { Schema } from "effect";

import {
  MAX_PLUGIN_BYTES,
  MAX_PLUGIN_FILES,
  PLUGIN_LOCK_FILE,
  PLUGIN_MANIFEST_FILE,
  PLUGIN_SEED_FINGERPRINT_FILE,
  PluginInstallError,
  PluginIntegrityError,
  PluginValidationError,
  InstalledPlugin,
} from "./model.js";

export const pluginDirectoryName = (pluginId: string, version: string): string =>
  `${encodeURIComponent(pluginId)}-${version}`;

export const rejectUnsafeSourcePath = (
  sourcePath: string,
): PluginValidationError | undefined => {
  if (!path.isAbsolute(sourcePath)) {
    return new PluginValidationError({
      path: sourcePath,
      message: "plugin source path must be absolute",
    });
  }
  if (sourcePath.split(path.sep).includes("..")) {
    return new PluginValidationError({
      path: sourcePath,
      message: "plugin source path must not contain traversal segments",
    });
  }
  return undefined;
};

export const validateRelativePluginPath = (rootPath: string, candidatePath: string): string => {
  const normalized = candidatePath.replaceAll(path.win32.sep, path.posix.sep);
  const rawSegments = normalized.split(path.posix.sep);

  if (path.posix.isAbsolute(normalized) || rawSegments.includes("..")) {
    throw new PluginValidationError({
      path: candidatePath,
      message: "plugin manifest path must stay inside the plugin root",
    });
  }

  try {
    return rejectPathTraversal(rootPath, candidatePath);
  } catch (cause) {
    if (cause instanceof AssetPathSecurityError) {
      throw new PluginValidationError({ path: candidatePath, message: cause.message });
    }
    throw cause;
  }
};

export const resolvePluginManifestPath = async (
  rootPath: string,
  candidatePath: string,
): Promise<string> => {
  const resolved = validateRelativePluginPath(rootPath, candidatePath);
  try {
    return await rejectSymlinkEscape(rootPath, resolved);
  } catch (cause) {
    if (cause instanceof AssetPathSecurityError) {
      throw new PluginValidationError({ path: candidatePath, message: cause.message });
    }
    throw cause;
  }
};

const collectManifestPaths = (value: unknown, key?: string): readonly string[] => {
  if (typeof value === "string") {
    return key === "path" || key === "entry" ? [value] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectManifestPaths(entry));
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([entryKey, entryValue]) => {
      if (entryKey === "entry" && typeof entryValue === "object" && entryValue !== null) {
        return Object.values(entryValue).flatMap((nestedValue) =>
          typeof nestedValue === "string" ? [nestedValue] : collectManifestPaths(nestedValue),
        );
      }
      return collectManifestPaths(entryValue, entryKey);
    });
  }
  return [];
};

export const validatePluginManifestPaths = (rootPath: string, manifest: unknown): void => {
  for (const candidatePath of collectManifestPaths(manifest)) {
    validateRelativePluginPath(rootPath, candidatePath);
  }
};

const toMessage = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

export const readManifestJson = async (rootPath: string): Promise<unknown> => {
  const manifestPath = path.join(rootPath, PLUGIN_MANIFEST_FILE);
  const raw = await readFile(manifestPath, "utf8");
  return materializePluginManifestInput(JSON.parse(raw) as unknown);
};

const optionalContributionKeys = {
  contributes: ["panels", "tools", "assetPacks", "tilesetPacks", "editor", "runtime", "server"],
  entry: ["editor", "runtime", "server"],
  editor: [
    "tabs",
    "tools",
    "inspectors",
    "commands",
    "menus",
    "settings",
    "paletteCategories",
    "paletteSubFilters",
    "paletteItemActions",
    "viewportActions",
    "toolDock",
    "overlays",
    "inspectorPanels",
    "settingsPanels",
    "mapKinds",
    "presets",
    "panels",
    "validators",
    "exporters",
    "generators",
    "assetMetadata",
    "playerModelPolicies",
    "gameSettingsForms",
  ],
  runtime: [
    "systems",
    "components",
    "events",
    "assetLoaders",
    "clientSystems",
    "hudWidgets",
    "lobbyPanels",
    "menuSections",
    "inputMaps",
    "audioBuses",
    "cameras",
    "interpolators",
    "assetPacks",
    "errorMappers",
    "gameObjectCatalogs",
    "weaponCatalogs",
  ],
  server: [
    "rules",
    "scoring",
    "lootTables",
    "matchmaking",
    "serverSystems",
    "roomRules",
    "mapValidators",
    "matchPhases",
    "replayWriters",
  ],
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const withUndefinedKeys = (value: unknown, keys: readonly string[]): unknown => {
  if (!isRecord(value)) {
    return value;
  }
  const next: Record<string, unknown> = { ...value };
  for (const key of keys) {
    if (!(key in next)) {
      next[key] = undefined;
    }
  }
  return next;
};

const materializeContributionDisplay = (value: unknown): unknown =>
  withUndefinedKeys(value, ["description", "icon", "order"]);

const materializeContributionEntry = (value: unknown): unknown => {
  if (!isRecord(value)) {
    return value;
  }
  const next: Record<string, unknown> = { ...value };
  if ("display" in next) {
    next.display = materializeContributionDisplay(next.display);
  }
  return withUndefinedKeys(next, ["display"]);
};

const materializeSidebarPanelContributionEntry = (value: unknown): unknown =>
  withUndefinedKeys(value, ["description", "group", "order", "capabilities", "data"]);

const materializeSidebarToolContributionEntry = (value: unknown): unknown =>
  withUndefinedKeys(value, ["description", "group", "order", "commandId", "capabilities", "data"]);

const materializeContributionList = (value: unknown): unknown => {
  if (!Array.isArray(value)) {
    return value;
  }
  return value.map(materializeContributionEntry);
};

const materializeContributionBucket = (value: unknown, keys: readonly string[]): unknown => {
  const bucket = withUndefinedKeys(value, keys);
  if (!isRecord(bucket)) {
    return bucket;
  }
  const next: Record<string, unknown> = { ...bucket };
  for (const key of keys) {
    if (Array.isArray(next[key])) {
      next[key] = materializeContributionList(next[key]);
    }
  }
  return next;
};

export const materializePluginManifestInput = (input: unknown): unknown => {
  if (!isRecord(input)) {
    return input;
  }
  const manifest = withUndefinedKeys(input, ["repository", "homepage", "entry", "migrations"]) as Record<string, unknown>;
  manifest["contributes"] = withUndefinedKeys(manifest["contributes"], optionalContributionKeys.contributes);
  manifest["entry"] = withUndefinedKeys(manifest["entry"], optionalContributionKeys.entry);
  if (isRecord(manifest["contributes"])) {
    if (Array.isArray(manifest["contributes"]["panels"])) {
      manifest["contributes"]["panels"] = manifest["contributes"]["panels"].map(
        materializeSidebarPanelContributionEntry,
      );
    }
    if (Array.isArray(manifest["contributes"]["tools"])) {
      manifest["contributes"]["tools"] = manifest["contributes"]["tools"].map(
        materializeSidebarToolContributionEntry,
      );
    }
    manifest["contributes"]["editor"] = materializeContributionBucket(
      manifest["contributes"]["editor"],
      optionalContributionKeys.editor,
    );
    manifest["contributes"]["runtime"] = materializeContributionBucket(
      manifest["contributes"]["runtime"],
      optionalContributionKeys.runtime,
    );
    manifest["contributes"]["server"] = materializeContributionBucket(
      manifest["contributes"]["server"],
      optionalContributionKeys.server,
    );
  }
  return manifest;
};

export const readInstalledLock = async (rootPath: string): Promise<ContentHash> => {
  const lockPath = path.join(rootPath, PLUGIN_LOCK_FILE);
  const parsed = JSON.parse(await readFile(lockPath, "utf8")) as { readonly integrity?: unknown };
  if (typeof parsed.integrity !== "string") {
    throw new Error("plugin lock is missing integrity");
  }
  return Schema.decodeUnknownSync(ContentHash)(parsed.integrity);
};

export interface DirectoryValidation {
  readonly fileCount: number;
  readonly totalBytes: number;
}

export const validatePluginDirectory = async (rootPath: string): Promise<DirectoryValidation> => {
  let fileCount = 0;
  let totalBytes = 0;

  const visit = async (current: string): Promise<void> => {
    const stat = await lstat(current);
    const relative = path.relative(rootPath, current);
    try {
      assertWithinRoot(rootPath, current);
      rejectPathTraversal(rootPath, relative || ".");
      await rejectSymlinkEscape(rootPath, current);
    } catch (cause) {
      if (cause instanceof AssetPathSecurityError) {
        throw new PluginValidationError({
          path: current,
          message: cause.message,
        });
      }
      throw cause;
    }
    if (path.isAbsolute(relative)) {
      throw new PluginValidationError({
        path: current,
        message: "plugin source contains path traversal",
      });
    }
    if (stat.isDirectory()) {
      for (const entry of await readdir(current)) {
        await visit(path.join(current, entry));
      }
      return;
    }
    if (stat.isSymbolicLink()) {
      return;
    }
    if (!stat.isFile()) {
      throw new PluginValidationError({
        path: current,
        message: "plugin source contains an unsupported filesystem entry",
      });
    }
    fileCount += 1;
    totalBytes += stat.size;
    if (fileCount > MAX_PLUGIN_FILES) {
      throw new PluginValidationError({
        path: rootPath,
        message: `plugin source exceeds ${MAX_PLUGIN_FILES} files`,
      });
    }
    if (totalBytes > MAX_PLUGIN_BYTES) {
      throw new PluginValidationError({
        path: rootPath,
        message: `plugin source exceeds ${MAX_PLUGIN_BYTES} bytes`,
      });
    }
  };

  await visit(rootPath);
  return { fileCount, totalBytes };
};

export const hashPluginDirectory = async (rootPath: string): Promise<ContentHash> => {
  const hash = createHash("sha256");

  const visit = async (current: string): Promise<void> => {
    const stat = await lstat(current);
    const relative = path.relative(rootPath, current).split(path.sep).join("/");
    if (relative === PLUGIN_LOCK_FILE || relative === PLUGIN_SEED_FINGERPRINT_FILE) {
      return;
    }
    if (stat.isDirectory()) {
      const entries = (await readdir(current)).sort();
      for (const entry of entries) {
        await visit(path.join(current, entry));
      }
      return;
    }
    if (stat.isSymbolicLink()) {
      hash.update(`symlink:${relative}\0${await realpath(current)}\0`);
      return;
    }
    if (stat.isFile()) {
      hash.update(`file:${relative}\0`);
      hash.update(await readFile(current));
      hash.update("\0");
    }
  };

  await visit(rootPath);
  return `sha256:${hash.digest("hex")}` as ContentHash;
};

export const hashFile = async (filePath: string): Promise<ContentHash> => hashBytes(await readFile(filePath));

const rewriteDistPrefixedPath = (value: string): string =>
  value.startsWith("./dist/") ? `./${value.slice("./dist/".length)}` : value;

const rewriteManifestPathStrings = (value: unknown): unknown => {
  if (typeof value === "string") {
    return rewriteDistPrefixedPath(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => rewriteManifestPathStrings(entry));
  }
  if (isRecord(value)) {
    const next: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value)) {
      next[key] = rewriteManifestPathStrings(entryValue);
    }
    return next;
  }
  return value;
};

const hasPackedPluginArtifacts = async (rootPath: string): Promise<boolean> => {
  try {
    await access(path.join(rootPath, PLUGIN_MANIFEST_FILE));
    await access(path.join(rootPath, "runtime.js"));
    return true;
  } catch {
    return false;
  }
};

const rootManifestUsesDistEntries = async (rootPath: string): Promise<boolean> => {
  try {
    const raw = JSON.parse(await readFile(path.join(rootPath, PLUGIN_MANIFEST_FILE), "utf8")) as {
      readonly entry?: Record<string, string>;
    };
    return Object.values(raw.entry ?? {}).some((entry) => entry.startsWith("./dist/"));
  } catch {
    return false;
  }
};

export const resolveLocalPluginInstallRoot = async (sourcePath: string): Promise<string> => {
  const resolved = path.resolve(sourcePath);
  const packedRoot = path.join(resolved, "dist");
  if (await hasPackedPluginArtifacts(packedRoot)) {
    if (resolved !== packedRoot || (await rootManifestUsesDistEntries(resolved))) {
      return packedRoot;
    }
  }
  return resolved;
};

export const rewritePackedManifestEntryPaths = async (packagePath: string): Promise<void> => {
  const manifestPath = path.join(packagePath, PLUGIN_MANIFEST_FILE);
  const raw = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  const rewritten = rewriteManifestPathStrings(raw);
  await writeFile(manifestPath, `${JSON.stringify(rewritten, null, 2)}\n`, "utf8");
};

export const copyPluginDirectory = async (sourcePath: string, targetPath: string): Promise<void> => {
  const installRoot = await resolveLocalPluginInstallRoot(sourcePath);
  await cp(installRoot, targetPath, {
    recursive: true,
    errorOnExist: true,
    force: false,
    verbatimSymlinks: true,
    filter: (entry) => {
      const relative = path.relative(installRoot, entry);
      if (!relative || relative === ".") {
        return true;
      }
      const segments = relative.split(path.sep);
      return !segments.some((segment) => segment === "node_modules" || segment === ".git");
    },
  });
  if (installRoot.endsWith(`${path.sep}dist`)) {
    await rewritePackedManifestEntryPaths(targetPath);
  }
};

export const symlinkPluginDirectory = async (sourcePath: string, targetPath: string): Promise<void> => {
  await symlink(sourcePath, targetPath, "dir");
};

export const removePath = async (targetPath: string): Promise<void> => {
  await rm(targetPath, { recursive: true, force: true });
};

const isNotFound = (cause: unknown): boolean =>
  typeof cause === "object" &&
  cause !== null &&
  "code" in cause &&
  (cause as { readonly code?: unknown }).code === "ENOENT";

export const replaceDirectory = async (sourcePath: string, targetPath: string): Promise<void> => {
  try {
    await rm(targetPath, { recursive: true, force: true });
  } catch (cause) {
    if (!isNotFound(cause)) {
      throw cause;
    }
  }
  try {
    await rename(sourcePath, targetPath);
  } catch (cause) {
    const code =
      typeof cause === "object" && cause !== null && "code" in cause
        ? (cause as { readonly code?: unknown }).code
        : undefined;
    if (code === "ENOTEMPTY" || code === "EEXIST") {
      await rm(targetPath, { recursive: true, force: true });
      await rename(sourcePath, targetPath);
      return;
    }
    throw cause;
  }
};

export const runCommand = (
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, stdio: "ignore" });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with ${code ?? "unknown"}`));
      }
    });
  });

export const mapInstallError = (pathValue: string, cause: unknown): PluginInstallError =>
  new PluginInstallError({ path: pathValue, message: toMessage(cause) });

export const mapValidationError = (pathValue: string, cause: unknown): PluginValidationError =>
  cause instanceof PluginValidationError
    ? cause
    : new PluginValidationError({ path: pathValue, message: toMessage(cause) });

export const mapIntegrityError = (pathValue: string, cause: unknown): PluginIntegrityError =>
  new PluginIntegrityError({ path: pathValue, message: toMessage(cause) });

export const writeInstalledLock = async (plugin: InstalledPlugin): Promise<void> => {
  const encoded = Schema.encodeSync(InstalledPlugin)(plugin);
  await writeFile(
    path.join(plugin.rootPath, PLUGIN_LOCK_FILE),
    `${JSON.stringify({
      schemaVersion: 1,
      pluginId: encoded.id,
      version: encoded.version,
      integrity: encoded.integrity,
    }, null, 2)}\n`,
    "utf8",
  );
};
