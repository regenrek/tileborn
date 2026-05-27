import path from "node:path";
import { readFile } from "node:fs/promises";
import { Effect } from "effect";

import { PluginId } from "@tileborne/core";
import {
  PluginInstallerService,
  PluginRegistryService,
  PluginVerifyResult,
} from "@tileborne/services-plugin";

import { parseNpmPluginSpec, resolvePluginInstallSource } from "../../lib/plugin-source.js";
import { runCliCommand } from "../../lib/run-command.js";
import { runCliEffect } from "../../services-layer.js";
import { mapErrorToExitCode } from "../../render/errors.js";
import { renderFailure, renderSuccess, setVerboseLevel } from "../../render/output.js";
import { ExitCode } from "../../render/exit-codes.js";
import {
  globalArgs,
  readGlobalCliArgs,
  readStringArg,
  renderContextFromArgs,
  type CliRunContext,
} from "../shared.js";

const pluginIdArg = (context: CliRunContext): PluginId => {
  const id = readStringArg(context.args, "id");
  if (!id) {
    throw new Error("plugin id is required");
  }
  return id as PluginId;
};

const toVerifyItem = (result: PluginVerifyResult) => ({
  id: result.pluginId,
  ok: result.ok,
  integrity: result.integrity,
  message: result.message,
});

export const pluginCommand = {
  meta: {
    name: "plugin",
    description: "Install and manage Tileborne plugins",
  },
  subCommands: {
    install: {
      meta: { name: "install", description: "Install a plugin from a source" },
      args: {
        ...globalArgs,
        spec: { type: "positional" as const, description: "npm-like plugin spec", required: false },
        local: { type: "string" as const, description: "Install from a local directory or archive", required: false },
        tarball: { type: "string" as const, description: "Install from a tarball path or URL", required: false },
        integrity: { type: "string" as const, description: "Expected sha256 integrity for tarball", required: false },
        git: { type: "string" as const, description: "Install from a git repository URL", required: false },
        ref: { type: "string" as const, description: "Git ref (branch, tag, or commit)", required: false },
        "dev-symlink": { type: "string" as const, description: "Install via dev symlink", required: false },
      },
      async run(context: CliRunContext) {
        await runCliCommand(
          context,
          Effect.gen(function* () {
            const installer = yield* PluginInstallerService;
            const source = resolvePluginInstallSource({
              spec: readStringArg(context.args, "spec"),
              local: readStringArg(context.args, "local"),
              tarball: readStringArg(context.args, "tarball"),
              integrity: readStringArg(context.args, "integrity"),
              git: readStringArg(context.args, "git"),
              ref: readStringArg(context.args, "ref"),
              devSymlink: readStringArg(context.args, "dev-symlink"),
            });
            const installed = yield* installer.install(source);
            return {
              id: installed.id,
              version: installed.version,
              path: installed.rootPath,
              integrity: installed.integrity,
            };
          }),
        );
      },
    },
    list: {
      meta: { name: "list", description: "List installed plugins" },
      args: globalArgs,
      async run(context: CliRunContext) {
        await runCliCommand(
          context,
          Effect.gen(function* () {
            const registry = yield* PluginRegistryService;
            const results = yield* registry.verify();
            return {
              plugins: results.map((entry) => ({
                id: entry.pluginId,
                version: entry.version,
                enabled: entry.enabled ?? true,
                integrityOk: entry.ok,
                integrity: entry.integrity,
                message: entry.message,
              })),
            };
          }),
        );
      },
    },
    info: {
      meta: { name: "info", description: "Show plugin manifest and metadata" },
      args: {
        ...globalArgs,
        id: { type: "positional" as const, description: "Plugin id", required: true },
      },
      async run(context: CliRunContext) {
        await runCliCommand(
          context,
          Effect.gen(function* () {
            const registry = yield* PluginRegistryService;
            const pluginId = pluginIdArg(context);
            const [verified] = yield* registry.verify(pluginId);
            if (!verified?.ok) {
              return yield* Effect.fail(new Error(verified?.message ?? `plugin not found: ${pluginId}`));
            }
            const plugins = yield* registry.list();
            const plugin = plugins.find((entry) => entry.id === pluginId);
            if (!plugin) {
              return yield* Effect.fail(new Error(`plugin not found: ${pluginId}`));
            }
            return {
              id: plugin.id,
              version: plugin.version,
              enabled: plugin.enabled,
              integrityOk: verified.ok,
              integrity: plugin.integrity,
              manifest: plugin.manifest,
              contributions: plugin.manifest.contributes,
              permissions: plugin.manifest.permissions,
            };
          }),
        );
      },
    },
    remove: {
      meta: { name: "remove", description: "Uninstall a plugin" },
      args: {
        ...globalArgs,
        id: { type: "positional" as const, description: "Plugin id", required: true },
      },
      async run(context: CliRunContext) {
        await runCliCommand(
          context,
          Effect.gen(function* () {
            const installer = yield* PluginInstallerService;
            const pluginId = pluginIdArg(context);
            yield* installer.uninstall(pluginId);
            return { removed: pluginId };
          }),
        );
      },
    },
    update: {
      meta: { name: "update", description: "Update an installed plugin" },
      args: {
        ...globalArgs,
        id: { type: "positional" as const, description: "Plugin id", required: true },
        to: { type: "string" as const, description: "Target version", required: false },
      },
      async run(context: CliRunContext) {
        await runCliCommand(
          context,
          Effect.gen(function* () {
            const installer = yield* PluginInstallerService;
            const registry = yield* PluginRegistryService;
            const pluginId = pluginIdArg(context);
            const targetVersion = readStringArg(context.args, "to");
            const manifest = yield* registry.getManifest(pluginId);
            const updated = yield* installer.update(
              pluginId,
              parseNpmPluginSpec(targetVersion ? `${manifest.id}@${targetVersion}` : manifest.id),
            );
            return { id: updated.id, version: updated.version, integrity: updated.integrity };
          }),
        );
      },
    },
    enable: {
      meta: { name: "enable", description: "Enable a plugin" },
      args: {
        ...globalArgs,
        id: { type: "positional" as const, description: "Plugin id", required: true },
      },
      async run(context: CliRunContext) {
        await runCliCommand(
          context,
          Effect.gen(function* () {
            const registry = yield* PluginRegistryService;
            const plugin = yield* registry.enable(pluginIdArg(context));
            return { id: plugin.id, enabled: plugin.enabled };
          }),
        );
      },
    },
    disable: {
      meta: { name: "disable", description: "Disable a plugin" },
      args: {
        ...globalArgs,
        id: { type: "positional" as const, description: "Plugin id", required: true },
      },
      async run(context: CliRunContext) {
        await runCliCommand(
          context,
          Effect.gen(function* () {
            const registry = yield* PluginRegistryService;
            const plugin = yield* registry.disable(pluginIdArg(context));
            return { id: plugin.id, enabled: plugin.enabled };
          }),
        );
      },
    },
    verify: {
      meta: { name: "verify", description: "Verify plugin integrity" },
      args: {
        ...globalArgs,
        id: { type: "positional" as const, description: "Plugin id (optional)", required: false },
      },
      async run(context: CliRunContext) {
        const global = readGlobalCliArgs(context.args);
        const ctx = renderContextFromArgs(global);
        setVerboseLevel(global.verbose);
        try {
          const results = await runCliEffect(
            Effect.gen(function* () {
              const registry = yield* PluginRegistryService;
              const id = readStringArg(context.args, "id") as PluginId | undefined;
              return yield* registry.verify(id);
            }),
          );
          const failed = results.filter((entry) => !entry.ok);
          if (failed.length === 0) {
            renderSuccess(ctx, { ok: true, results: results.map(toVerifyItem) });
            return;
          }
          const message = failed.map((entry) => `${entry.pluginId}: ${entry.message ?? "integrity check failed"}`).join("; ");
          renderFailure(ctx, new Error(message), ExitCode.DataErr);
        } catch (error) {
          renderFailure(ctx, error, mapErrorToExitCode(error));
        }
      },
    },
    create: {
      meta: { name: "create", description: "Scaffold a new plugin in the current directory" },
      args: {
        ...globalArgs,
        name: { type: "positional" as const, description: "Plugin name", required: true },
        template: { type: "string" as const, description: "Scaffold template", required: false },
      },
      async run(context: CliRunContext) {
        const name = readStringArg(context.args, "name");
        if (!name) {
          renderFailure(renderContextFromArgs(readGlobalCliArgs(context.args)), new Error("plugin name is required"), ExitCode.Usage);
          return;
        }
        await runCliCommand(
          context,
          Effect.gen(function* () {
            const installer = yield* PluginInstallerService;
            return yield* installer.create(name, readStringArg(context.args, "template"), process.cwd());
          }),
        );
      },
    },
    link: {
      meta: { name: "link", description: "Link a local plugin via dev symlink" },
      args: {
        ...globalArgs,
        path: { type: "positional" as const, description: "Plugin directory", required: true },
      },
      async run(context: CliRunContext) {
        const linkPath = readStringArg(context.args, "path");
        if (!linkPath) {
          renderFailure(renderContextFromArgs(readGlobalCliArgs(context.args)), new Error("plugin link requires a path"), ExitCode.Usage);
          return;
        }
        await runCliCommand(
          context,
          Effect.gen(function* () {
            const installer = yield* PluginInstallerService;
            const installed = yield* installer.install(
              resolvePluginInstallSource({ devSymlink: linkPath }),
            );
            return { id: installed.id, version: installed.version, path: installed.rootPath };
          }),
        );
      },
    },
    pack: {
      meta: { name: "pack", description: "Pack a plugin directory into a .tbpack archive" },
      args: {
        ...globalArgs,
        path: { type: "positional" as const, description: "Plugin directory", required: true },
        out: { type: "string" as const, description: "Output archive path", required: false },
      },
      async run(context: CliRunContext) {
        const sourcePath = readStringArg(context.args, "path");
        if (!sourcePath) {
          renderFailure(renderContextFromArgs(readGlobalCliArgs(context.args)), new Error("plugin pack requires a directory path"), ExitCode.Usage);
          return;
        }
        await runCliCommand(
          context,
          Effect.gen(function* () {
            const installer = yield* PluginInstallerService;
            const resolved = path.resolve(sourcePath);
            const raw = yield* Effect.tryPromise({
              try: () => readFile(path.join(resolved, "tileborne-plugin.json"), "utf8"),
              catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
            });
            const manifest = JSON.parse(raw) as { readonly id: string; readonly version: string };
            const out =
              readStringArg(context.args, "out") ??
              path.join(
                process.cwd(),
                "dist",
                `${manifest.id.split("/").pop() ?? "plugin"}-${manifest.version}.tbpack`,
              );
            const packed = yield* installer.pack(resolved, out);
            return {
              archivePath: packed.archivePath,
              integrity: packed.integrity,
              pluginId: packed.manifest.id,
              version: packed.manifest.version,
            };
          }),
        );
      },
    },
  },
};
