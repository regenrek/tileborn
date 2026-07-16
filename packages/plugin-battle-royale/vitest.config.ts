import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The react plugin transforms the menu `.tsx` sections (automatic JSX runtime).
// Node remains the default test environment; menu render tests opt into jsdom
// via a per-file `// @vitest-environment jsdom` docblock.
export default defineConfig({
  plugins: [react()],
});
