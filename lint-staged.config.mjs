export default {
  '**/*.{js,cjs,mjs,jsx,ts,tsx}': 'node scripts/git-hooks/lint-staged-eslint.mjs',
  '**/*.{js,cjs,mjs,jsx,ts,tsx,css,html,json,jsonc,md,mdx,yaml,yml}':
    'prettier --check --ignore-unknown',
};
