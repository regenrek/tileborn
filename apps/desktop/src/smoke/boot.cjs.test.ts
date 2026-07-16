import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const assertCjsBundle = (bundlePath: string): void => {
  expect(
    existsSync(bundlePath),
    `${bundlePath} missing — run \`pnpm --filter @tileborne/desktop build\` first`,
  ).toBe(true);

  const source = readFileSync(bundlePath, 'utf8');
  const head = source.slice(0, 4096);
  const firstLines = head.split('\n').slice(0, 8).join('\n');

  const hasCjsMarker =
    head.includes('"use strict"') ||
    head.includes("'use strict'") ||
    /require\s*\(/.test(head) ||
    head.includes('Object.defineProperty(exports');
  expect(hasCjsMarker).toBe(true);
  expect(firstLines).not.toMatch(/^\s*import\s/m);
  expect(source).not.toMatch(/import\.meta\.url/);
  expect(source).not.toMatch(/\{\}\.url/);
};

describe('desktop boot bundles', () => {
  it('emits main.cjs as CommonJS', () => {
    assertCjsBundle(path.join(desktopRoot, '.vite/build/main.cjs'));
  });

  it('emits preload.cjs as CommonJS', () => {
    assertCjsBundle(path.join(desktopRoot, '.vite/build/preload.cjs'));
  });
});
