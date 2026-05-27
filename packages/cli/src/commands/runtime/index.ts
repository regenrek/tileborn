import path from "node:path";
import { access } from "node:fs/promises";

import { BackendKind, readBackendImplFromEnv, selectBackend, wasmBindingsAvailable } from "@tileborne/runtime-wasm";
import { Effect } from "effect";

import { serveStaticDirectory } from "../../lib/http-server.js";
import { cancelActiveCliWork, runCliEffect } from "../../services-layer.js";
import { renderFailure, renderInfo, renderSuccess, setVerboseLevel } from "../../render/output.js";
import { ExitCode } from "../../render/exit-codes.js";
import { globalArgs, readGlobalCliArgs, readStringArg, renderContextFromArgs, type CliRunContext } from "../shared.js";

const backendKinds: readonly BackendKind[] = ["pathfinding", "broadphase", "procgen", "simulation"];

export const runtimeCommand = {
  meta: { name: "runtime", description: "Serve playtest artifacts and discover runtime backends" },
  subCommands: {
    serve: {
      meta: { name: "serve", description: "Serve a playtest artifact over HTTP" },
      args: {
        ...globalArgs,
        artifact: { type: "string" as const, description: "Artifact directory", required: false },
        port: { type: "string" as const, description: "Port (0 = auto)", default: "4173" },
      },
      async run(context: CliRunContext) {
        const args = readGlobalCliArgs(context.args);
        const ctx = renderContextFromArgs(args);
        setVerboseLevel(args.verbose);
        const artifact = readStringArg(context.args, "artifact");
        const port = Number.parseInt(readStringArg(context.args, "port") ?? "4173", 10);
        if (!artifact) {
          renderFailure(ctx, new Error("--artifact is required"), ExitCode.Usage);
          return;
        }
        try {
          await access(path.join(artifact, "index.html"));
        } catch {
          renderFailure(ctx, new Error(`artifact missing index.html: ${artifact}`), ExitCode.NoInput);
          return;
        }
        const server = await serveStaticDirectory(path.resolve(artifact), port);
        renderInfo(ctx, `serving ${artifact}`, { url: server.url, port: server.port });
        const shutdown = async () => {
          cancelActiveCliWork();
          await server.close();
          process.exit(130);
        };
        process.once("SIGINT", () => void shutdown());
        process.once("SIGTERM", () => void shutdown());
        await new Promise<void>(() => undefined);
      },
    },
    discover: {
      meta: { name: "discover", description: "List installed runtime backends" },
      args: globalArgs,
      async run(context: CliRunContext) {
        const args = readGlobalCliArgs(context.args);
        const ctx = renderContextFromArgs(args);
        setVerboseLevel(args.verbose);
        const impl = readBackendImplFromEnv();
        const backends = await runCliEffect(
          Effect.gen(function* () {
            const entries = [];
            for (const kind of backendKinds) {
              const selected = yield* selectBackend(kind, { impl });
              entries.push({
                kind,
                impl: selected.metadata.impl,
                version: selected.metadata.version,
                available: true,
              });
              selected.dispose();
            }
            return {
              requestedImpl: impl,
              wasmBindingsAvailable: wasmBindingsAvailable(),
              backends: entries,
            };
          }),
        );
        renderSuccess(ctx, backends);
      },
    },
  },
};
