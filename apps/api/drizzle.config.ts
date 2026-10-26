import { defineConfig } from 'drizzle-kit';

// Falls back to the local Docker Compose database (docker-compose.yml); those credentials only
// work against that local container.
export const LOCAL_DATABASE_URL = 'postgres://rowing:rowing@localhost:5432/rowing';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? LOCAL_DATABASE_URL },
  strict: true,
  verbose: true,
});
