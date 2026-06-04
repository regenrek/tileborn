import { defineConfig } from "vitest/config";

// Node test environment; tests live alongside source as `src/**/*.test.ts`.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
