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
  },
});
