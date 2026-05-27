import rootConfig from "../../eslint.config.js";

export default [
  ...rootConfig,
  {
    ignores: [
      ".astro/**",
      "dist/**",
      "src/content/docs/adrs/**",
      "src/content/docs/cli/**",
      "src/content/docs/reference/**",
      "src/content/docs/runtime/**",
      "src/content/docs/follow-ups/**",
      "src/content/docs/editor-ux/**",
      "src/generated/**",
    ],
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
      },
    },
  },
  {
    files: ["src/env.d.ts"],
    rules: {
      "@typescript-eslint/triple-slash-reference": "off",
    },
  },
];
