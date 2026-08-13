import { defineConfig } from 'vitest/config';

const e2eExclude = [
  'src/__e2e__/asset.test.ts',
  'src/__e2e__/config.test.ts',
  'src/__e2e__/doctor.test.ts',
  'src/__e2e__/game-serve.test.ts',
  'src/__e2e__/home.test.ts',
  'src/__e2e__/logs.test.ts',
  'src/__e2e__/map.test.ts',
  'src/__e2e__/playtest-multiplayer.test.ts',
  'src/__e2e__/playtest.test.ts',
  'src/__e2e__/plugin.test.ts',
  'src/__e2e__/project.test.ts',
  'src/__e2e__/runtime.test.ts',
  'src/__e2e__/smoke-chain.test.ts',
  'src/__e2e__/support.test.ts',
];

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/__e2e__/spec-section-12-sweep.test.ts'],
    exclude: ['dist/**', 'node_modules/**', ...e2eExclude],
    // These integration-style unit suites spawn the built CLI and perform
    // real filesystem/package work. Five seconds is not a valid correctness
    // boundary under the full parallel workspace release gate; timing out a
    // process.chdir test also lets cleanup invalidate the next child cwd.
    // Keep each file in an isolated process, but allow independent files to
    // overlap; their sequential suites still serialize shared work in-file.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    maxWorkers: 4,
  },
});
