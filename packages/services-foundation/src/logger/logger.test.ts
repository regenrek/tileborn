import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";

import { ConfigService, LoggerLayer, LoggerService } from "../index.js";
import { withTempHome } from "../test-utils.js";

describe("LoggerService", () => {
  it("writes structured JSON lines to the daily log file", () =>
    withTempHome(async (home) => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const logger = yield* LoggerService;
          yield* logger.info("hello", { feature: "logger-test" });
        }).pipe(Effect.provide(LoggerLayer)),
      );

      const today = new Date().toISOString().slice(0, 10);
      const line = (await readFile(path.join(home, "logs", `tileborne-${today}.log`), "utf8")).trim();
      expect(JSON.parse(line)).toMatchObject({
        level: "info",
        msg: "hello",
        fields: { feature: "logger-test" },
      });
    }));

  it("filters messages below the configured level", () =>
    withTempHome(async (home) => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const config = yield* ConfigService;
          const logger = yield* LoggerService;
          yield* config.set({ loggerLevel: "error" });
          yield* logger.debug("skip-me");
          yield* logger.error("keep-me");
        }).pipe(Effect.provide(LoggerLayer)),
      );

      const today = new Date().toISOString().slice(0, 10);
      const contents = await readFile(path.join(home, "logs", `tileborne-${today}.log`), "utf8");
      expect(contents).not.toContain("skip-me");
      expect(contents).toContain("keep-me");
    }));

  it("keeps exactly the seven newest files after writing the rollover day", () =>
    withTempHome(async (home) => {
      const logs = path.join(home, "logs");
      await mkdir(logs, { recursive: true });

      vi.useFakeTimers();
      try {
        for (let day = 1; day <= 8; day += 1) {
          vi.setSystemTime(new Date(`2026-05-${String(day).padStart(2, "0")}T00:00:00.000Z`));
          await Effect.runPromise(
            Effect.gen(function* () {
              const logger = yield* LoggerService;
              yield* logger.info(`day-${day}`);
            }).pipe(Effect.provide(LoggerLayer)),
          );
        }

        const files = (await readdir(logs)).filter((entry) => entry.startsWith("tileborne-")).sort();
        expect(files).toEqual([
          "tileborne-2026-05-02.log",
          "tileborne-2026-05-03.log",
          "tileborne-2026-05-04.log",
          "tileborne-2026-05-05.log",
          "tileborne-2026-05-06.log",
          "tileborne-2026-05-07.log",
          "tileborne-2026-05-08.log",
        ]);
      } finally {
        vi.useRealTimers();
      }
    }));

  it("serializes concurrent writes before pruning rotated files", () =>
    withTempHome(async (home) => {
      const logs = path.join(home, "logs");
      await mkdir(logs, { recursive: true });
      const today = new Date();
      const priorDates = Array.from({ length: 8 }, (_, index) => {
        const date = new Date(today);
        date.setUTCDate(today.getUTCDate() - (8 - index));
        return date.toISOString().slice(0, 10);
      });
      for (let day = 1; day <= 8; day += 1) {
        await writeFile(path.join(logs, `tileborne-${priorDates[day - 1]}.log`), "{}\n", "utf8");
      }

      await Effect.runPromise(
        Effect.gen(function* () {
          const logger = yield* LoggerService;
          yield* Effect.all(
            Array.from({ length: 10 }, (_, index) => logger.info(`concurrent-${index}`)),
            { concurrency: "unbounded", discard: true },
          );
        }).pipe(Effect.provide(LoggerLayer)),
      );

      const keptDates = [...priorDates.slice(2), today.toISOString().slice(0, 10)].sort();
      const files = (await readdir(logs)).filter((entry) => entry.startsWith("tileborne-")).sort();
      expect(files).toEqual(keptDates.map((date) => `tileborne-${date}.log`));
    }));

  it("writes info output to stderr without writing stdout", () =>
    withTempHome(async () => {
      let stderr = "";
      let stdout = "";
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk, encodingOrCallback, callback) => {
        stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
        const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
        done?.();
        return true;
      }) as typeof process.stderr.write);
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk, encodingOrCallback, callback) => {
        stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
        const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
        done?.();
        return true;
      }) as typeof process.stdout.write);

      try {
        await Effect.runPromise(
          Effect.gen(function* () {
            const logger = yield* LoggerService;
            yield* logger.info("hi");
          }).pipe(Effect.provide(LoggerLayer)),
        );
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(stderr).toContain("hi");
        expect(stdout).toBe("");
      } finally {
        stderrSpy.mockRestore();
        stdoutSpy.mockRestore();
      }
    }));
});
