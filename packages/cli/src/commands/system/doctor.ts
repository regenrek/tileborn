import { Effect } from "effect";

import { ConfigService, HomeService, LoggerService } from "@tileborne/services-foundation";

import { runCliEffect } from "../../services-layer.js";
import { renderDoctorReport, setVerboseLevel } from "../../render/output.js";
import {
  globalArgs,
  readGlobalCliArgs,
  renderContextFromArgs,
  type CliRunContext,
} from "../shared.js";

interface DoctorCheck {
  readonly id: string;
  readonly severity: "info" | "warn" | "error";
  readonly message: string;
}

const nodeVersionCheck = (): DoctorCheck => {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (major >= 22) {
    return { id: "node", severity: "info", message: `Node.js ${process.versions.node}` };
  }
  return {
    id: "node",
    severity: "error",
    message: `Node.js ${process.versions.node} is unsupported; require >=22`,
  };
};

const pnpmCheck = async (): Promise<DoctorCheck> => {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const result = await execFileAsync("pnpm", ["--version"]);
    return { id: "pnpm", severity: "info", message: `pnpm ${String(result.stdout).trim()}` };
  } catch {
    return { id: "pnpm", severity: "warn", message: "pnpm not found on PATH" };
  }
};

export const doctorCommand = {
  meta: {
    name: "doctor",
    description: "Run Tileborne health checks",
  },
  args: globalArgs,
  async run(context: CliRunContext) {
    const args = readGlobalCliArgs(context.args);
    const ctx = renderContextFromArgs(args);
    setVerboseLevel(args.verbose);

    const report = await runCliEffect(
      Effect.gen(function* () {
        const home = yield* HomeService;
        const config = yield* ConfigService;
        const logger = yield* LoggerService;

        const checks: DoctorCheck[] = [nodeVersionCheck(), yield* Effect.promise(() => pnpmCheck())];

        const paths = yield* home.init();
        checks.push({
          id: "home",
          severity: "info",
          message: `home directory ready at ${paths.root}`,
        });

        const currentConfig = yield* config.get;
        checks.push({
          id: "config",
          severity: "info",
          message: `config loaded (loggerLevel=${currentConfig.loggerLevel})`,
        });

        yield* logger.debug("doctor probe", { paths: paths.root });
        checks.push({
          id: "logger",
          severity: "info",
          message: "logger service reachable",
        });

        const ok = checks.every((check) => check.severity !== "error");
        return { ok, checks };
      }),
    );

    const exitCode = renderDoctorReport(ctx, report);
    process.exit(exitCode);
  },
};
