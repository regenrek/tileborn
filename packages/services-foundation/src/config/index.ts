import { readFile } from "node:fs/promises";

import { Context, Effect, Layer, Option, Schema, Stream, SubscriptionRef } from "effect";

import { HomeService, type HomeServiceError } from "../home/index.js";
import { writeJsonAtomic } from "../internal/atomic-json.js";

export const LoggerLevel = Schema.Literals(["trace", "debug", "info", "warn", "error", "silent"]);
export type LoggerLevel = Schema.Schema.Type<typeof LoggerLevel>;

export const TileborneConfig = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  homePath: Schema.OptionFromOptional(Schema.String),
  lastOpenedProject: Schema.OptionFromOptional(Schema.String),
  pluginPreferences: Schema.Record(Schema.String, Schema.Boolean),
  loggerLevel: LoggerLevel,
  telemetryOptIn: Schema.Boolean,
});
export type TileborneConfig = Schema.Schema.Type<typeof TileborneConfig>;

export interface TileborneConfigPatch {
  readonly homePath?: Option.Option<string>;
  readonly lastOpenedProject?: Option.Option<string>;
  readonly pluginPreferences?: Readonly<Record<string, boolean>>;
  readonly loggerLevel?: LoggerLevel;
  readonly telemetryOptIn?: boolean;
}

export class ConfigReadError extends Schema.TaggedErrorClass<ConfigReadError>()("ConfigReadError", {
  path: Schema.String,
  message: Schema.String,
}) {}

export class ConfigWriteError extends Schema.TaggedErrorClass<ConfigWriteError>()("ConfigWriteError", {
  path: Schema.String,
  message: Schema.String,
}) {}

export class ConfigParseError extends Schema.TaggedErrorClass<ConfigParseError>()("ConfigParseError", {
  path: Schema.String,
  message: Schema.String,
}) {}

export type ConfigServiceError = ConfigReadError | ConfigWriteError | ConfigParseError | HomeServiceError;

export class ConfigService extends Context.Service<ConfigService, {
  readonly get: Effect.Effect<TileborneConfig, ConfigServiceError>;
  readonly set: (partial: TileborneConfigPatch) => Effect.Effect<TileborneConfig, ConfigServiceError>;
  readonly subscribe: Stream.Stream<TileborneConfig>;
}>()("@tileborne/services-foundation/ConfigService") {}

export const defaultConfig: TileborneConfig = {
  schemaVersion: 1,
  homePath: Option.none(),
  lastOpenedProject: Option.none(),
  pluginPreferences: {},
  loggerLevel: "info",
  telemetryOptIn: false,
};

const isNotFound = (cause: unknown): boolean =>
  typeof cause === "object" &&
  cause !== null &&
  "code" in cause &&
  (cause as { readonly code?: unknown }).code === "ENOENT";

const readConfigFile = (
  filePath: string,
): Effect.Effect<TileborneConfig, ConfigReadError | ConfigParseError> =>
  Effect.gen(function* () {
    const raw = yield* Effect.tryPromise({
      try: async () => {
        try {
          return await readFile(filePath, "utf8");
        } catch (cause) {
          if (isNotFound(cause)) {
            return undefined;
          }
          throw cause;
        }
      },
      catch: (cause) =>
        new ConfigReadError({
          path: filePath,
          message: cause instanceof Error ? cause.message : String(cause),
        }),
    });

    if (raw === undefined) {
      return defaultConfig;
    }

    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw) as unknown,
      catch: (cause) =>
        new ConfigParseError({
          path: filePath,
          message: cause instanceof Error ? cause.message : String(cause),
        }),
    });

    return yield* Effect.try({
      try: () => Schema.decodeUnknownSync(TileborneConfig)(parsed),
      catch: (cause) =>
        new ConfigParseError({
          path: filePath,
          message: cause instanceof Error ? cause.message : String(cause),
        }),
    });
  });

const writeConfigFile = (
  filePath: string,
  config: TileborneConfig,
): Effect.Effect<void, ConfigWriteError> =>
  Effect.gen(function* () {
    const encoded = yield* Effect.try({
      try: () => Schema.encodeSync(TileborneConfig)(config),
      catch: (cause) =>
        new ConfigWriteError({
          path: filePath,
          message: cause instanceof Error ? cause.message : String(cause),
        }),
    });
    yield* writeJsonAtomic(filePath, encoded).pipe(
      Effect.mapError((error) => new ConfigWriteError({ path: error.path, message: error.message })),
    );
  });

const mergeConfig = (current: TileborneConfig, patch: TileborneConfigPatch): TileborneConfig => ({
  schemaVersion: 1,
  homePath: patch.homePath ?? current.homePath,
  lastOpenedProject: patch.lastOpenedProject ?? current.lastOpenedProject,
  pluginPreferences: patch.pluginPreferences
    ? { ...current.pluginPreferences, ...patch.pluginPreferences }
    : current.pluginPreferences,
  loggerLevel: patch.loggerLevel ?? current.loggerLevel,
  telemetryOptIn: patch.telemetryOptIn ?? current.telemetryOptIn,
});

export const ConfigServiceLive = Layer.effect(
  ConfigService,
  Effect.gen(function* () {
    const home = yield* HomeService;
    const paths = yield* home.init();
    const initial = yield* readConfigFile(paths.config);
    const ref = yield* SubscriptionRef.make(initial);

    return {
      get: SubscriptionRef.get(ref),
      set: Effect.fn("ConfigService.set")(function* (partial: TileborneConfigPatch) {
        const next = mergeConfig(yield* SubscriptionRef.get(ref), partial);
        yield* writeConfigFile(paths.config, next);
        yield* SubscriptionRef.set(ref, next);
        return next;
      }),
      subscribe: SubscriptionRef.changes(ref),
    };
  }),
);
