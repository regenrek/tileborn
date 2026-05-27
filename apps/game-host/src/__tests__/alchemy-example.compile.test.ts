import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const configPath = path.join(packageRoot, "tsconfig.alchemy.example.json");

const loadCompilerOptions = (): ts.CompilerOptions => {
  const configFile = ts.readConfigFile(configPath, (filePath) => readFileSync(filePath, "utf8"));
  if (configFile.error) {
    throw new Error(ts.formatDiagnostic(configFile.error, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => packageRoot,
      getNewLine: () => "\n",
    }));
  }

  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, packageRoot, undefined, configPath);
  if (parsed.errors.length > 0) {
    const host = {
      getCanonicalFileName: (fileName: string) => fileName,
      getCurrentDirectory: () => packageRoot,
      getNewLine: () => "\n",
    };
    throw new Error(
      parsed.errors.map((error) => ts.formatDiagnostic(error, host)).join("\n"),
    );
  }

  return parsed.options;
};

describe("alchemy.example.run.ts compile contract", () => {
  it("typechecks without executing the alchemy stack", () => {
    const options = loadCompilerOptions();
    const examplePath = path.join(packageRoot, "alchemy.example.run.ts");
    const program = ts.createProgram([examplePath], options);
    const diagnostics = ts.getPreEmitDiagnostics(program);

    expect(
      diagnostics.map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      ),
    ).toEqual([]);
  });
});
