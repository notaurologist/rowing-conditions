import { defineConfig } from 'vitest/config';

// Each package is its own project, so apps/web picks up its vite.config.ts.
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
    coverage: {
      provider: 'v8',
      // Patterns are matched per project, against each package's own folder.
      include: ['**/src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.{ts,tsx}'],
      reporter: ['text', 'html'],
    },
  },
});
