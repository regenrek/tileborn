import { createConsola } from "consola";
import { Option } from "effect";

import { ExitCode, exitCodeLabel, type ExitCodeValue } from "./exit-codes.js";
import { errorMessage } from "./errors.js";

export interface RenderContext {
  readonly json: boolean;
  readonly verbose: boolean;
}

export const consola = createConsola({
  level: 4,
});

export const renderSuccess = <A>(ctx: RenderContext, payload: A): void => {
  if (ctx.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, data: payload }, null, 2)}\n`);
    return;
  }
  consola.success(JSON.stringify(payload, null, 2));
};

export const renderInfo = (ctx: RenderContext, message: string, data?: Record<string, unknown>): void => {
  if (ctx.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, message, ...(data ? { data } : {}) }, null, 2)}\n`);
    return;
  }
  if (data) {
    consola.info(message, data);
  } else {
    consola.info(message);
  }
};

export const renderFailure = (ctx: RenderContext, error: unknown, exitCode: ExitCodeValue): never => {
  const message = errorMessage(error);
  if (ctx.json) {
    process.stderr.write(
      `${JSON.stringify(
        {
          error: {
            code: exitCodeLabel(exitCode),
            exitCode,
            message,
          },
        },
        null,
        2,
      )}\n`,
    );
  } else {
    consola.error(message);
  }
  process.exit(exitCode);
};

export const renderDoctorReport = (
  ctx: RenderContext,
  report: {
    readonly ok: boolean;
    readonly checks: readonly {
      readonly id: string;
      readonly severity: "info" | "warn" | "error";
      readonly message: string;
    }[];
  },
): ExitCodeValue => {
  if (ctx.json) {
    process.stdout.write(`${JSON.stringify({ ok: report.ok, checks: report.checks }, null, 2)}\n`);
  } else {
    for (const check of report.checks) {
      const line = `[${check.severity}] ${check.id}: ${check.message}`;
      if (check.severity === "error") {
        consola.error(line);
      } else if (check.severity === "warn") {
        consola.warn(line);
      } else {
        consola.info(line);
      }
    }
  }
  return report.ok ? ExitCode.Ok : ExitCode.Unavailable;
};

export const optionFromArg = (value: string | undefined): Option.Option<string> =>
  value && value.length > 0 ? Option.some(value) : Option.none();

export const setVerboseLevel = (verbose: boolean): void => {
  consola.level = verbose ? 5 : 3;
};

export interface MultiplayerStatusPayload {
  readonly baseUrl: string;
  readonly roomId: string;
  readonly roomUrl: string;
  readonly wsUrl: string;
  readonly signingKeyFingerprint: string;
  readonly mapId: string;
  readonly port: number;
  readonly players: number;
  readonly deeplink: string;
  readonly artifactPath: string;
}

const multiplayerStatusRows = (payload: MultiplayerStatusPayload): readonly [string, string][] => [
  ["Room URL", payload.roomUrl],
  ["WebSocket", payload.wsUrl],
  ["Signing key", payload.signingKeyFingerprint],
  ["Map", payload.mapId],
  ["Port", String(payload.port)],
  ["Players", String(payload.players)],
  ["Deep link", payload.deeplink],
];

export const renderMultiplayerStatus = (ctx: RenderContext, payload: MultiplayerStatusPayload): void => {
  if (ctx.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, data: payload }, null, 2)}\n`);
    return;
  }
  const labelWidth = Math.max(...multiplayerStatusRows(payload).map(([label]) => label.length));
  consola.info("Local multiplayer playtest ready");
  for (const [label, value] of multiplayerStatusRows(payload)) {
    consola.info(`  ${label.padEnd(labelWidth)}  ${value}`);
  }
  consola.info("Press Ctrl+C to stop");
};

export interface GameServeStatusPayload {
  readonly baseUrl: string;
  readonly signingKeyFingerprint: string;
  readonly port: number;
  readonly bind: string;
}

const gameServeStatusRows = (payload: GameServeStatusPayload): readonly [string, string][] => [
  ["Base URL", payload.baseUrl],
  ["Signing key", payload.signingKeyFingerprint],
  ["Port", String(payload.port)],
  ["Bind", payload.bind],
];

export const renderGameServeStatus = (ctx: RenderContext, payload: GameServeStatusPayload): void => {
  if (ctx.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, data: payload }, null, 2)}\n`);
    return;
  }
  const labelWidth = Math.max(...gameServeStatusRows(payload).map(([label]) => label.length));
  consola.info("Local game-host ready");
  for (const [label, value] of gameServeStatusRows(payload)) {
    consola.info(`  ${label.padEnd(labelWidth)}  ${value}`);
  }
  consola.info("Press Ctrl+C to stop");
};

export const applyLogLevelEnv = (): void => {
  const level = process.env["TILEBORNE_LOG_LEVEL"];
  if (!level) {
    return;
  }
  const map: Record<string, number> = {
    silent: 0,
    error: 1,
    warn: 2,
    info: 3,
    debug: 4,
    trace: 5,
  };
  if (level in map) {
    consola.level = map[level] ?? 3;
  }
};
