import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { mapErrorToExitCode, CliValidationError } from "../../render/errors.js";
import { renderFailure, renderSuccess, setVerboseLevel } from "../../render/output.js";
import { globalArgs, readGlobalCliArgs, readStringArg, renderContextFromArgs, type CliRunContext } from "../shared.js";
import {
  DEFAULT_GAME_PLUGIN_ID,
  TEMPLATE_DIRECTORIES,
  renderAssetsReadme,
  renderBrandingReadme,
  renderBrandingTokens,
  renderBuildScript,
  renderDeployReadme,
  renderDeployScript,
  renderGitignore,
  renderMapsReadme,
  renderPackageJson,
  renderPluginsReadme,
  renderReadme,
  renderScriptsReadme,
  renderTileborneConfig,
  type GameTemplateOptions,
} from "./init-templates.js";

export interface ScaffoldGameProjectOptions {
  /** Target directory (created if missing; must be empty if it exists). */
  readonly directory: string;
  /** Project name; defaults to the directory basename. */
  readonly name?: string | undefined;
  /** Game-mode plugin id; defaults to the bundled battle-royale plugin. */
  readonly pluginId?: string | undefined;
}

export interface ScaffoldGameProjectResult {
  readonly directory: string;
  readonly name: string;
  readonly pluginId: string;
  /** Relative paths of every file written, POSIX-separated. */
  readonly files: readonly string[];
}

const templateFiles = (options: GameTemplateOptions): readonly (readonly [string, string])[] => [
  ["package.json", renderPackageJson(options)],
  ["tileborne.config.json", renderTileborneConfig(options)],
  ["README.md", renderReadme(options)],
  [".gitignore", renderGitignore()],
  ["branding/tokens.json", renderBrandingTokens(options)],
  ["branding/README.md", renderBrandingReadme()],
  ["assets/README.md", renderAssetsReadme()],
  ["maps/README.md", renderMapsReadme()],
  ["plugins/README.md", renderPluginsReadme(options)],
  ["deploy/README.md", renderDeployReadme()],
  ["scripts/build.mjs", renderBuildScript(options)],
  ["scripts/deploy.mjs", renderDeployScript()],
  ["scripts/README.md", renderScriptsReadme()],
];

const assertEmptyTarget = async (directory: string): Promise<void> => {
  let entries: readonly string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
  if (entries.length > 0) {
    throw new CliValidationError({ message: `target directory is not empty: ${directory}` });
  }
};

/** Write the thin product-repo scaffold (ADR-0009/ADR-0017 lane 3) into `directory`. */
export const scaffoldGameProject = async (
  options: ScaffoldGameProjectOptions,
): Promise<ScaffoldGameProjectResult> => {
  const directory = path.resolve(options.directory);
  const name = options.name ?? path.basename(directory);
  if (name.length === 0) {
    throw new CliValidationError({ message: "project name must not be empty" });
  }
  const pluginId = options.pluginId ?? DEFAULT_GAME_PLUGIN_ID;
  await assertEmptyTarget(directory);

  for (const dir of TEMPLATE_DIRECTORIES) {
    await mkdir(path.join(directory, dir), { recursive: true });
  }
  const files = templateFiles({ name, pluginId });
  for (const [relativePath, contents] of files) {
    await writeFile(path.join(directory, ...relativePath.split("/")), contents, "utf8");
  }
  return {
    directory,
    name,
    pluginId,
    files: files.map(([relativePath]) => relativePath),
  };
};

export const gameInitCommand = {
  meta: {
    name: "init",
    description:
      "Scaffold a standalone game project (thin product repo: branding/assets/maps/plugins/deploy/scripts, no engine code). Canonical entry point until an npm-create wrapper ships.",
  },
  args: {
    ...globalArgs,
    dir: {
      type: "positional" as const,
      description: "Target directory for the new game project",
      required: true,
    },
    name: {
      type: "string" as const,
      description: "Project name (default: directory basename)",
      required: false,
    },
    plugin: {
      type: "string" as const,
      description: `Game-mode plugin id (default: ${DEFAULT_GAME_PLUGIN_ID})`,
      required: false,
    },
  },
  async run(context: CliRunContext) {
    const global = readGlobalCliArgs(context.args);
    const ctx = renderContextFromArgs(global);
    setVerboseLevel(global.verbose);
    const dir = readStringArg(context.args, "dir");
    if (!dir) {
      renderFailure(ctx, new Error("target directory is required"), 64);
      return;
    }
    try {
      const result = await scaffoldGameProject({
        directory: dir,
        name: readStringArg(context.args, "name"),
        pluginId: readStringArg(context.args, "plugin"),
      });
      renderSuccess(ctx, result);
    } catch (error) {
      renderFailure(ctx, error, mapErrorToExitCode(error));
    }
  },
};
