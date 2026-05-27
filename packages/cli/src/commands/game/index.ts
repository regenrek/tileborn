import { BuildTarget, BuildService, GameBuildOptions } from "@tileborne/services-build";
import { Effect, Option, Schema } from "effect";

import { runGameServe } from "../../lib/game-serve.js";
import { runCliCommand } from "../../lib/run-command.js";
import { setVerboseLevel } from "../../render/output.js";
import { CliValidationError } from "../../render/errors.js";
import { globalArgs, readGlobalCliArgs, readStringArg, renderContextFromArgs, type CliRunContext } from "../shared.js";

const readPluginArg = (args: Record<string, unknown>): string | undefined => readStringArg(args, "plugin");

const readStringArrayArg = (args: Record<string, unknown>, key: string): readonly string[] => {
  const value = args[key];
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  return [];
};

export const gameCommand = {
  meta: { name: "game", description: "Build and locally serve game-host bundles" },
  subCommands: {
    build: {
      meta: { name: "build", description: "Build a plugin game bundle" },
      args: {
        ...globalArgs,
        plugin: { type: "string" as const, description: "Plugin id", required: true },
        target: { type: "string" as const, description: "cloudflare|node|web", default: "node" },
        out: { type: "string" as const, description: "Output directory", required: false },
        "asset-pack": {
          type: "string" as const,
          description: "Asset pack id (repeatable)",
          required: false,
        },
      },
      async run(context: CliRunContext) {
        await runCliCommand(
          context,
          Effect.gen(function* () {
            const plugin = readPluginArg(context.args);
            if (!plugin) {
              yield* Effect.fail(new CliValidationError({ message: "--plugin is required" }));
            }
            const target = Schema.decodeUnknownSync(BuildTarget)(readStringArg(context.args, "target") ?? "node");
            const builds = yield* BuildService;
            const artifact = yield* builds.buildGame(
              new GameBuildOptions({
                pluginId: plugin as string,
                target,
                outputDirectory: (() => {
                  const out = readStringArg(context.args, "out");
                  return out ? Option.some(out) : Option.none();
                })(),
                assetPackIds: (() => {
                  const packs = readStringArrayArg(context.args, "asset-pack");
                  return packs.length > 0 ? Option.some([...packs]) : Option.none();
                })(),
                siteName: Option.none(),
              }),
            );
            if (target === "cloudflare") {
              return {
                outDir: artifact.directory,
                files: artifact.files,
                manifestHash: artifact.integrityHash,
                pluginId: artifact.pluginId,
                target: artifact.target,
                bundlePath: artifact.bundlePath,
              };
            }
            return {
              pluginId: artifact.pluginId,
              target: artifact.target,
              directory: artifact.directory,
              bundlePath: artifact.bundlePath,
              integrityHash: artifact.integrityHash,
            };
          }),
        );
      },
    },
    serve: {
      meta: { name: "serve", description: "Run a local miniflare game-host dev server" },
      args: {
        ...globalArgs,
        port: { type: "string" as const, description: "HTTP port (0 = auto)", default: "8787" },
        "signing-key": { type: "string" as const, description: "Handoff signing key", required: false },
        bind: { type: "string" as const, description: "Bind address", default: "127.0.0.1" },
      },
      async run(context: CliRunContext) {
        const args = readGlobalCliArgs(context.args);
        const ctx = renderContextFromArgs(args);
        setVerboseLevel(args.verbose);
        const port = Number.parseInt(readStringArg(context.args, "port") ?? "8787", 10);
        const signingKey = readStringArg(context.args, "signing-key");
        const bind = readStringArg(context.args, "bind") ?? "127.0.0.1";
        await runGameServe(ctx, { port, signingKey, bind });
      },
    },
  },
};
