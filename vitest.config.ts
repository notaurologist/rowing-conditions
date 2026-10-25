import { defineConfig } from 'vitest/config';

// Each package is its own project, so apps/web picks up its vite.config.ts.
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
  },
});
