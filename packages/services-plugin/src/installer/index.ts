import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { PluginId } from "@tileborne/core";
import { PluginManifest, validatePluginContributions } from "@tileborne/plugin-api";
import { HomeService, type HomeServiceError } from "@tileborne/services-foundation";

import { Context, Effect, Layer, Option, Schema } from "effect";

import {
  copyPluginDirectory,
  hashPluginDirectory,
  materializePluginManifestInput,
  pluginDirectoryName,
  rejectUnsafeSourcePath,
  removePath,
  replaceDirectory,
  runCommand,
  symlinkPluginDirectory,
  validatePluginDirectory,
  validatePluginManifestPaths,
  writeInstalledLock,
} from "../filesystem.js";
import { PluginRegistryService } from "../registry/index.js";
import {
  createPluginScaffold,
  packPluginDirectory,
  type PluginCreateResult,
  type PluginPackResult,
} from "../scaffold.js";
import {
  InstalledPlugin,
  LocalPluginSource,
  MAX_PLUGIN_BYTES,
  NpmPluginSource,
  PLUGIN_MANIFEST_FILE,
  PluginInstallError,
  PluginIntegrityError,
  type PluginInstallerError,
  PluginResolveError,
  type PluginSource,
  PluginValidationError,
} from "../model.js";
import type { PluginRegistryServiceError } from "../registry/index.js";

export class PluginInstallerService extends Context.Service<PluginInstallerService, {
  readonly install: (source: PluginSource) => Effect.Effect<InstalledPlugin, PluginInstallerServiceError>;
  readonly uninstall: (pluginId: PluginId) => Effect.Effect<void, PluginInstallerServiceError>;
  readonly update: (pluginId: PluginId, source: PluginSource) => Effect.Effect<InstalledPlugin, PluginInstallerServiceError>;
  readonly create: (name: string, template: string | undefined, cwd: string) => Effect.Effect<PluginCreateResult, PluginInstallerServiceError>;
  readonly pack: (sourcePath: string, outPath: string) => Effect.Effect<PluginPackResult, PluginInstallerServiceError>;
}>()("@tileborne/services-plugin/PluginInstallerService") {}

export type PluginInstallerServiceError =
  | PluginInstallerError
  | HomeServiceError
  | PluginRegistryServiceError;

interface StagedSource {
  readonly packagePath: string;
}

const toMessage = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);
const sourceLabel = (source: PluginSource): string => {
  switch (source._tag) {
    case "npm":
      return `npm:${source.packageName}`;
    case "local":
      return `${source._tag}:${source.path}`;
    case "dev-symlink":
      return `${source._tag}:${source.linkPath}`;
    case "tarball":
      return `${source._tag}:${source.url}`;
    case "git":
      return `${source._tag}:${source.repo}`;
  }
};

const commandOutput = (
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`${command} exited with ${code ?? "unknown"}: ${stderr}`));
      }
    });
  });

const validateArchiveEntries = (archivePath: string, stagingRoot: string): Effect.Effect<void, PluginValidationError> =>
  Effect.gen(function* () {
    const output = yield* Effect.tryPromise({
      try: () => commandOutput("tar", ["-tzf", archivePath], stagingRoot),
      catch: (cause) =>
        new PluginValidationError({ path: archivePath, message: toMessage(cause) }),
    });
    for (const entry of output.split("\n").filter(Boolean)) {
      if (path.isAbsolute(entry) || entry.split("/").includes("..")) {
        yield* new PluginValidationError({
          path: archivePath,
          message: `archive entry is outside plugin root: ${entry}`,
        });
      }
    }
  });

const extractArchive = (
  archivePath: string,
  packagePath: string,
  stagingRoot: string,
): Effect.Effect<void, PluginValidationError | PluginInstallError> =>
  Effect.gen(function* () {
    const stat = yield* Effect.tryPromise({
      try: () => lstat(archivePath),
      catch: (cause) =>
        new PluginValidationError({ path: archivePath, message: toMessage(cause) }),
    });
    if (stat.size > MAX_PLUGIN_BYTES) {
      yield* new PluginValidationError({
        path: archivePath,
        message: `plugin archive exceeds ${MAX_PLUGIN_BYTES} bytes`,
      });
    }
    yield* validateArchiveEntries(archivePath, stagingRoot);
    yield* Effect.tryPromise({
      try: () => mkdir(packagePath, { recursive: true }),
      catch: (cause) =>
        new PluginInstallError({ path: packagePath, message: toMessage(cause) }),
    });
    yield* Effect.tryPromise({
      try: () => runCommand("tar", ["-xzf", archivePath, "-C", packagePath, "--strip-components", "1"], stagingRoot),
      catch: (cause) =>
        new PluginInstallError({ path: packagePath, message: toMessage(cause) }),
    });
  });

const downloadToFile = (
  url: string,
  targetPath: string,
): Effect.Effect<void, PluginResolveError | PluginValidationError> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetch(url),
      catch: (cause) => new PluginResolveError({ source: url, message: toMessage(cause) }),
    });
    if (!response.ok) {
      yield* new PluginResolveError({ source: url, message: `HTTP ${response.status}` });
    }
    const bytes = new Uint8Array(yield* Effect.tryPromise({
      try: () => response.arrayBuffer(),
      catch: (cause) => new PluginResolveError({ source: url, message: toMessage(cause) }),
    }));
    if (bytes.byteLength > MAX_PLUGIN_BYTES) {
      yield* new PluginValidationError({
        path: targetPath,
        message: `plugin archive exceeds ${MAX_PLUGIN_BYTES} bytes`,
      });
    }
    yield* Effect.tryPromise({
      try: () => writeFile(targetPath, bytes),
      catch: (cause) => new PluginResolveError({ source: url, message: toMessage(cause) }),
    });
  });

const resolveNpmTarballUrl = (source: NpmPluginSource): Effect.Effect<string, PluginResolveError> =>
  Effect.gen(function* () {
    const registryUrl = `https://registry.npmjs.org/${encodeURIComponent(source.packageName)}`;
    const response = yield* Effect.tryPromise({
      try: () => fetch(registryUrl),
      catch: (cause) => new PluginResolveError({ source: registryUrl, message: toMessage(cause) }),
    });
    if (!response.ok) {
      yield* new PluginResolveError({ source: registryUrl, message: `HTTP ${response.status}` });
    }
    const metadata = yield* Effect.tryPromise({
      try: () => response.json() as Promise<{
        readonly versions?: Readonly<Record<string, { readonly dist?: { readonly tarball?: string } }>>;
        readonly "dist-tags"?: { readonly latest?: string };
      }>,
      catch: (cause) => new PluginResolveError({ source: registryUrl, message: toMessage(cause) }),
    });
    const version = Option.getOrUndefined(source.version) ?? metadata["dist-tags"]?.latest;
    if (!version) {
      yield* new PluginResolveError({ source: registryUrl, message: "npm package has no resolvable version" });
    }
    const resolvedVersion = version as string;
    const tarball = metadata.versions?.[resolvedVersion]?.dist?.tarball;
    if (!tarball) {
      yield* new PluginResolveError({ source: registryUrl, message: `npm package has no tarball for ${resolvedVersion}` });
    }
    return tarball as string;
  });

const stageSource = (
  source: PluginSource,
  stagingRoot: string,
): Effect.Effect<StagedSource, PluginInstallerServiceError> =>
  Effect.gen(function* () {
    const packagePath = path.join(stagingRoot, "package");
    switch (source._tag) {
      case "local": {
        const sourceError = rejectUnsafeSourcePath(source.path);
        if (sourceError) {
          yield* sourceError;
        }
        const stat = yield* Effect.tryPromise({
          try: () => lstat(source.path),
          catch: (cause) =>
            new PluginResolveError({ source: sourceLabel(source), message: toMessage(cause) }),
        });
        if (stat.isDirectory()) {
          yield* Effect.tryPromise({
            try: () => copyPluginDirectory(source.path, packagePath),
            catch: (cause) => new PluginInstallError({ path: packagePath, message: toMessage(cause) }),
          });
          return { packagePath };
        }
        yield* extractArchive(source.path, packagePath, stagingRoot);
        return { packagePath };
      }
      case "dev-symlink": {
        const sourceError = rejectUnsafeSourcePath(source.linkPath);
        if (sourceError) {
          yield* sourceError;
        }
        yield* Effect.tryPromise({
          try: () => symlinkPluginDirectory(source.linkPath, packagePath),
          catch: (cause) => new PluginInstallError({ path: packagePath, message: toMessage(cause) }),
        });
        return { packagePath };
      }
      case "git": {
        yield* Effect.tryPromise({
          try: () => runCommand("git", ["clone", "--depth", "1", source.repo, packagePath], stagingRoot),
          catch: (cause) => new PluginResolveError({ source: source.repo, message: toMessage(cause) }),
        });
        const ref = Option.getOrUndefined(source.ref);
        if (ref) {
          yield* Effect.tryPromise({
            try: () => runCommand("git", ["checkout", ref], packagePath),
            catch: (cause) => new PluginResolveError({ source: source.repo, message: toMessage(cause) }),
          });
        }
        yield* Effect.tryPromise({
          try: () => rm(path.join(packagePath, ".git"), { recursive: true, force: true }),
          catch: (cause) => new PluginInstallError({ path: packagePath, message: toMessage(cause) }),
        });
        yield* Effect.tryPromise({
          try: () => validatePluginDirectory(packagePath),
          catch: (cause) =>
            cause instanceof PluginValidationError
              ? cause
              : new PluginValidationError({ path: packagePath, message: toMessage(cause) }),
        });
        return { packagePath };
      }
      case "tarball": {
        const archivePath = path.join(stagingRoot, "source.tgz");
        const resolvedUrl = path.isAbsolute(source.url) || source.url.startsWith("file:")
          ? path.resolve(source.url.replace(/^file:\/\//, ""))
          : source.url;
        if (path.isAbsolute(resolvedUrl) || resolvedUrl.startsWith("/") || /^[A-Za-z]:[\\/]/.test(resolvedUrl)) {
          yield* Effect.tryPromise({
            try: async () => {
              const bytes = await readFile(resolvedUrl);
              await writeFile(archivePath, bytes);
            },
            catch: (cause) => new PluginResolveError({ source: sourceLabel(source), message: toMessage(cause) }),
          });
        } else {
          yield* downloadToFile(source.url, archivePath);
        }
        const expectedIntegrity = Option.getOrUndefined(source.integrity);
        if (expectedIntegrity) {
          const actual = yield* Effect.tryPromise({
            try: async () => `sha256:${createHash("sha256").update(await readFile(archivePath)).digest("hex")}`,
            catch: (cause) => new PluginIntegrityError({ path: archivePath, message: toMessage(cause) }),
          });
          if (actual !== expectedIntegrity) {
            yield* new PluginIntegrityError({
              path: archivePath,
              expectedHash: expectedIntegrity as never,
              actualHash: actual as never,
              message: `tarball integrity mismatch: expected ${expectedIntegrity} got ${actual}`,
            });
          }
        }
        yield* extractArchive(archivePath, packagePath, stagingRoot);
        return { packagePath };
      }
      case "npm": {
        const tarballUrl = yield* resolveNpmTarballUrl(source);
        return yield* stageSource(new LocalPluginSource({
          path: yield* Effect.gen(function* () {
            const archivePath = path.join(stagingRoot, "source.tgz");
            yield* downloadToFile(tarballUrl, archivePath);
            return archivePath;
          }),
        }), stagingRoot);
      }
    }
  });

const validateManifest = (
  packagePath: string,
): Effect.Effect<PluginManifest, PluginValidationError> =>
  Effect.gen(function* () {
    const manifestPath = path.join(packagePath, PLUGIN_MANIFEST_FILE);
    const raw = yield* Effect.tryPromise({
      try: async () =>
        materializePluginManifestInput(
          JSON.parse(await import("node:fs/promises").then(({ readFile }) => readFile(manifestPath, "utf8"))) as unknown,
        ),
      catch: (cause) =>
        new PluginValidationError({ path: manifestPath, message: toMessage(cause) }),
    });
    const manifest = yield* Effect.try({
      try: () => Schema.decodeUnknownSync(PluginManifest)(raw),
      catch: (cause) =>
        new PluginValidationError({ path: manifestPath, message: toMessage(cause) }),
    });
    yield* Effect.try({
      try: () => validatePluginContributions(manifest.id, manifest.contributes),
      catch: (cause) =>
        cause instanceof PluginValidationError
          ? cause
          : new PluginValidationError({ path: manifestPath, message: toMessage(cause) }),
    });
    yield* Effect.try({
      try: () => validatePluginManifestPaths(packagePath, Schema.encodeSync(PluginManifest)(manifest)),
      catch: (cause) =>
        cause instanceof PluginValidationError
          ? cause
          : new PluginValidationError({ path: manifestPath, message: toMessage(cause) }),
    });
    return manifest;
  });

const removeInstalledById = (
  pluginsPath: string,
  pluginId: PluginId,
): Effect.Effect<void, PluginInstallError> =>
  Effect.gen(function* () {
    const entries = yield* Effect.tryPromise({
      try: async () => {
        try {
          return await import("node:fs/promises").then(({ readdir }) => readdir(pluginsPath));
        } catch (cause) {
          if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT") {
            return [];
          }
          throw cause;
        }
      },
      catch: (cause) => new PluginInstallError({ path: pluginsPath, message: toMessage(cause) }),
    });
    const encodedPrefix = `${encodeURIComponent(pluginId)}-`;
    yield* Effect.forEach(
      entries.filter((entry) => entry.startsWith(encodedPrefix)),
      (entry) =>
        Effect.tryPromise({
          try: () => removePath(path.join(pluginsPath, entry)),
          catch: (cause) => new PluginInstallError({ path: path.join(pluginsPath, entry), message: toMessage(cause) }),
        }),
      { discard: true },
    );
  });

export const PluginInstallerServiceLive = Layer.effect(
  PluginInstallerService,
  Effect.gen(function* () {
    const home = yield* HomeService;
    const registry = yield* PluginRegistryService;
    const paths = yield* home.init();
    const stagingRoot = path.join(paths.cache, "plugins", "staging");

    const install = Effect.fn("PluginInstallerService.install")(function* (source: PluginSource) {
      const stagingPath = path.join(stagingRoot, randomUUID());
      yield* Effect.tryPromise({
        try: () => mkdir(stagingPath, { recursive: true }),
        catch: (cause) => new PluginInstallError({ path: stagingPath, message: toMessage(cause) }),
      });

      const installed = yield* Effect.gen(function* () {
        const staged = yield* stageSource(source, stagingPath);
        yield* Effect.tryPromise({
          try: () => validatePluginDirectory(staged.packagePath),
          catch: (cause) =>
            cause instanceof PluginValidationError
              ? cause
              : new PluginValidationError({ path: staged.packagePath, message: toMessage(cause) }),
        });
        const manifest = yield* validateManifest(staged.packagePath);
        const integrity = yield* Effect.tryPromise({
          try: () => hashPluginDirectory(staged.packagePath),
          catch: (cause) => new PluginIntegrityError({ path: staged.packagePath, message: toMessage(cause) }),
        });
        const finalPath = path.join(paths.plugins, pluginDirectoryName(manifest.id, manifest.version));
        const plugin = new InstalledPlugin({
          id: manifest.id,
          version: manifest.version,
          enabled: true,
          rootPath: finalPath,
          manifestPath: path.join(finalPath, PLUGIN_MANIFEST_FILE),
          manifest,
          integrity,
        });
        yield* Effect.tryPromise({
          try: () => writeInstalledLock(new InstalledPlugin({ ...plugin, rootPath: staged.packagePath, manifestPath: path.join(staged.packagePath, PLUGIN_MANIFEST_FILE) })),
          catch: (cause) => new PluginInstallError({ path: staged.packagePath, message: toMessage(cause) }),
        });
        yield* removeInstalledById(paths.plugins, manifest.id);
        yield* Effect.tryPromise({
          try: () => mkdir(paths.plugins, { recursive: true }),
          catch: (cause) => new PluginInstallError({ path: paths.plugins, message: toMessage(cause) }),
        });
        yield* Effect.tryPromise({
          try: () => replaceDirectory(staged.packagePath, finalPath),
          catch: (cause) => new PluginInstallError({ path: finalPath, message: toMessage(cause) }),
        });
        yield* registry.discover();
        return plugin;
      }).pipe(
        Effect.ensuring(Effect.promise(() => removePath(stagingPath))),
      );
      return installed;
    });

    const uninstall = Effect.fn("PluginInstallerService.uninstall")(function* (pluginId: PluginId) {
      yield* removeInstalledById(paths.plugins, pluginId);
      yield* registry.discover();
    });

    const update = Effect.fn("PluginInstallerService.update")(function* (pluginId: PluginId, source: PluginSource) {
      yield* uninstall(pluginId);
      return yield* install(source);
    });

    const create = Effect.fn("PluginInstallerService.create")(function* (
      name: string,
      template: string | undefined,
      cwd: string,
    ) {
      return yield* createPluginScaffold(cwd, name, template);
    });

    const pack = Effect.fn("PluginInstallerService.pack")(function* (sourcePath: string, outPath: string) {
      return yield* packPluginDirectory(sourcePath, outPath);
    });

    return { install, uninstall, update, create, pack };
  }),
);
