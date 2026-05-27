import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sanitizePublicDocs, starlightFrontmatter } from "./lib/sanitize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsAppRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(docsAppRoot, "../..");
const contentRoot = path.join(docsAppRoot, "src/content/docs");

const writeDoc = (relativePath, frontmatter, body) => {
  const outputPath = path.join(contentRoot, relativePath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${frontmatter}${sanitizePublicDocs(body)}`, "utf8");
};

const copySpecDoc = ({ sourceRelative, targetRelative, title, description, sidebar }) => {
  const sourcePath = path.join(repoRoot, sourceRelative);
  const raw = fs.readFileSync(sourcePath, "utf8");
  const body = raw.replace(/^#\s+[^\n]+\n+/m, "");
  writeDoc(
    targetRelative,
    starlightFrontmatter({ title, description, sidebar }),
    `# ${title}\n\n${body}`,
  );
};

const syncRuntimeGuide = () => {
  copySpecDoc({
    sourceRelative: "docs/03-runtime-game-host.md",
    targetRelative: "runtime/index.md",
    title: "Runtime & Game Host",
    description: "Cloudflare Workers game host, Durable Objects rooms, and runtime SDK integration.",
    sidebar: { label: "Runtime & Game Host" },
  });
};

const syncFollowUps = () => {
  const sourcePath = path.join(repoRoot, "docs/follow-ups.md");
  const raw = fs.readFileSync(sourcePath, "utf8");
  const body = raw.replace(/^#\s+Follow-ups\n+/m, "");
  writeDoc(
    "follow-ups/index.md",
    starlightFrontmatter({
      title: "Follow-ups",
      description: "Deferred work tracked outside the current release scope.",
    }),
    `# Follow-ups\n\n${body}`,
  );
};

const syncEditorUxGuide = () => {
  const body = `# Editor UX

Tileborne ships a desktop-first map editor built with React, Electron, and PixiJS. The editor shell is brand-neutral OSS; product-specific branding and curated asset packs are injected at build time by private downstream repos.

## Design goals

- Tilemap-focused level editing with asset browser, Pixi viewport, tool dock, minimap, layered overlays, and generator dialogs.
- Strict main / preload / renderer separation: privileged work runs in Electron main via typed IPC only.
- Plugin-driven UI via declarative contribution points (palettes, inspectors, overlays, validators, exporters, generators).
- Phase A forbids executable plugin code in the renderer; contributions are JSON/metadata rendered by \`@tileborne/ui\`.

## Shell layout

| Region | Purpose |
| --- | --- |
| Top bar | Project context, save state, playtest entry, command palette |
| Left sidebar | Asset library, layer tree, plugin-provided tabs |
| Center viewport | Pixi map canvas with pan/zoom, tile/object tools |
| Right inspector | Selection properties, plugin inspector panels |
| Bottom drawer | Logs, build output, diagnostics |

## Tooling model

Tools (paint, erase, fill, select, object placement) share a single viewport controller. Keyboard shortcuts and the command palette route through the same command registry so plugins can register declarative commands without renderer executables.

## Plugin contributions

Plugins extend the editor through manifest-declared contribution points:

- \`paletteCategories\` — asset browser groupings
- \`inspectorPanels\` — selection-side property editors
- \`overlays\` — non-destructive viewport layers
- \`validators\` / \`exporters\` — map lint and export pipelines
- \`generators\` — procedural fill dialogs

See [Plugins](/plugins/) and [ADR-0001](/adrs/0001-plugin-ui-model-declarative-first/) for the declarative-first trust model.

## Related specs

- [Architecture](/architecture/) — package map and process boundaries
- [Runtime & Game Host](/runtime/) — playtest and cloud deploy flow
- Internal UX source spec: \`docs/02-editor-ux.md\` in the monorepo (reference-only; not published verbatim to keep OSS docs brand-neutral)
`;

  writeDoc(
    "editor-ux/index.md",
    starlightFrontmatter({
      title: "Editor UX",
      description: "Desktop editor shell layout, tooling model, and plugin contribution points.",
    }),
    body,
  );
};

export const syncContent = () => {
  syncRuntimeGuide();
  syncFollowUps();
  syncEditorUxGuide();
};

if (import.meta.url === `file://${process.argv[1]}`) {
  syncContent();
}
