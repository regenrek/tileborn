import path from "node:path";

import { spawnTracked } from "../../lib/spawn.js";
import { renderFailure, renderSuccess, setVerboseLevel } from "../../render/output.js";
import { ExitCode } from "../../render/exit-codes.js";
import { globalArgs, readGlobalCliArgs, readStringArg, renderContextFromArgs, type CliRunContext } from "../shared.js";

const repoRoot = path.resolve(import.meta.dirname, "../../../../..");

const runVitest = async (cwd: string, extraArgs: readonly string[] = []): Promise<number> => {
  const child = spawnTracked("pnpm", ["exec", "vitest", "--run", ...extraArgs], { cwd });
  return (await child.exited) ?? 1;
};

export const testCommand = {
  meta: { name: "test", description: "Run Tileborne test suites" },
  subCommands: {
    runtime: {
      meta: { name: "runtime", description: "Run packages/runtime tests" },
      args: globalArgs,
      async run(context: CliRunContext) {
        const args = readGlobalCliArgs(context.args);
        const ctx = renderContextFromArgs(args);
        setVerboseLevel(args.verbose);
        const code = await runVitest(path.join(repoRoot, "packages/runtime"));
        if (code !== 0) {
          renderFailure(ctx, new Error(`runtime tests failed with exit ${code}`), ExitCode.Software);
        }
        renderSuccess(ctx, { target: "runtime", exitCode: code });
      },
    },
    plugin: {
      meta: { name: "plugin", description: "Run a plugin package vitest suite when present" },
      args: {
        ...globalArgs,
        id: { type: "positional" as const, description: "Plugin id", required: true },
      },
      async run(context: CliRunContext) {
        const args = readGlobalCliArgs(context.args);
        const ctx = renderContextFromArgs(args);
        setVerboseLevel(args.verbose);
        const pluginId = readStringArg(context.args, "id");
        if (!pluginId) {
          renderFailure(ctx, new Error("plugin id is required"), ExitCode.Usage);
          return;
        }
        const pluginDir = path.join(repoRoot, "plugins", pluginId.replace("@tileborne-plugins/", ""));
        const config = path.join(pluginDir, "vitest.config.ts");
        try {
          await import("node:fs/promises").then(({ access }) => access(config));
        } catch {
          renderFailure(ctx, new Error(`plugin vitest config not found: ${config}`), ExitCode.NoInput);
          return;
        }
        const code = await runVitest(pluginDir);
        if (code !== 0) {
          renderFailure(ctx, new Error(`plugin tests failed with exit ${code}`), ExitCode.Software);
        }
        renderSuccess(ctx, { target: "plugin", pluginId, exitCode: code });
      },
    },
    all: {
      meta: { name: "all", description: "Run workspace tests and aggregate counts" },
      args: globalArgs,
      async run(context: CliRunContext) {
        const args = readGlobalCliArgs(context.args);
        const ctx = renderContextFromArgs(args);
        setVerboseLevel(args.verbose);
        const child = spawnTracked("pnpm", ["-w", "test", "--", "--run"], { cwd: repoRoot });
        const code = (await child.exited) ?? 1;
        const payload = { passed: code === 0 ? 1 : 0, failed: code === 0 ? 0 : 1, exitCode: code };
        if (args.json) {
          process.stdout.write(`${JSON.stringify(payload)}\n`);
        } else if (code !== 0) {
          renderFailure(ctx, new Error("workspace tests failed"), ExitCode.Software);
        } else {
          renderSuccess(ctx, payload);
        }
        process.exit(code);
      },
    },
  },
};
