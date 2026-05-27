import path from "node:path";
import { access, readFile } from "node:fs/promises";

import { beforeAll, describe, expect, it } from "vitest";

import { sampleAssetPackFixture, cliEntrypoint } from "./helpers/paths.js";
import { runCli } from "./helpers/run-cli.js";
import { makeTempDir, registerE2eHomeHooks, tileborneHome } from "./helpers/temp-home.js";

interface SweepResult {
  readonly commandsSwept: readonly string[];
}

const sweepResult: SweepResult = {
  commandsSwept: [],
};

const recordSweep = (command: string): void => {
  sweepResult.commandsSwept = [...sweepResult.commandsSwept, command];
};

const assertOkJson = (
  stdout: string,
  assertData?: (data: Record<string, unknown>) => void,
): Record<string, unknown> => {
  const payload = JSON.parse(stdout) as {
    readonly ok: boolean;
    readonly data?: Record<string, unknown>;
  };
  expect(payload.ok).toBe(true);
  if (assertData && payload.data) {
    assertData(payload.data);
  }
  return payload.data ?? {};
};

describe.sequential("CLI spec §12 sweep e2e", () => {
  registerE2eHomeHooks();

  beforeAll(async () => {
    await access(cliEntrypoint);
  });

  it(
    "chains doctor → project init → asset import → map generate → playtest in tmp HOME",
    async () => {
    const projectDir = makeTempDir("tileborne-cli-e2e-spec12-project-");
    const projectSlug = "my-test";

    const doctor = await runCli(["doctor"], { json: true });
    expect(doctor.code).toBe(0);
    const doctorPayload = JSON.parse(doctor.stdout) as {
      readonly ok: boolean;
      readonly checks: readonly { readonly id: string }[];
    };
    expect(doctorPayload.ok).toBe(true);
    expect(doctorPayload.checks.length).toBeGreaterThan(0);
    recordSweep("doctor --json");

    const init = await runCli(["project", "init", projectSlug, "--here"], {
      json: true,
      cwd: projectDir,
    });
    expect(init.code).toBe(0);
    assertOkJson(init.stdout, (data) => {
      const manifest = data["manifest"] as { readonly id: string; readonly name: string };
      expect(manifest.name).toBe(projectSlug);
      expect(manifest.id).toMatch(/^project:/);
    });
    await expect(access(path.join(projectDir, "project.json"))).resolves.toBeUndefined();
    recordSweep("project init my-test --here --json");

    const assetImport = await runCli(
      ["asset", "import", sampleAssetPackFixture, "--project", projectSlug],
      { json: true },
    );
    expect(assetImport.code).toBe(0);
    assertOkJson(assetImport.stdout, (data) => {
      expect(data["packId"]).toMatch(/^pack:/);
      expect(data["project"]).toBe(projectSlug);
    });
    const packsDir = path.join(tileborneHome(), "assets", "packs");
    const { readdir } = await import("node:fs/promises");
    const installed = await readdir(packsDir);
    expect(installed.some((entry) => entry.includes("550e8400"))).toBe(true);
    const packManifest = JSON.parse(await readFile(path.join(sampleAssetPackFixture, "tileborne-asset-pack.json"), "utf8")) as {
      readonly name: string;
    };
    expect(packManifest.name).toBe("Smoke Pack");
    recordSweep("asset import --project my-test");

    const mapBrief = await runCli(
      [
        "map",
        "generate",
        "--project",
        projectSlug,
        "--preset",
        "dungeon",
        "--width",
        "32",
        "--height",
        "32",
      ],
      { json: true, cwd: projectDir },
    );
    expect(mapBrief.code).toBe(0);
    const mapData = assertOkJson(mapBrief.stdout, (payload) => {
      expect(payload["mapId"]).toMatch(/^map:/);
    });
    const mapId = mapData["mapId"] as string;
    recordSweep("map generate --project my-test --preset dungeon --width 32 --height 32 --json");

    expect(mapId).toMatch(/^map:/);

    const playtestBrief = await runCli(
      ["playtest", mapId as string, "--project", projectSlug, "--duration", "0.5"],
      {
        json: true,
        cwd: projectDir,
      },
    );
    expect(playtestBrief.code).toBe(0);
    assertOkJson(playtestBrief.stdout, (payload) => {
      const stats = payload["stats"] as { readonly ticks: number };
      expect(stats.ticks).toBeGreaterThan(0);
    });
    recordSweep("playtest <mapId> --project my-test --json");

    expect(sweepResult.commandsSwept).toEqual([
      "doctor --json",
      "project init my-test --here --json",
      "asset import --project my-test",
      "map generate --project my-test --preset dungeon --width 32 --height 32 --json",
      "playtest <mapId> --project my-test --json",
    ]);
  },
  60_000,
  );
});

export const getSpecSection12SweepResult = (): SweepResult => sweepResult;
