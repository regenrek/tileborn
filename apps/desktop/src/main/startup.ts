import { Effect, Option } from "effect";

import {
  HomeService,
  JobService,
  LoggerService,
  type LogMethod,
} from "@tileborne/services-foundation";

import type { StartupReporter } from "./startup-reporter.js";
import { registerAssetProtocol } from "./asset-library/asset-protocol.js";
import { registerMainIpc, type MainIpcRegistration } from "./ipc/handlers.js";
import { stopDesktopLocalGameHost } from "./local-game-host-manager.js";
import { disposeRuntime, runEffect } from "./runtime.js";
import { seedBundledPlugins } from "./seed-plugins.js";
import type { StartupStatusStore, StartupTaskId } from "../shared/startup-status.js";

const OPTIONAL_STARTUP_TASK_TIMEOUT_MS = 15_000;

type StartupLogger = Readonly<{
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
  fatal: LogMethod;
}>;

export interface DesktopStartupController {
  readonly start: () => Promise<void>;
  readonly shutdown: () => Promise<void>;
}

export interface DesktopStartupControllerOptions {
  readonly status: StartupStatusStore;
  readonly reporter: StartupReporter;
}

const toError = (cause: unknown): Error => (cause instanceof Error ? cause : new Error(String(cause)));

const logStartup = (
  logger: StartupLogger,
  level: "info" | "warn" | "error" | "fatal",
  message: string,
  fields: Record<string, unknown> = {},
): Promise<void> => runEffect(logger[level](message, fields)).catch(() => undefined);

const getLogger = (): Promise<StartupLogger> =>
  runEffect(
    Effect.gen(function* () {
      return yield* LoggerService;
    }),
  );

const runRequiredEffect = async <A, R>(
  reporter: StartupReporter,
  taskId: StartupTaskId,
  effect: Effect.Effect<A, unknown, R>,
): Promise<A> => {
  reporter.begin(taskId);
  try {
    const result = await runEffect(effect);
    reporter.complete(taskId);
    return result;
  } catch (cause) {
    reporter.fail(taskId, "failed", cause);
    throw cause;
  }
};

const runOptionalEffect = async <R>(
  reporter: StartupReporter,
  logger: StartupLogger,
  taskId: StartupTaskId,
  effect: Effect.Effect<void, unknown, R>,
): Promise<void> => {
  reporter.begin(taskId, `timeout ${OPTIONAL_STARTUP_TASK_TIMEOUT_MS}ms`);
  const bounded = effect.pipe(
    Effect.timeoutOrElse({
      duration: `${OPTIONAL_STARTUP_TASK_TIMEOUT_MS} millis`,
      orElse: () =>
        Effect.fail(
          new Error(`timed out after ${OPTIONAL_STARTUP_TASK_TIMEOUT_MS}ms`),
        ),
    }),
    Effect.match({
      onFailure: (cause) => ({ ok: false as const, error: toError(cause) }),
      onSuccess: () => ({ ok: true as const }),
    }),
  );

  const result = await runEffect(bounded);
  if (result.ok) {
    reporter.complete(taskId);
    await logStartup(logger, "info", `Startup task ${taskId} completed`);
    return;
  }

  const status = result.error.message.includes("timed out after") ? "timed-out" : "failed";
  reporter.fail(taskId, status, result.error);
  await logStartup(logger, "warn", `Optional startup task ${taskId} ${status}`, {
    message: result.error.message,
  });
};

export const createDesktopStartupController = ({
  status,
  reporter,
}: DesktopStartupControllerOptions): DesktopStartupController => {
  let ipcRegistration: MainIpcRegistration | undefined;

  const start = async (): Promise<void> => {
    reporter.begin("background-startup");
    try {
      // Serve installed pack assets via the custom protocol as early as
      // possible (app is already ready here). Renderer image/atlas loads then
      // bypass base64-data-URL IPC and decode off the main thread.
      registerAssetProtocol();

      const homeService = await runRequiredEffect(
        reporter,
        "runtime-services",
        Effect.gen(function* () {
          return yield* HomeService;
        }),
      );

      const home = await runRequiredEffect(reporter, "home-init", homeService.init());

      const logger = await getLogger();
      await logStartup(logger, "info", "Tileborne desktop domain startup beginning", {
        homeRoot: home.root,
      });

      ipcRegistration = await runRequiredEffect(reporter, "ipc-registration", registerMainIpc);

      await runOptionalEffect(reporter, logger, "plugin-seed", seedBundledPlugins);

      reporter.complete("background-startup");
      const finalState = status.getSnapshot().state;
      if (finalState === "failed") {
        await logStartup(logger, "error", "Tileborne desktop startup reached a failed shell state");
      } else if (finalState === "degraded") {
        status.setState("degraded");
        await logStartup(logger, "warn", "Tileborne desktop ready with startup warnings");
      } else {
        status.setState("ready");
        await logStartup(logger, "info", "Tileborne desktop ready");
      }
    } catch (cause) {
      reporter.fail("background-startup", "failed", cause);
      const logger = await getLogger().catch(() => undefined);
      if (logger !== undefined) {
        await logStartup(logger, "fatal", "Unhandled startup failure", {
          cause: Option.some(String(cause)),
        });
      }
    }
  };

  const shutdown = async (): Promise<void> => {
    // Run domain cleanup ON the managed runtime. Any failure here — including
    // fiber interruption raised while shutting things down — must never block a
    // clean process exit, so every cause is swallowed: the window is already
    // going away. Crucially, this effect no longer disposes the runtime it is
    // running on (that self-interrupt surfaced as
    // "All fibers interrupted without error" and failed every quit; t-wk7b).
    await runEffect(
      Effect.gen(function* () {
        const jobs = yield* JobService;
        const logger = yield* LoggerService;
        const running = (yield* jobs.list()).filter(
          (job) => job.status._tag === "Running" || job.status._tag === "Pending",
        );
        yield* Effect.forEach(
          running,
          (job) =>
            jobs.cancel(job.id).pipe(
              Effect.match({ onFailure: () => Effect.void, onSuccess: () => Effect.void }),
            ),
          { discard: true },
        );
        ipcRegistration?.handlers.unregister();
        ipcRegistration?.events.unregister();
        yield* Effect.tryPromise({
          try: () => stopDesktopLocalGameHost(),
          catch: () => new Error("stop local host failed"),
        }).pipe(Effect.match({ onFailure: () => Effect.void, onSuccess: () => Effect.void }));
        yield* logger.info("Tileborne desktop main shut down");
      }).pipe(Effect.catchCause(() => Effect.void)),
    ).catch(() => undefined);

    // Release layer resources AFTER cleanup, from outside the runtime's own
    // fiber scope (see runtime.ts disposeRuntime) so disposal does not
    // self-interrupt. This resolves cleanly so `before-quit` can exit(0).
    await disposeRuntime();
  };

  return { start, shutdown };
};
