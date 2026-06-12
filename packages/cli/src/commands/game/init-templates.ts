/**
 * Template data for `tileborne game init` (ADR-0009/ADR-0017 lane 3).
 *
 * The scaffold is the public "thin product repo" shape: a standalone game
 * project that consumes the Tileborne CLI + a mode plugin as EXTERNAL
 * dependencies and owns only content (assets/maps), brand (branding/), plugin
 * selection (plugins/), deploy config (deploy/), and build orchestration
 * (scripts/). It must never contain engine or gameplay source code.
 *
 * Templates are kept as plain template-literal modules (not on-disk asset
 * files) so they ship through the package's plain `tsc` build with no extra
 * asset-copy step.
 */

export interface GameTemplateOptions {
  /**
   * Project / package name (also used as the brand title and as the default
   * Tileborne project slug the build scripts bake maps from).
   */
  readonly name: string;
  /** Plugin id of the game-mode plugin the product ships (npm package name). */
  readonly pluginId: string;
}

/**
 * Default game-mode plugin a scaffold ships when `--plugin` is omitted. This
 * literal is CLI template DATA (the thin product repo names its shipped
 * plugin) — engine packages stay plugin-neutral and never read it.
 */
export const DEFAULT_GAME_PLUGIN_ID = "@tileborne-plugins/battle-royale";

/** Top-level directories of the thin product repo shape. */
export const TEMPLATE_DIRECTORIES = [
  "branding",
  "assets",
  "maps",
  "plugins",
  "deploy",
  "scripts",
] as const;

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

export const renderPackageJson = ({ name, pluginId }: GameTemplateOptions): string =>
  json({
    name,
    version: "0.1.0",
    private: true,
    type: "module",
    scripts: {
      build: "node scripts/build.mjs",
      serve: 'tileborne game serve --dir "dist/game"',
      deploy: "node scripts/deploy.mjs",
    },
    devDependencies: {
      "@tileborne/cli": "latest",
      [pluginId]: "latest",
      wrangler: "^4.0.0",
    },
  });

/**
 * `tileborne.config.json` — the ONE place the product repo names the
 * Tileborne project whose maps the build bakes into the artifact. Both
 * `scripts/build.mjs` and (via it) `scripts/deploy.mjs` read it, so a build
 * never silently ships zero maps. `maps` optionally narrows the bundled maps
 * (empty = all project maps).
 */
export const renderTileborneConfig = ({ name }: GameTemplateOptions): string =>
  json({
    project: name,
    maps: [],
  });

/**
 * `branding/tokens.json` — must stay decodable by the brand-neutral
 * `BrandConfig` schema in `@tileborne/core` (ADR-0022).
 */
export const renderBrandingTokens = ({ name, pluginId }: GameTemplateOptions): string =>
  json({
    schemaVersion: 1,
    title: name,
    palette: {
      background: "#0b0d12",
      surface: "#161a22",
      accent: "#4f8cff",
      accentHostile: "#ff5a5a",
      accentFriendly: "#52d273",
      textPrimary: "#f2f4f8",
      textMuted: "#9aa3b2",
    },
    lobbyCopy: {
      tagline: "Your game, your maps, your brand.",
      cta: "Play now",
    },
    servers: {
      plugin: pluginId,
    },
  });

export const renderGitignore = (): string =>
  `node_modules/
dist/
.wrangler/
*.log
.env
.env.*
`;

export const renderBuildScript = ({ pluginId }: GameTemplateOptions): string =>
  `#!/usr/bin/env node
// Build orchestration: bake the Tileborne project's maps (named by
// tileborne.config.json) and the ${pluginId} plugin into the deployable
// Cloudflare worker artifact. No engine logic lives here.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const config = JSON.parse(
  readFileSync(new URL("../tileborne.config.json", import.meta.url), "utf8"),
);
if (typeof config.project !== "string" || config.project.length === 0) {
  console.error(
    'tileborne.config.json must set "project" to the Tileborne project whose maps this game ships' +
      " (create one with \`tileborne project init\`).",
  );
  process.exit(1);
}

const args = [
  "game",
  "build",
  "--plugin",
  "${pluginId}",
  "--target",
  "cloudflare",
  "--out",
  "dist/game",
  "--project",
  config.project,
];
for (const mapId of Array.isArray(config.maps) ? config.maps : []) {
  args.push("--map", mapId);
}

const result = spawnSync("tileborne", args, {
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
`;

export const renderDeployScript = (): string =>
  `#!/usr/bin/env node
// Deploy orchestration: build the Cloudflare worker artifact (scripts/build.mjs),
// verify the HANDOFF_SIGNING_KEY secret, then publish it with wrangler. No
// engine logic lives here.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const WRANGLER_CONFIG = "dist/game/wrangler.toml";
const shell = process.platform === "win32";

const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: "inherit", shell });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

// HANDOFF_SIGNING_KEY is a SECRET — the generated wrangler.toml deliberately
// carries no plaintext key, and the deployed worker refuses to create rooms
// without a real one (it also rejects the known placeholder value).
const assertHandoffSecret = () => {
  const list = spawnSync("wrangler", ["secret", "list", "--config", WRANGLER_CONFIG], {
    encoding: "utf8",
    shell,
  });
  const instruction =
    "  wrangler secret put HANDOFF_SIGNING_KEY --config " + WRANGLER_CONFIG;
  if (list.status !== 0) {
    console.warn(
      "warning: could not verify the HANDOFF_SIGNING_KEY secret (is this the first deploy?). " +
        "If it is not set yet, set it (>= 32 random characters) with:\\n" + instruction,
    );
    return;
  }
  if (!String(list.stdout).includes("HANDOFF_SIGNING_KEY")) {
    console.error(
      "HANDOFF_SIGNING_KEY secret is not set — the deployed worker would refuse to create rooms.\\n" +
        "Set it (>= 32 random characters), then re-run deploy:\\n" + instruction,
    );
    process.exit(1);
  }
};

run("node", [fileURLToPath(new URL("./build.mjs", import.meta.url))]);
assertHandoffSecret();
run("wrangler", ["deploy", "--config", WRANGLER_CONFIG]);
`;

export const renderReadme = ({ name, pluginId }: GameTemplateOptions): string =>
  `# ${name}

A standalone Tileborne game project. This repository is a **thin consumer**:
it owns content, branding, plugin selection, and deploy configuration. All
engine and gameplay logic stays in the external \`@tileborne/cli\` and the
\`${pluginId}\` plugin — never add engine source code here.

## Layout

| Path                    | Owns                                                           |
| ----------------------- | -------------------------------------------------------------- |
| \`branding/\`             | Brand tokens (\`tokens.json\`), logo, copy                       |
| \`assets/\`               | Your asset packs (imported via \`tileborne asset import\`)       |
| \`maps/\`                 | Authored maps exported from the Tileborne editor                |
| \`plugins/\`              | Plugin selection / locally installed plugin builds              |
| \`deploy/\`               | Cloudflare deploy configuration and notes                       |
| \`scripts/\`              | Build/deploy orchestration (composition only, no engine code)   |
| \`tileborne.config.json\` | The Tileborne project (and optional map ids) the build ships    |

## Workflow: author → build → deploy → play

1. **Author** — create maps and assets with the Tileborne editor or CLI
   (\`tileborne project init\`, \`tileborne map generate\`,
   \`tileborne asset import\`). Keep exported maps in \`maps/\` and asset packs
   in \`assets/\`. Point \`tileborne.config.json\`'s \`project\` at that Tileborne
   project (the scaffold defaults it to \`${name}\`); list map ids under
   \`maps\` to ship a subset (empty = all project maps).
2. **Build** — \`npm run build\` runs \`scripts/build.mjs\`, which reads
   \`tileborne.config.json\` and runs
   \`tileborne game build --plugin ${pluginId} --target cloudflare --out dist/game --project <project>\`,
   baking the runtime map packages, assets, plugin, and worker into a
   deployable artifact (including a generated \`dist/game/wrangler.toml\`).
   A build that bundles zero maps cannot create rooms once deployed.
3. **Deploy** — \`npm run deploy\` rebuilds, verifies the
   \`HANDOFF_SIGNING_KEY\` secret is configured (set it once with
   \`wrangler secret put HANDOFF_SIGNING_KEY --config dist/game/wrangler.toml\`),
   and runs \`wrangler deploy --config dist/game/wrangler.toml\`. See
   \`deploy/README.md\` for the required bindings.
4. **Play** — share \`https://<worker-host>/\`; two or more clients can join a
   match. Check \`https://<worker-host>/health\` and \`/discover\` after deploy.

## Local development

- \`npm run build\` then \`npm run serve\` —
  \`tileborne game serve --dir "dist/game"\` boots the built artifact (the same
  worker + bundled maps you deploy) on a local game-host.

## Notes

- Scaffolded by \`tileborne game init\`. An \`npm create tileborne-game\`
  wrapper is planned but deferred until the CLI is published to npm; until
  then, \`tileborne game init\` is the canonical entry point.
`;

export const renderDeployReadme = (): string =>
  `# Deploy

\`tileborne game build --target cloudflare\` generates a ready-to-use
\`wrangler.toml\` inside the build output (\`dist/game/wrangler.toml\`), so this
directory holds deploy configuration and notes rather than a hand-maintained
wrangler config.

Required Cloudflare bindings (provisioned by the generated config / your stack):

| Binding                     | Type                     | Notes                                  |
| --------------------------- | ------------------------ | -------------------------------------- |
| \`PLAYTEST_ROOM\`             | Durable Object namespace | Class \`PlaytestRoom\`, SQLite-backed    |
| \`HANDOFF_SIGNING_KEY\`       | Secret                   | >= 32 chars; signs WebSocket handoffs  |
| \`ROOM_IDLE_TIMEOUT_SECONDS\` | Var (optional)           | Default \`60\`                           |

\`HANDOFF_SIGNING_KEY\` is a SECRET: the generated \`wrangler.toml\` never
contains a plaintext key, and the worker rejects missing, short, and
known-placeholder keys. Set it once before the first deploy:

\`\`\`sh
wrangler secret put HANDOFF_SIGNING_KEY --config dist/game/wrangler.toml
\`\`\`

\`scripts/deploy.mjs\` checks for the secret and refuses to deploy without it.

For infrastructure-as-code stacks (Alchemy), copy the reference graph from the
Tileborne docs ("Cloudflare Deploy") into this directory and point it at
\`dist/game/worker.js\`.
`;

export const renderAssetsReadme = (): string =>
  `# Assets

Source asset packs for this game. Import them into your local Tileborne home
with \`tileborne asset import <pack-dir>\` so \`tileborne game build\` can bake
them into the deployable artifact (\`--asset-pack <pack-id>\`).
`;

export const renderMapsReadme = (): string =>
  `# Maps

Authored maps for this game. Author them in the Tileborne editor (or with
\`tileborne map generate\`/\`tileborne map import-tiled\`) inside a Tileborne
project, then name that project in \`tileborne.config.json\` (\`project\`, with
optional \`maps\` ids) so \`npm run build\` assembles them as runtime map
packages. Keep exported map JSON here for versioning.
`;

export const renderPluginsReadme = ({ pluginId }: GameTemplateOptions): string =>
  `# Plugins

This game ships the \`${pluginId}\` plugin, consumed as an external dependency
(see \`package.json\`). Install it into your local Tileborne home before
building:

\`\`\`sh
tileborne plugin install --local node_modules/${pluginId}
\`\`\`

Only compiled plugin builds belong here — never plugin or engine source code.
`;

export const renderBrandingReadme = (): string =>
  `# Branding

\`tokens.json\` follows the brand-neutral \`BrandConfig\` schema from
\`@tileborne/core\`: title, palette, lobby copy, optional logo/legal/server
wiring. The game build overlays these tokens onto the shipped client. Add your
logo image here and reference it from \`tokens.json\` (\`logo.src\`).
`;

export const renderScriptsReadme = (): string =>
  `# Scripts

Build/deploy orchestration only — these scripts compose the Tileborne CLI and
wrangler. No engine or gameplay logic.

- \`build.mjs\` — reads \`tileborne.config.json\` (project + optional map ids)
  and runs \`tileborne game build --target cloudflare --out dist/game\` with
  the project's maps baked in.
- \`deploy.mjs\` — \`build.mjs\` + \`HANDOFF_SIGNING_KEY\` secret check +
  \`wrangler deploy --config dist/game/wrangler.toml\`.
`;
