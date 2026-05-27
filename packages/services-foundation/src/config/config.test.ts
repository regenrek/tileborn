import { access, readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { Effect, Fiber, Option, Stream } from "effect";

import { ConfigLayer } from "../index.js";
import { ConfigService } from "./index.js";
import { withTempHome } from "../test-utils.js";

describe("ConfigService", () => {
  it("returns the default config when config.json is absent", () =>
    withTempHome(async () => {
      const config = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* ConfigService;
          return yield* service.get;
        }).pipe(Effect.provide(ConfigLayer)),
      );

      expect(config.schemaVersion).toBe(1);
      expect(config.loggerLevel).toBe("info");
      expect(config.telemetryOptIn).toBe(false);
      expect(Option.isNone(config.lastOpenedProject)).toBe(true);
    }));

  it("writes config atomically and roundtrips persisted values", () =>
    withTempHome(async (home) => {
      const config = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* ConfigService;
          return yield* service.set({
            lastOpenedProject: Option.some("project:demo"),
            pluginPreferences: { "@tileborne-plugins/demo": true },
            loggerLevel: "debug",
            telemetryOptIn: true,
          });
        }).pipe(Effect.provide(ConfigLayer)),
      );

      const raw = JSON.parse(await readFile(`${home}/config.json`, "utf8")) as Record<string, unknown>;
      expect(raw).toMatchObject({
        schemaVersion: 1,
        lastOpenedProject: "project:demo",
        loggerLevel: "debug",
        telemetryOptIn: true,
      });
      expect(config.pluginPreferences["@tileborne-plugins/demo"]).toBe(true);
    }));

  it("ignores a stale temp file and overwrites it on the next atomic write", () =>
    withTempHome(async (home) => {
      await writeFile(
        `${home}/config.json`,
        `${JSON.stringify({
          schemaVersion: 1,
          pluginPreferences: {},
          loggerLevel: "warn",
          telemetryOptIn: false,
        })}\n`,
        "utf8",
      );
      await writeFile(`${home}/config.json.tmp`, "{not-json", "utf8");

      const config = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* ConfigService;
          const current = yield* service.get;
          const next = yield* service.set({ loggerLevel: "debug" });
          return { current, next };
        }).pipe(Effect.provide(ConfigLayer)),
      );

      await expect(access(`${home}/config.json.tmp`)).rejects.toMatchObject({ code: "ENOENT" });
      const raw = JSON.parse(await readFile(`${home}/config.json`, "utf8")) as Record<string, unknown>;
      expect(config.current.loggerLevel).toBe("warn");
      expect(config.next.loggerLevel).toBe("debug");
      expect(raw["loggerLevel"]).toBe("debug");
    }));

  it("publishes config updates to subscribers", () =>
    withTempHome(async () => {
      const updates = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* ConfigService;
          const fiber = yield* service.subscribe.pipe(Stream.take(2), Stream.runCollect, Effect.forkChild);
          yield* service.set({ loggerLevel: "trace" });
          return yield* Fiber.join(fiber);
        }).pipe(Effect.provide(ConfigLayer)),
      );

      const levels = Array.from(updates, (config) => config.loggerLevel);
      expect(levels).toEqual(["info", "trace"]);
    }));

  it("fails with ConfigParseError for malformed config JSON", () =>
    withTempHome(async (home) => {
      await writeFile(`${home}/config.json`, "{not-json", "utf8");

      await expect(
        Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* ConfigService;
            return yield* service.get;
          }).pipe(Effect.provide(ConfigLayer)),
        ),
      ).rejects.toMatchObject({ _tag: "ConfigParseError" });
    }));
});
