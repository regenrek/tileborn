import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__e2e__/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    globalSetup: ["./src/__e2e__/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    sequence: { concurrent: false },
  },
});
