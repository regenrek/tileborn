import { accessSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BATTLE_ROYALE_PLUGIN_ID = "@tileborne-plugins/battle-royale";

const manifestFileName = "tileborne-plugin.json";
const bundledPluginRelativePath = path.join("bundled-plugins", "battle-royale");

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const electronResourcesPath = (process as NodeJS.Process & { readonly resourcesPath?: string })
  .resourcesPath;
const resourcesPath =
  typeof electronResourcesPath === "string" && electronResourcesPath.length > 0
    ? electronResourcesPath
    : moduleDir;
export const workspacePluginRoot = path.resolve(moduleDir, "../../../../packages/plugin-battle-royale");
export const packagedPluginRoot = path.resolve(resourcesPath, bundledPluginRelativePath);

const hasPluginManifest = (directory: string): boolean => {
  try {
    accessSync(path.join(directory, manifestFileName));
    return true;
  } catch {
    return false;
  }
};

export const resolveBattleRoyalePluginPath = (): string => {
  const bundled = path.resolve(packagedPluginRoot);
  if (hasPluginManifest(bundled)) {
    return bundled;
  }

  const resolved = path.resolve(workspacePluginRoot);
  if (!hasPluginManifest(resolved)) {
    throw new Error(
      `Battle Royale plugin not found. Checked packaged plugin ${bundled} and workspace plugin ${resolved}. Build the plugin package before desktop packaging.`,
    );
  }
  return resolved;
};
