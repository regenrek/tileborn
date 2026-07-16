/* eslint-disable import/no-extraneous-dependencies -- vitest config entrypoint */
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/smoke/renderer-boot.test.ts',
      'src/smoke/project-creation.electron.test.ts',
      'src/smoke/acceptance-tileset-import.electron.test.ts',
      'src/smoke/acceptance-map-generate.electron.test.ts',
      'src/smoke/acceptance-playtest.electron.test.ts',
      'src/smoke/acceptance-playtest-multiplayer.electron.test.ts',
      'src/smoke/acceptance-dialog-submit.electron.test.ts',
      'src/smoke/acceptance-plugin-install.electron.test.ts',
      'src/smoke/acceptance-playtest-plugin-runtime.electron.test.ts',
      'src/smoke/game-mode-example-arena.electron.test.ts',
      'src/smoke/ship-game.electron.test.ts',
      'src/smoke/behavior-goal-oracle.electron.test.ts',
    ],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'forks',
    fileParallelism: false,
    root: path.resolve(import.meta.dirname),
  },
});
