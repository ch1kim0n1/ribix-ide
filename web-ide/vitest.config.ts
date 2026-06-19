import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // Default to node environment for store/lib tests. Component tests
    // override this with the jsdom environment comment at the top of the
    // file. This avoids pulling in jsdom's CSS color parser (ESM-only)
    // for tests that don't need a DOM.
    environment: 'node',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov'],
      include: ['src/stores/**/*.ts', 'src/components/**/*.tsx', 'src/lib/**/*.ts'],
      exclude: ['src/test/**', '**/*.d.ts'],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
  },
});
