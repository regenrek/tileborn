import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sanitizePublicDocs, starlightFrontmatter } from "./lib/sanitize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsAppRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(docsAppRoot, "../..");
const adrsSourceDir = path.join(repoRoot, "docs/adrs");
const adrsTargetDir = path.join(docsAppRoot, "src/content/docs/adrs");

const parseAdrMeta = (filename, content) => {
  const titleMatch = content.match(/^#\s+ADR-\d+:\s*(.+)$/m);
  const statusMatch = content.match(/^-\s+Status:\s*(.+)$/m);
  return {
    slug: filename.replace(/\.md$/, ""),
    title: titleMatch?.[1]?.trim() ?? filename,
    status: statusMatch?.[1]?.trim() ?? "Unknown",
  };
};

const buildIndexBody = (entries) => {
  const rows = entries
    .map((entry) => {
      const id = entry.slug.split("-")[0]?.toUpperCase() ?? entry.slug;
      return `| [${id}](/adrs/${entry.slug}/) | ${entry.title} | ${entry.status} |`;
    })
    .join("\n");

  return `# Architecture Decision Records

Tileborne architecture decisions in MADR-lite format.

| ADR | Title | Status |
| --- | --- | --- |
${rows}

## Conventions

- Filename: \`NNNN-kebab-case-title.md\`
- Status: \`Accepted\` | \`Proposed\` | \`Superseded\` | \`Deprecated\`
`;
};

export const generateAdrs = () => {
  fs.mkdirSync(adrsTargetDir, { recursive: true });

  const adrFiles = fs
    .readdirSync(adrsSourceDir)
    .filter((name) => /^\d{4}-.+\.md$/.test(name))
    .sort();

  const entries = [];

  for (const filename of adrFiles) {
    const sourcePath = path.join(adrsSourceDir, filename);
    const raw = fs.readFileSync(sourcePath, "utf8");
    const meta = parseAdrMeta(filename, raw);
    entries.push(meta);

    const slug = meta.slug;
    const frontmatter = starlightFrontmatter({
      title: meta.title,
      description: `ADR ${slug.split("-")[0]} — ${meta.status}`,
      sidebar: { label: slug.split("-")[0] },
    });

    const targetPath = path.join(adrsTargetDir, `${slug}.md`);
    fs.writeFileSync(targetPath, `${frontmatter}${sanitizePublicDocs(raw)}`, "utf8");
  }

  const indexFrontmatter = starlightFrontmatter({
    title: "Architecture Decisions",
    description: "Index of Tileborne architecture decision records.",
  });
  fs.writeFileSync(
    path.join(adrsTargetDir, "index.md"),
    `${indexFrontmatter}${buildIndexBody(entries)}`,
    "utf8",
  );
};

if (import.meta.url === `file://${process.argv[1]}`) {
  generateAdrs();
}
