import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.resolve(scriptDir, '../dist/worker.js');
const workerEntryPath = path.resolve(scriptDir, '../dist/worker-entry.js');
const pluginRuntimePath = path.resolve(scriptDir, '../dist/.generated/plugin-runtime.js');
const source = await readFile(workerPath, 'utf8');
const workerEntrySource = await readFile(workerEntryPath, 'utf8');
const pluginRuntimeSource = await readFile(pluginRuntimePath, 'utf8');
const bareHonoImport = /^import\s+(?:[^;\n]+\s+from\s+)?["']hono(?:\/[^"']*)?["']/mu;

if (bareHonoImport.test(source)) {
  throw new Error(
    `${workerPath} is TypeScript compiler output with a bare Hono import; run the canonical @tileborne/game-host build`,
  );
}

if (!source.includes('node_modules/hono/dist/compose.js')) {
  throw new Error(`${workerPath} does not contain the expected bundled Hono module`);
}

if (
  !workerEntrySource.includes('./.generated/runtime-manifest.js') ||
  !workerEntrySource.includes('./.generated/bundled-map-packages.js')
) {
  throw new Error(`${workerEntryPath} does not expose the runtime assembly stub imports`);
}

if (!pluginRuntimeSource.includes('createRuntimeAdapter')) {
  throw new Error(`${pluginRuntimePath} does not contain the bundled plugin runtime`);
}

const size = (await stat(workerPath)).size;
stdout.write(`Verified bundled game-host worker: ${size} bytes, Hono inlined\n`);
