import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach } from 'vitest';

const tempHomes: string[] = [];
const tempDirs: string[] = [];

let activeHome: string | undefined;

export const registerE2eHomeHooks = (): void => {
  beforeEach(() => {
    activeHome = mkdtempSync(path.join(tmpdir(), 'tileborne-cli-e2e-home-'));
    tempHomes.push(activeHome);
  });

  afterEach(() => {
    activeHome = undefined;
    while (tempHomes.length > 0) {
      const home = tempHomes.pop();
      if (home) {
        rmSync(home, { recursive: true, force: true });
      }
    }
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });
};

export const tileborneHome = (): string => {
  if (!activeHome) {
    throw new Error('e2e home is not initialized; call registerE2eHomeHooks() first');
  }
  return activeHome;
};

export const makeTempDir = (prefix: string): string => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};
