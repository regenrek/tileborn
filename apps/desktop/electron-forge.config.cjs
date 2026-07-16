/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS forge config */
const fs = require('node:fs');
const childProcess = require('node:child_process');
const moduleApi = require('node:module');
const os = require('node:os');
const path = require('node:path');

const { createDesktopReleaseForgeSettings } = require('./scripts/desktop-release-forge.cjs');

const desktopRelease = createDesktopReleaseForgeSettings();

const packagerTmp = path.join(
  os.tmpdir(),
  'tileborne-electron-packager',
  `${process.pid}-${Date.now()}`,
);
fs.mkdirSync(packagerTmp, { recursive: true });

const bundledPluginsDirectoryName = 'bundled-plugins';
const gameHostBuildAssetsDirectoryName = 'game-host-build-assets';
// The set of bundled example plugins copied into resources/bundled-plugins/<dir>.
// Mirrors apps/desktop/src/main/bundled-plugins.ts (BUNDLED_PLUGINS): a new
// bundled genre is added in BOTH places.
const bundledPlugins = [
  {
    bundledDirName: 'battle-royale',
    packageDir: 'plugin-battle-royale',
    buildHint: 'pnpm --filter @tileborne/plugin-battle-royale build',
    requiredFiles: ['tileborne-plugin.json', 'dist/server.js', 'dist/runtime.js', 'dist/index.js'],
  },
  {
    bundledDirName: 'example-arena',
    packageDir: 'plugin-example-arena',
    buildHint: 'pnpm --filter @tileborne/plugin-example-arena build',
    requiredFiles: ['tileborne-plugin.json', 'dist/runtime.js'],
  },
];
// Optional runtime entries copied when present (skipped silently when absent).
const bundledPluginRuntimeEntries = new Set([
  'tileborne-plugin.json',
  'package.json',
  'LICENSE',
  'README.md',
  'dist',
  'assets',
  'panels',
  'presets',
  'schemas',
  'validators',
]);
const iconAssetsRoot = path.resolve(__dirname, 'assets');
const appIconPath = path.join(iconAssetsRoot, 'icon');
const runtimeIconPath = path.join(iconAssetsRoot, 'icon.png');
const workspaceRoot = path.resolve(__dirname, '../..');
const runtimeClosurePackage = '@tileborne/desktop-runtime-closure';
const externalRuntimePackages = ['esbuild', 'miniflare'];

const runPnpm = (args, options = {}) => {
  const npmExecPath = process.env.npm_execpath;
  const command =
    typeof npmExecPath === 'string' && npmExecPath.length > 0
      ? process.execPath
      : process.platform === 'win32'
        ? 'pnpm.cmd'
        : 'pnpm';
  const commandArgs =
    typeof npmExecPath === 'string' && npmExecPath.length > 0 ? [npmExecPath, ...args] : args;
  const result = childProcess.spawnSync(command, commandArgs, {
    cwd: workspaceRoot,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stdout ?? ''}${result.stderr ?? ''}` : '';
    throw new Error(
      `pnpm ${args.join(' ')} failed with exit code ${String(result.status)}${detail}`,
    );
  }
  return options.capture ? String(result.stdout).trim() : '';
};

const assertPackagedRuntimeClosure = (buildPath) => {
  const appRequire = moduleApi.createRequire(path.join(buildPath, 'package.json'));
  const appRoot = path.resolve(buildPath);
  for (const packageName of externalRuntimePackages) {
    const resolved = path.resolve(appRequire.resolve(packageName));
    const relative = path.relative(appRoot, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Packaged runtime ${packageName} escaped Resources/app: ${resolved}`);
    }
  }
};

const deployPackagedRuntimeClosure = (buildPath) => {
  const stagingPath = path.join(buildPath, '.tileborne-runtime-closure');
  const destinationNodeModules = path.join(buildPath, 'node_modules');
  fs.rmSync(stagingPath, { recursive: true, force: true });
  fs.rmSync(destinationNodeModules, { recursive: true, force: true });

  const storePath = runPnpm(['store', 'path'], { capture: true });
  try {
    runPnpm([
      '--config.inject-workspace-packages=true',
      '--store-dir',
      storePath,
      '--filter',
      runtimeClosurePackage,
      'deploy',
      '--prod',
      stagingPath,
    ]);
    const stagedNodeModules = path.join(stagingPath, 'node_modules');
    if (!fs.existsSync(stagedNodeModules)) {
      throw new Error(`Runtime deployment ${runtimeClosurePackage} produced no node_modules`);
    }
    fs.renameSync(stagedNodeModules, destinationNodeModules);
  } finally {
    fs.rmSync(stagingPath, { recursive: true, force: true });
  }
  assertPackagedRuntimeClosure(buildPath);
};

const copyBundledPlugin = (buildPath, plugin) => {
  const sourceRoot = path.resolve(__dirname, '../../packages', plugin.packageDir);
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

const copyGameHostBuildAssets = (buildPath) => {
  const sourceRoot = path.resolve(__dirname, '../game-host/dist/build-assets');
  const requiredFiles = [
    'worker-entry.js',
    'behavior/workerd/service-worker.js',
    'wrangler.template.toml',
  ];
  for (const relativePath of requiredFiles) {
    const candidate = path.join(sourceRoot, relativePath);
    if (!fs.existsSync(candidate)) {
      throw new Error(
        `Game Host build asset ${relativePath} is missing. Run ` +
          '`pnpm --filter @tileborne/game-host build` before desktop packaging.',
      );
    }
  }
  const destinationRoot = path.join(path.dirname(buildPath), gameHostBuildAssetsDirectoryName);
  fs.rmSync(destinationRoot, { recursive: true, force: true });
  fs.cpSync(sourceRoot, destinationRoot, { recursive: true, dereference: true });
};

const dmgMaker = {
  name: '@electron-forge/maker-dmg',
  config: desktopRelease.enabled ? desktopRelease.dmgConfig : {},
  platforms: ['darwin'],
};

const developmentMakers = [
  dmgMaker,
  {
    name: '@electron-forge/maker-squirrel',
    config: {
      name: 'tileborne',
      setupIcon: path.join(iconAssetsRoot, 'icon.ico'),
    },
    platforms: ['win32'],
  },
  {
    name: '@electron-forge/maker-deb',
    config: {
      options: {
        icon: runtimeIconPath,
        maintainer: 'Tileborne',
        homepage: 'https://tileborne.dev',
      },
    },
    platforms: ['linux'],
  },
  {
    name: '@electron-forge/maker-rpm',
    config: {
      options: {
        icon: runtimeIconPath,
        homepage: 'https://tileborne.dev',
      },
    },
    platforms: ['linux'],
  },
];

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
module.exports = {
  packagerConfig: {
    name: 'Tileborne',
    executableName: 'tileborne',
    appBundleId: 'dev.tileborne.app',
    icon: appIconPath,
    extraResource: [runtimeIconPath],
    tmpdir: packagerTmp,
    ...(desktopRelease.enabled ? desktopRelease.packagerConfig : {}),
  },
  rebuildConfig: {},
  hooks: {
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      copyBundledPlugins(buildPath);
      copyGameHostBuildAssets(buildPath);
    },
    // Packager pruning has finished here. Install a lockfile-derived, portable
    // production closure for the two binary-backed Vite externals; everything
    // else in the main process is bundled.
    packageAfterPrune: async (_forgeConfig, buildPath) => {
      deployPackagedRuntimeClosure(buildPath);
    },
    postMake: async (_forgeConfig, makeResults) => {
      if (!desktopRelease.enabled) return makeResults;
      const { notarize } = require('@electron/notarize');
      for (const result of makeResults) {
        if (result.platform !== 'darwin' || result.arch !== 'arm64') {
          throw new Error(`desktop-release.unexpected-output: ${result.platform}/${result.arch}`);
        }
        for (const artifact of result.artifacts) {
          if (path.extname(artifact).toLowerCase() !== '.dmg') {
            throw new Error(`desktop-release.unexpected-artifact: ${artifact}`);
          }
          await notarize({ appPath: artifact, ...desktopRelease.notarizeCredentials });
        }
      }
      return makeResults;
    },
  },
  // Release mode deliberately exposes only the approved macOS-arm64 maker.
  // The development maker inventory is cross-platform build capability, not a
  // support claim; support is owned by scripts/desktop-release-policy.json.
  makers: desktopRelease.enabled ? [dmgMaker] : developmentMakers,
  plugins: [
    {
      name: '@electron-forge/plugin-vite',
      config: {
        build: [
          {
            entry: 'src/main/main.ts',
            config: 'vite.main.config.ts',
          },
          {
            entry: 'src/preload/preload.ts',
            config: 'vite.preload.config.ts',
          },
        ],
        renderer: [
          {
            name: 'main_window',
            config: 'vite.renderer.config.ts',
          },
        ],
      },
    },
  ],
};
