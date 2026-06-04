import rootConfig from "../../eslint.config.js";

export default [
  ...rootConfig,
  {
    files: ["**/*.test.ts", "vitest.config.ts", "tsup.config.ts"],
    rules: {
      "import/no-extraneous-dependencies": "off",
    },
  },
];
