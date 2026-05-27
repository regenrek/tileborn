import { describe, expect, it } from "vitest";

import { ExitCode } from "./exit-codes.js";
import { CliUsageError, CliValidationError, mapErrorToExitCode } from "./errors.js";
import { ProjectNotFoundError, ProjectPathNotFoundError, ProjectSlugInvalidError } from "@tileborne/services-app";
import { ConfigParseError } from "@tileborne/services-foundation";
import { PluginIntegrityError, PluginResolveError } from "@tileborne/services-plugin";

describe("mapErrorToExitCode", () => {
  it("maps usage errors to EX_USAGE", () => {
    expect(mapErrorToExitCode(new CliUsageError({ message: "bad args" }))).toBe(ExitCode.Usage);
    expect(mapErrorToExitCode(new CliValidationError({ message: "bad value" }))).toBe(ExitCode.Usage);
    expect(
      mapErrorToExitCode(new ProjectSlugInvalidError({ slug: "Bad", message: "invalid slug" })),
    ).toBe(ExitCode.Usage);
  });

  it("maps missing project to EX_NOINPUT", () => {
    expect(
      mapErrorToExitCode(new ProjectNotFoundError({ projectId: "project:550e8400-e29b-41d4-a716-446655440000" as never, message: "missing" })),
    ).toBe(ExitCode.NoInput);
    expect(
      mapErrorToExitCode(new ProjectPathNotFoundError({ path: "/tmp/x", message: "missing" })),
    ).toBe(ExitCode.NoInput);
  });

  it("maps config parse failures to EX_CONFIG", () => {
    expect(
      mapErrorToExitCode(new ConfigParseError({ path: "/tmp/config.json", message: "parse" })),
    ).toBe(ExitCode.Config);
  });

  it("maps plugin integrity failures to EX_DATAERR", () => {
    expect(
      mapErrorToExitCode(new PluginIntegrityError({ path: "/tmp", message: "integrity mismatch" })),
    ).toBe(ExitCode.DataErr);
  });

  it("maps plugin resolve failures to EX_TEMPFAIL", () => {
    expect(
      mapErrorToExitCode(new PluginResolveError({ source: "https://example.invalid", message: "network" })),
    ).toBe(ExitCode.TempFail);
  });

  it("maps unknown errors to generic failure", () => {
    expect(mapErrorToExitCode(new Error("boom"))).toBe(ExitCode.Generic);
  });
});

describe("exit code labels", () => {
  it("uses sysexits-aligned constants", () => {
    expect(ExitCode.Ok).toBe(0);
    expect(ExitCode.Usage).toBe(64);
    expect(ExitCode.NoInput).toBe(66);
    expect(ExitCode.IoErr).toBe(74);
    expect(ExitCode.Config).toBe(78);
  });
});
