import rootConfig from "../../eslint.config.js"

export default [
  ...rootConfig,
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "src/test/**", "vite.config.ts", "vitest.config.ts"],
    rules: {
      "import/no-extraneous-dependencies": "off",
    },
  },
]
