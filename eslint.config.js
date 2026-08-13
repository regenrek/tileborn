import eslint from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-smoke/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/.vite/**',
      '**/out/**',
      '**/src/.generated/**',
      '**/*.d.ts',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.cjs'],
    languageOptions: {
      globals: {
        module: 'readonly',
        require: 'readonly',
        __dirname: 'readonly',
        process: 'readonly',
      },
    },
  },
  {
    files: ['scripts/**/*.{js,mjs}'],
    languageOptions: {
      globals: {
        AbortController: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        clearInterval: 'readonly',
        clearTimeout: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        process: 'readonly',
        setInterval: 'readonly',
        setTimeout: 'readonly',
        structuredClone: 'readonly',
      },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      import: importPlugin,
      'react-hooks': reactHooks,
    },
    settings: {
      'import/resolver': {
        typescript: {
          project: ['./tsconfig.base.json', './packages/*/tsconfig.json', './apps/*/tsconfig.json'],
        },
      },
    },
    rules: {
      'import/no-extraneous-dependencies': [
        'error',
        {
          devDependencies: [
            '**/alchemy.example.run.ts',
            '**/*.test.ts',
            '**/*.test.tsx',
            '**/__e2e__/**/*.ts',
            '**/*.spec.ts',
            '**/*.smoke.spec.ts',
            '**/vitest.config.ts',
            '**/vitest.*.config.ts',
            '**/playwright.config.ts',
            '**/vite.*.config.ts',
            '**/src/smoke/**/*.ts',
            '**/src/main/**/*.ts',
            '**/src/preload/**/*.ts',
            '**/src/renderer/main.tsx',
            '**/src/renderer/router.tsx',
            'eslint.config.js',
            'vitest.config.ts',
            'vitest.e2e.config.ts',
            'vitest.smoke.config.ts',
            '**/tsup.config.ts',
            '**/scripts/**/*.mjs',
            'astro.config.mjs',
          ],
          packageDir: ['.', './apps/desktop', './packages/*', './apps/*'],
        },
      ],
      // Layer boundary rules will be tightened in t-code-boundary.
    },
  },
);
