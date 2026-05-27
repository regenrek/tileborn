import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { starlightFrontmatter } from "./lib/sanitize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsAppRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(docsAppRoot, "../..");
const cliEntry = path.join(repoRoot, "packages/cli/dist/main.js");
const outputPath = path.join(docsAppRoot, "src/content/docs/cli/index.md");

const TOP_LEVEL_COMMANDS = [
  "doctor",
  "home",
  "config",
  "project",
  "plugin",
  "asset",
  "map",
  "playtest",
  "runtime",
  "game",
  "dev",
  "test",
  "logs",
  "support",
];

const runHelp = (args) => {
  const result = spawnSync(process.execPath, [cliEntry, ...args, "--help"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });

  if (result.status !== 0) {
    const message = result.stderr || result.stdout || `help failed for tileborne ${args.join(" ")}`;
    throw new Error(message.trim());
  }

  return result.stdout.trim();
};

const fenced = (text) => `\`\`\`text\n${text}\n\`\`\`\n`;

export const generateCliReference = () => {
  if (!fs.existsSync(cliEntry)) {
    throw new Error(
      `CLI entry not found at ${cliEntry}. Build @tileborne/cli before generating CLI reference.`,
    );
  }

  const sections = [
    "# CLI Reference",
    "",
    "The `tileborne` CLI shares the same Effect service graph as the Electron main process.",
    "",
    "## Global help",
    "",
    fenced(runHelp([])),
    "## Commands",
    "",
  ];

  for (const command of TOP_LEVEL_COMMANDS) {
    sections.push(`### \`tileborne ${command}\``, "", fenced(runHelp([command])), "");
  }

  const frontmatter = starlightFrontmatter({
    title: "CLI Reference",
    description: "Generated reference from the tileborne CLI --help output.",
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${frontmatter}${sections.join("\n")}`, "utf8");
};

if (import.meta.url === `file://${process.argv[1]}`) {
  generateCliReference();
}
