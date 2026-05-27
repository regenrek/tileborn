import path from "node:path";
import { inspect } from "node:util";
import { appendFile, readFile, readdir, rm } from "node:fs/promises";
import { watch as watchFs } from "node:fs";

import { createConsola, type ConsolaReporter } from "consola";
import { Context, Effect, Layer, PubSub, Schema, Semaphore, Stream } from "effect";

import { ConfigService, type ConfigServiceError, type LoggerLevel } from "../config/index.js";
import { HomeService, type HomeServiceError } from "../home/index.js";

export type LogFields = Readonly<Record<string, unknown>>;
export type LogMethod = (message: string, fields?: LogFields) => Effect.Effect<void, LoggerServiceError>;

export interface LoggerTailOptions {
  readonly sinceMs?: number;
  readonly follow?: boolean;
  readonly signal?: AbortSignal;
}

export interface TileborneLogLine {
  readonly ts: string;
  readonly level: Exclude<LoggerLevel, "silent">;
  readonly msg: string;
  readonly fields: LogFields;
}

export class LoggerWriteError extends Schema.TaggedErrorClass<LoggerWriteError>()("LoggerWriteError", {
  path: Schema.String,
  message: Schema.String,
}) {}

export type LoggerServiceError = LoggerWriteError | HomeServiceError | ConfigServiceError;

export class LoggerService extends Context.Service<LoggerService, {
  readonly info: LogMethod;
  readonly warn: LogMethod;
  readonly error: LogMethod;
  readonly debug: LogMethod;
  readonly trace: LogMethod;
  readonly fatal: LogMethod;
  readonly subscribe: Stream.Stream<void>;
  readonly tail: (opts?: LoggerTailOptions) => Effect.Effect<AsyncIterable<string>, LoggerServiceError>;
  readonly latestLogPath: () => Effect.Effect<string | undefined, LoggerServiceError>;
}>()("@tileborne/services-foundation/LoggerService") {}

const stderrReporter: ConsolaReporter = {
  log(logObj) {
    const fields = logObj.args.length > 0 ? ` ${logObj.args.map((arg) => inspect(arg)).join(" ")}` : "";
    process.stderr.write(`${logObj.message ?? ""}${fields}\n`);
  },
};

const pretty = createConsola({ level: 5, reporters: [stderrReporter] });

const levelRank: Record<LoggerLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

const logFileName = (date: Date): string => `tileborne-${date.toISOString().slice(0, 10)}.log`;

const latestLogFile = async (logsDirectory: string): Promise<string | undefined> => {
  const entries = await readdir(logsDirectory);
  const files = entries
    .filter((entry) => /^tileborne-\d{4}-\d{2}-\d{2}\.log$/.test(entry))
    .sort()
    .reverse();
  return files[0] ? path.join(logsDirectory, files[0]) : undefined;
};

async function* tailLogFile(
  filePath: string,
  sinceMs: number,
  follow: boolean,
  signal?: AbortSignal,
): AsyncIterable<string> {
  const emitLines = (raw: string): Generator<string> =>
    (function* () {
      for (const line of raw.split("\n").filter((entry) => entry.trim().length > 0)) {
        try {
          const parsed = JSON.parse(line) as { ts?: string };
          const ts = parsed.ts ? Date.parse(parsed.ts) : 0;
          if (ts >= sinceMs) {
            yield line;
          }
        } catch {
          yield line;
        }
      }
    })();

  yield* emitLines(await readFile(filePath, "utf8"));
  if (!follow) {
    return;
  }

  const pending: string[] = [];
  let wake: (() => void) | undefined;
  const watcher = watchFs(filePath, () => {
    void readFile(filePath, "utf8").then((next) => {
      const tail = next.split("\n").filter((line) => line.trim().length > 0).at(-1);
      if (tail) {
        pending.push(tail);
        wake?.();
      }
    });
  });

  try {
    while (!signal?.aborted) {
      while (pending.length > 0) {
        yield pending.shift() as string;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    }
  } finally {
    watcher.close();
  }
}

const rotateLogs = (logsDirectory: string, keepDays: number): Effect.Effect<void, LoggerWriteError> =>
  Effect.gen(function* () {
    const entries = yield* Effect.tryPromise({
      try: () => readdir(logsDirectory),
      catch: (cause) =>
        new LoggerWriteError({
          path: logsDirectory,
          message: cause instanceof Error ? cause.message : String(cause),
        }),
    });
    const logFiles = entries
      .filter((entry) => /^tileborne-\d{4}-\d{2}-\d{2}\.log$/.test(entry))
      .sort()
      .reverse();
    const stale = logFiles.slice(keepDays);

    yield* Effect.forEach(
      stale,
      (entry) =>
        Effect.tryPromise({
          try: () => rm(path.join(logsDirectory, entry), { force: true }),
          catch: (cause) =>
            new LoggerWriteError({
              path: path.join(logsDirectory, entry),
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        }),
      { discard: true },
    );
  });

const writeLogLine = (
  logsDirectory: string,
  line: TileborneLogLine,
): Effect.Effect<void, LoggerWriteError> => {
  const filePath = path.join(logsDirectory, logFileName(new Date(line.ts)));
  return Effect.tryPromise({
    try: () => appendFile(filePath, `${JSON.stringify(line)}\n`, "utf8"),
    catch: (cause) =>
      new LoggerWriteError({
        path: filePath,
        message: cause instanceof Error ? cause.message : String(cause),
      }),
  });
};

export const LoggerServiceLive = Layer.effect(
  LoggerService,
  Effect.gen(function* () {
    const home = yield* HomeService;
    const config = yield* ConfigService;
    const paths = yield* home.init();
    const keepDays = 7;
    const writeGate = yield* Semaphore.make(1);
    const appended = yield* PubSub.unbounded<void>();

    const log = (level: Exclude<LoggerLevel, "silent">): LogMethod =>
      Effect.fn(`LoggerService.${level}`)(function* (message: string, fields: LogFields = {}) {
        const current = yield* config.get;
        if (levelRank[current.loggerLevel] < levelRank[level]) {
          return;
        }

        const line: TileborneLogLine = {
          ts: new Date().toISOString(),
          level,
          msg: message,
          fields,
        };

        yield* writeGate.withPermit(
          Effect.gen(function* () {
            yield* writeLogLine(paths.logs, line);
            yield* rotateLogs(paths.logs, keepDays);
            pretty[level](message, fields);
            yield* PubSub.publish(appended, void 0);
          }),
        );
      });

    const fatal: LogMethod = Effect.fn("LoggerService.fatal")(function* (message: string, fields: LogFields = {}) {
      yield* log("error")(message, fields);
    });

    const latestLogPath = Effect.fn("LoggerService.latestLogPath")(function* () {
      return yield* Effect.tryPromise({
        try: () => latestLogFile(paths.logs),
        catch: (cause) =>
          new LoggerWriteError({
            path: paths.logs,
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      });
    });

    const tail = Effect.fn("LoggerService.tail")(function* (opts: LoggerTailOptions = {}) {
      const filePath = yield* latestLogPath();
      if (!filePath) {
        yield* new LoggerWriteError({ path: paths.logs, message: "no log file found" });
      }
      return tailLogFile(filePath as string, opts.sinceMs ?? 0, opts.follow ?? false, opts.signal);
    });

    return {
      info: log("info"),
      warn: log("warn"),
      error: log("error"),
      debug: log("debug"),
      trace: log("trace"),
      fatal,
      subscribe: Stream.fromPubSub(appended),
      tail,
      latestLogPath,
    };
  }),
);
