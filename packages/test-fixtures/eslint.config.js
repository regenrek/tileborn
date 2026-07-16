import rootConfig from '../../eslint.config.js';

export default [
  ...rootConfig,
  {
    ignores: ['fixtures/**'],
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        console: 'readonly',
      },
    },
  },
];
