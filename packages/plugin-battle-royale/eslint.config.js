import rootConfig from "../../eslint.config.js";

export default [
  ...rootConfig,
  {
    files: ["**/*.test.ts", "src/test/**", "vitest.config.ts"],
    rules: {
      "import/no-extraneous-dependencies": "off",
    },
  },
];
