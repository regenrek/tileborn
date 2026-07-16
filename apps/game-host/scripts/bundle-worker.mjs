import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

import { generateBundledModules } from './generate-bundled-modules.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const gameHostRoot = path.resolve(scriptDir, '..');
const workerEntry = path.join(gameHostRoot, 'src/worker.ts');
const outDir = path.join(gameHostRoot, 'dist');
const workerPath = path.join(outDir, 'worker.js');
const workerEntryPath = path.join(outDir, 'worker-entry.js');
const behaviorWorkerEntry = path.join(gameHostRoot, 'src/behavior/node/node-worker-entry.ts');
const behaviorWorkerPath = path.join(outDir, 'behavior/node/node-worker-entry.js');
const workerdBehaviorWorkerEntry = path.join(
  gameHostRoot,
  'src/behavior/workerd/service-worker.ts',
);
const workerdBehaviorWorkerPath = path.join(outDir, 'behavior-worker.js');
const portableBuildAssetsDir = path.join(outDir, 'build-assets');
const portableWorkerEntryPath = path.join(portableBuildAssetsDir, 'worker-entry.js');
const portableBehaviorWorkerEntryPath = path.join(
  portableBuildAssetsDir,
  'behavior/workerd/service-worker.js',
);
const portableWranglerTemplatePath = path.join(portableBuildAssetsDir, 'wrangler.template.toml');
const generatedRuntimeSourcePath = path.join(gameHostRoot, 'src/.generated/plugin-runtime.js');
const generatedRuntimeTargetPath = path.join(outDir, '.generated/plugin-runtime.js');
const runtimePackagePath = path.join(gameHostRoot, '../../packages/runtime/package.json');
const manifestModulePath = path.join(gameHostRoot, 'dist/build/manifest.js');

const buildStartedAt = Date.now();
const logStep = (message) => {
  const elapsedSeconds = ((Date.now() - buildStartedAt) / 1000).toFixed(1);
  globalThis.console.log(`[game-host:bundle +${elapsedSeconds}s] ${message}`);
};

const readRuntimeVersion = async () => {
  const raw = await readFile(runtimePackagePath, 'utf8');
  return JSON.parse(raw).version;
};

const hashFile = async (filePath) => {
  const { hashFileSha256 } = await import(manifestModulePath);
  return hashFileSha256(filePath);
};

const bundleWorker = async (manifest, runtimeVersion, pass) => {
  const stagingManifestPath = path.join(gameHostRoot, 'src/.generated/runtime-manifest.ts');
  const stagingMapPackagesPath = path.join(gameHostRoot, 'src/.generated/bundled-map-packages.ts');
  const moduleShimPath = path.join(gameHostRoot, 'src/.generated/module-shim.js');
  await writeFile(
    moduleShimPath,
    "export const createRequire = () => { throw new Error('createRequire is unavailable in the game-host worker'); };\n",
    'utf8',
  );
  logStep(`esbuild ${pass} pass started`);
  await build({
    entryPoints: [workerEntry],
    outfile: workerPath,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    sourcemap: true,
    external: [
      'cloudflare:*',
      'node:crypto',
      'crypto',
      'node:fs',
      'node:fs/promises',
      'node:path',
      'node:url',
      'node:os',
    ],
    define: {
      __WORKER_VERSION__: JSON.stringify(runtimeVersion),
      __BUILD_ID__: JSON.stringify(manifest.buildId),
    },
    plugins: [
      {
        name: 'node-module-shim',
        setup(buildApi) {
          buildApi.onResolve({ filter: /^module$/ }, () => ({ path: moduleShimPath }));
        },
      },
      {
        name: 'runtime-manifest-alias',
        setup(buildApi) {
          buildApi.onResolve({ filter: /runtime-manifest\.js$/ }, (args) => {
            if (args.importer.includes('game-host')) {
              return { path: stagingManifestPath };
            }
            return undefined;
          });
        },
      },
      {
        name: 'bundled-map-packages-alias',
        setup(buildApi) {
          buildApi.onResolve({ filter: /bundled-map-packages\.js$/ }, (args) => {
            if (args.importer.includes('game-host')) {
              return { path: stagingMapPackagesPath };
            }
            return undefined;
          });
        },
      },
    ],
  });
  logStep(`esbuild ${pass} pass finished`);
};

const bundleNodeBehaviorWorker = async () => {
  await mkdir(path.dirname(behaviorWorkerPath), { recursive: true });
  logStep('esbuild Node behavior worker started');
  await build({
    entryPoints: [behaviorWorkerEntry],
    outfile: behaviorWorkerPath,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    sourcemap: true,
    external: ['node:*'],
  });
  logStep('esbuild Node behavior worker finished');
};

const bundleWorkerdBehaviorWorker = async () => {
  logStep('esbuild workerd behavior service started');
  await build({
    entryPoints: [workerdBehaviorWorkerEntry],
    outfile: workerdBehaviorWorkerPath,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    sourcemap: true,
  });
  logStep('esbuild workerd behavior service finished');
};

const bundlePortableAssemblyAssets = async () => {
  const moduleShimPath = path.join(gameHostRoot, 'src/.generated/module-shim.js');
  await mkdir(path.dirname(portableBehaviorWorkerEntryPath), { recursive: true });
  logStep('esbuild portable Ship assembly assets started');
  await build({
    entryPoints: [workerEntry],
    outfile: portableWorkerEntryPath,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    external: [
      'cloudflare:*',
      'node:crypto',
      'crypto',
      'node:fs',
      'node:fs/promises',
      'node:path',
      'node:url',
      'node:os',
    ],
    plugins: [
      {
        name: 'portable-generated-assembly-stubs',
        setup(buildApi) {
          buildApi.onResolve(
            { filter: /(?:runtime-manifest|bundled-map-packages)\.js$/ },
            (args) => ({ path: args.path, external: true }),
          );
          buildApi.onResolve({ filter: /^module$/ }, () => ({ path: moduleShimPath }));
        },
      },
    ],
  });
  await build({
    entryPoints: [workerdBehaviorWorkerEntry],
    outfile: portableBehaviorWorkerEntryPath,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    plugins: [
      {
        name: 'portable-bundled-behaviors-stub',
        setup(buildApi) {
          buildApi.onResolve({ filter: /bundled-behaviors\.js$/ }, (args) => ({
            path: args.path,
            external: true,
          }));
        },
      },
    ],
  });
  await copyFile(path.join(gameHostRoot, 'wrangler.template.toml'), portableWranglerTemplatePath);
  logStep('esbuild portable Ship assembly assets finished');
};

logStep('reading runtime and compiled manifest');
const runtimeVersion = await readRuntimeVersion();
const createdAt = '1970-01-01T00:00:00.000Z';
const { buildBundledManifest } = await import(manifestModulePath);

await mkdir(path.dirname(generatedRuntimeTargetPath), { recursive: true });
await copyFile(generatedRuntimeSourcePath, generatedRuntimeTargetPath);
logStep('copied generated plugin runtime');

// `tsc` emits the unbundled worker before this script replaces worker.js with
// the ready-to-run default bundle. Preserve that module graph for runtime
// artifact assembly: its generated-module imports are where project-specific
// manifest and map-package stubs are injected by build/cloudflare.ts.
const hasAssemblyStubImports = (source) =>
  source.includes('./.generated/runtime-manifest.js') &&
  source.includes('./.generated/bundled-map-packages.js');
const compiledWorkerSource = await readFile(workerPath, 'utf8');
if (hasAssemblyStubImports(compiledWorkerSource)) {
  await copyFile(workerPath, workerEntryPath);
} else {
  const preservedEntrySource = await readFile(workerEntryPath, 'utf8').catch(() => '');
  if (!hasAssemblyStubImports(preservedEntrySource)) {
    throw new Error(
      `${workerEntryPath} is missing the compiled assembly graph; run the canonical @tileborne/game-host build`,
    );
  }
}

logStep('generating initial bundled modules');
const initial = await generateBundledModules({
  workerVersion: runtimeVersion,
  createdAt,
  workerFiles: [],
});

await bundleWorker(initial.manifest, runtimeVersion, 'initial');

logStep('hashing initial worker bundle');
const workerFiles = [
  {
    path: 'worker.js',
    hash: await hashFile(workerPath),
    size: (await stat(workerPath)).size,
  },
  {
    path: 'worker.js.map',
    hash: await hashFile(`${workerPath}.map`),
    size: (await stat(`${workerPath}.map`)).size,
  },
];

const finalManifest = buildBundledManifest({
  plugin: initial.pluginSummary,
  assetPacks: [initial.assetPackSummary],
  maps: initial.mapSummaries,
  runtimeVersion,
  workerFiles,
  createdAt,
});

logStep('generating final bundled modules');
await generateBundledModules({
  workerVersion: runtimeVersion,
  createdAt,
  workerFiles,
  buildId: finalManifest.buildId,
});

await bundleWorker(finalManifest, runtimeVersion, 'final');
await bundleNodeBehaviorWorker();
await bundleWorkerdBehaviorWorker();
await bundlePortableAssemblyAssets();
logStep('worker bundle complete');
