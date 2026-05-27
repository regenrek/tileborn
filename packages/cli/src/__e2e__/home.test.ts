import { homedir } from "node:os";
import path from "node:path";
import { readFile, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { expectCliJsonData, runCli } from "./helpers/run-cli.js";
import { makeTempDir, registerE2eHomeHooks, tileborneHome } from "./helpers/temp-home.js";

const homePointer = path.join(homedir(), ".tileborne-home");
let savedPointer: string | undefined;

describe.sequential("home e2e", () => {
  registerE2eHomeHooks();

  afterEach(async () => {
    if (savedPointer === undefined) {
      await rm(homePointer, { force: true });
      return;
    }
    await writeFile(homePointer, savedPointer, "utf8");
    savedPointer = undefined;
  });

  it("home --json prints TILEBORNE_HOME contents", async () => {
    const data = await expectCliJsonData<{
      readonly home: string;
      readonly root: string;
      readonly entries: readonly string[];
    }>(["home"]);
    expect(data.home).toBe(tileborneHome());
    expect(data.root).toBe(tileborneHome());
    expect(data.entries.length).toBeGreaterThan(0);
  });

  it("home set persists and subsequent home reflects the configured path", async () => {
    try {
      savedPointer = await readFile(homePointer, "utf8");
    } catch {
      savedPointer = undefined;
    }

    const nextHome = makeTempDir("tileborne-cli-e2e-home-set-");
    const setResult = await runCli(["home", "set", nextHome], { json: true });
    expect(setResult.code).toBe(0);

    const config = await expectCliJsonData<{ readonly key: string; readonly value: { readonly _tag: string; readonly value: string } }>([
      "config",
      "get",
      "homePath",
    ]);
    expect(config.value._tag).toBe("Some");
    expect(config.value.value).toBe(nextHome);

    const home = await expectCliJsonData<{ readonly home: string; readonly root: string }>(["home"], {
      home: nextHome,
    });
    expect(home.home).toBe(nextHome);
    expect(home.root).toBe(nextHome);
  });
});
