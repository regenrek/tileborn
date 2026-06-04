/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS forge config */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const packagerTmp = path.join(
  os.tmpdir(),
  "tileborne-electron-packager",
  `${process.pid}-${Date.now()}`,
);
fs.mkdirSync(packagerTmp, { recursive: true });

const bundledPluginsDirectoryName = "bundled-plugins";
// The set of bundled example plugins copied into resources/bundled-plugins/<dir>.
// Mirrors apps/desktop/src/main/bundled-plugins.ts (BUNDLED_PLUGINS): a new
// bundled genre is added in BOTH places.
const bundledPlugins = [
  {
    bundledDirName: "battle-royale",
    packageDir: "plugin-battle-royale",
    buildHint: "pnpm --filter @tileborne/plugin-battle-royale build",
    requiredFiles: [
      "tileborne-plugin.json",
      "dist/server.js",
      "dist/runtime.js",
      "dist/index.js",
    ],
  },
  {
    bundledDirName: "example-arena",
    packageDir: "plugin-example-arena",
    buildHint: "pnpm --filter @tileborne/plugin-example-arena build",
    requiredFiles: ["tileborne-plugin.json", "dist/runtime.js"],
  },
];
// Optional runtime entries copied when present (skipped silently when absent).
const bundledPluginRuntimeEntries = new Set([
  "tileborne-plugin.json",
  "package.json",
  "LICENSE",
  "README.md",
  "dist",
  "assets",
  "panels",
  "presets",
  "schemas",
  "validators",
]);
const iconAssetsRoot = path.resolve(__dirname, "assets");
const appIconPath = path.join(iconAssetsRoot, "icon");
const runtimeIconPath = path.join(iconAssetsRoot, "icon.png");

const copyBundledPlugin = (buildPath, plugin) => {
  const sourceRoot = path.resolve(__dirname, "../../packages", plugin.packageDir);
  for (const relativePath of plugin.requiredFiles) {
    const candidate = path.join(sourceRoot, relativePath);
    if (!fs.existsSync(candidate)) {
      throw new Error(
        `Bundled plugin ${plugin.packageDir} is missing ${relativePath}. Run ` +
          `\`${plugin.buildHint}\` before desktop packaging.`,
      );
    }
  }

  const resourcesPath = path.dirname(buildPath);
  const destinationRoot = path.join(
    resourcesPath,
    bundledPluginsDirectoryName,
    plugin.bundledDirName,
  );
  fs.rmSync(destinationRoot, { recursive: true, force: true });
  fs.mkdirSync(destinationRoot, { recursive: true });

  for (const entry of bundledPluginRuntimeEntries) {
    const sourcePath = path.join(sourceRoot, entry);
    if (!fs.existsSync(sourcePath)) {
      continue;
    }
    fs.cpSync(sourcePath, path.join(destinationRoot, entry), {
      recursive: true,
      dereference: true,
    });
  }
};

const copyBundledPlugins = (buildPath) => {
  for (const plugin of bundledPlugins) {
    copyBundledPlugin(buildPath, plugin);
  }
};

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
// Code signing deferred for v0.1.0 — docs/follow-ups.md#fu-v01-codesigning
module.exports = {
  packagerConfig: {
    name: "Tileborne",
    executableName: "tileborne",
    appBundleId: "dev.tileborne.app",
    icon: appIconPath,
    extraResource: [runtimeIconPath],
    tmpdir: packagerTmp,
  },
  rebuildConfig: {},
  hooks: {
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      copyBundledPlugins(buildPath);
    },
  },
  makers: [
    {
      name: "@electron-forge/maker-dmg",
      config: {},
    },
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "tileborne",
        setupIcon: path.join(iconAssetsRoot, "icon.ico"),
      },
    },
    {
      name: "@electron-forge/maker-deb",
      config: {
        options: {
          icon: runtimeIconPath,
          maintainer: "Tileborne",
          homepage: "https://tileborne.dev",
        },
      },
    },
    {
      name: "@electron-forge/maker-rpm",
      config: {
        options: {
          icon: runtimeIconPath,
          homepage: "https://tileborne.dev",
        },
      },
    },
  ],
  plugins: [
    {
      name: "@electron-forge/plugin-vite",
      config: {
        build: [
          {
            entry: "src/main/main.ts",
            config: "vite.main.config.ts",
          },
          {
            entry: "src/preload/preload.ts",
            config: "vite.preload.config.ts",
          },
        ],
        renderer: [
          {
            name: "main_window",
            config: "vite.renderer.config.ts",
          },
        ],
      },
    },
  ],
};
