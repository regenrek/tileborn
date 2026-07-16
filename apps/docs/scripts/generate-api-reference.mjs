import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { starlightFrontmatter } from "./lib/sanitize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsAppRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(docsAppRoot, "../..");
const referenceRoot = path.join(docsAppRoot, "src/content/docs/reference");

/** @type {ReadonlyArray<{ readonly id: string; readonly title: string; readonly entry: string; readonly description: string }>} */
const PUBLIC_PACKAGES = [
  {
    id: "core",
    title: "@tileborne/core",
    entry: "../../packages/core/src/index.ts",
    description: "Pure domain models, geometry, hashing, and shared utilities.",
  },
  {
    id: "runtime",
    title: "@tileborne/runtime",
    entry: "../../packages/runtime/src/index.ts",
    description: "Renderer-agnostic game runtime SDK with Pixi adapter defaults.",
  },
  {
    id: "game-sdk",
    title: "@tileborne/game-sdk",
    entry: "../../packages/game-sdk/src/index.ts",
    description: "Native TypeScript gameplay behavior API, deterministic context, references, and test harness.",
  },
  {
    id: "plugin-api",
    title: "@tileborne/plugin-api",
    entry: "../../packages/plugin-api/src/index.ts",
    description: "Plugin manifest schema, contribution points, and registry types.",
  },
  {
    id: "ipc-contracts",
    title: "@tileborne/ipc-contracts",
    entry: "../../packages/ipc-contracts/src/index.ts",
    description: "Effect Schema IPC channel definitions for the desktop shell.",
  },
  {
    id: "cli",
    title: "@tileborne/cli",
    entry: "../../packages/cli/src/main.ts",
    description: "Tileborne platform CLI entrypoint and command modules.",
  },
];

const addFrontmatterToMarkdownFiles = (directory, title, description) => {
  const files = fs.readdirSync(directory, { withFileTypes: true });
  for (const entry of files) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      addFrontmatterToMarkdownFiles(entryPath, title, description);
      continue;
    }
    if (!entry.name.endsWith(".md")) {
      continue;
    }

    const raw = fs.readFileSync(entryPath, "utf8");
    if (raw.startsWith("---")) {
      continue;
    }

    const pageTitle = entry.name === "README.md" ? title : entry.name.replace(/\.md$/, "");
    const frontmatter = starlightFrontmatter({
      title: pageTitle,
      description,
    });
    fs.writeFileSync(entryPath, `${frontmatter}${raw}`, "utf8");
  }
};

const generatePackageReference = (pkg) => {
  const outDir = path.join(referenceRoot, pkg.id);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const typedocBin = path.join(repoRoot, "node_modules/typedoc/bin/typedoc");
  if (!fs.existsSync(typedocBin)) {
    throw new Error(`TypeDoc binary not found at ${typedocBin}. Run pnpm install in the monorepo root.`);
  }

  const args = [
    typedocBin,
    pkg.entry,
    "--out",
    outDir,
    "--plugin",
    "typedoc-plugin-markdown",
    "--tsconfig",
    path.join(repoRoot, "tsconfig.base.json"),
    "--readme",
    "none",
    "--disableSources",
    "--excludeExternals",
    "--excludeInternal",
    "--excludeReferences",
    "--hideBreadcrumbs",
    "--hidePageTitle",
    "--outputFileStrategy",
    "modules",
    "--fileExtension",
    ".md",
    "--skipErrorChecking",
  ];

  const result = spawnSync(process.execPath, args, {
    cwd: docsAppRoot,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(
      `TypeDoc failed for ${pkg.title}:\n${result.stderr || result.stdout || "unknown error"}`,
    );
  }

  const indexPath = path.join(outDir, "index.md");
  const readmePath = path.join(outDir, "README.md");
  if (!fs.existsSync(indexPath) && fs.existsSync(readmePath)) {
    fs.renameSync(readmePath, indexPath);
  }

  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(
      indexPath,
      `${starlightFrontmatter({ title: pkg.title, description: pkg.description })}# ${pkg.title}\n\n${pkg.description}\n`,
      "utf8",
    );
  } else {
    const raw = fs.readFileSync(indexPath, "utf8");
    fs.writeFileSync(
      indexPath,
      `${starlightFrontmatter({ title: pkg.title, description: pkg.description })}# ${pkg.title}\n\n${pkg.description}\n\n${raw.replace(/^---[\s\S]*?---\n?/, "")}`,
      "utf8",
    );
  }

  addFrontmatterToMarkdownFiles(outDir, pkg.title, pkg.description);
};

export const generateApiReference = () => {
  fs.mkdirSync(referenceRoot, { recursive: true });

  for (const pkg of PUBLIC_PACKAGES) {
    generatePackageReference(pkg);
  }

  const indexBody = `# API Reference

Generated TypeDoc reference for public Tileborne packages.

| Package | Description |
| --- | --- |
${PUBLIC_PACKAGES.map((pkg) => `| [${pkg.title}](/reference/${pkg.id}/) | ${pkg.description} |`).join("\n")}
`;

  fs.writeFileSync(
    path.join(referenceRoot, "index.md"),
    `${starlightFrontmatter({
      title: "API Reference",
      description: "Generated API reference for public Tileborne packages.",
    })}${indexBody}`,
    "utf8",
  );
};

if (import.meta.url === `file://${process.argv[1]}`) {
  generateApiReference();
}
