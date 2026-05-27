import { readFile, stat, symlink } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { HomeServiceLive, JobServiceLive } from "@tileborne/services-foundation";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { SupportService, SupportServiceLive } from "../index.js";
import { withTempHome } from "../../test-utils.js";

const supportLayer = SupportServiceLive.pipe(Layer.provideMerge(Layer.mergeAll(HomeServiceLive, JobServiceLive)));

const runSupport = <A, E>(effect: Effect.Effect<A, E, SupportService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(supportLayer)));

const writeBundle = (destPath: string) =>
  SupportService.pipe(Effect.flatMap((support) => support.writeBundle(destPath)));

describe("SupportService writeBundle path security", () => {
  it("writeBundle creates a tarball under the tileborne home root", () =>
    withTempHome(async (home) => {
      const destPath = "exports/support.tar.gz";
      await runSupport(writeBundle(destPath));
      const archivePath = path.join(home, destPath);
      const info = await stat(archivePath);
      expect(info.size).toBeGreaterThan(0);
      const header = await readFile(archivePath);
      expect(header[0]).toBe(0x1f);
      expect(header[1]).toBe(0x8b);
    }));

  it("writeBundle rejects traversal destinations", () =>
    withTempHome(async () => {
      const error = await runSupport(writeBundle("../../etc/passwd")).catch((cause) => cause);

      expect(error).toMatchObject({
        _tag: "ServicesBuildError",
        message: expect.stringContaining("Path traversal is not allowed"),
      });
    }));

  it("writeBundle rejects symlink destinations outside the tileborne home root", () =>
    withTempHome(async (home) => {
      const outsideDir = await mkdtemp(path.join(tmpdir(), "tileborne-support-outside-"));
      await symlink(outsideDir, path.join(home, "escape-link"), "dir");

      const error = await runSupport(writeBundle("escape-link/support.tar.gz")).catch((cause) => cause);

      expect(error).toMatchObject({
        _tag: "ServicesBuildError",
        message: expect.stringMatching(/Symlink escapes root|Path traversal is not allowed/),
      });
    }));
});
