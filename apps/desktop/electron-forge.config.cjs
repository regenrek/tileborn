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

const bundledBattleRoyalePluginName = "battle-royale";
const bundledPluginsDirectoryName = "bundled-plugins";
const battleRoyaleSourceRoot = path.resolve(__dirname, "../../packages/plugin-battle-royale");
const battleRoyaleRequiredFiles = [
  "tileborne-plugin.json",
  "dist/server.js",
  "dist/runtime.js",
  "dist/index.js",
];
const battleRoyaleRuntimeEntries = new Set([
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

const copyBundledBattleRoyalePlugin = (buildPath) => {
  for (const relativePath of battleRoyaleRequiredFiles) {
    const candidate = path.join(battleRoyaleSourceRoot, relativePath);
    if (!fs.existsSync(candidate)) {
      throw new Error(
        `Battle Royale packaged plugin is missing ${relativePath}. Run ` +
          "`pnpm --filter @tileborne/plugin-battle-royale build` before desktop packaging.",
      );
    }
  }

  const resourcesPath = path.dirname(buildPath);
  const destinationRoot = path.join(
    resourcesPath,
    bundledPluginsDirectoryName,
    bundledBattleRoyalePluginName,
  );
  fs.rmSync(destinationRoot, { recursive: true, force: true });
  fs.mkdirSync(destinationRoot, { recursive: true });

  for (const entry of battleRoyaleRuntimeEntries) {
    const sourcePath = path.join(battleRoyaleSourceRoot, entry);
    if (!fs.existsSync(sourcePath)) {
      continue;
    }
    fs.cpSync(sourcePath, path.join(destinationRoot, entry), {
      recursive: true,
      dereference: true,
    });
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
      copyBundledBattleRoyalePlugin(buildPath);
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
