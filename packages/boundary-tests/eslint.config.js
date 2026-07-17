import rootConfig from '../../eslint.config.js';

export default [
  ...rootConfig,
  {
    files: ['src/lib/**/*.ts', 'vitest.config.ts'],
    rules: {
      'import/no-extraneous-dependencies': 'off',
    },
  },
];
