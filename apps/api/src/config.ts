import { z } from 'zod';

const Env = z.object({
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// or postgresql:// URL'),
  NWS_USER_AGENT: z
    .string()
    .trim()
    .min(1, 'must identify the app and a contact (NWS returns 403 without it)'),
  USGS_API_KEY: z.string().optional(),
  // Place search uses OpenStreetMap's Nominatim, which can ask an app to stop at any time.
  // Setting this to false turns search off without a code change.
  GEOCODING_ENABLED: z.enum(['true', 'false'], 'must be true or false').default('true'),
  PORT: z
    .string()
    .regex(/^\d+$/, 'must be a whole number')
    .transform(Number)
    .pipe(z.number().int().min(1).max(65535))
    .default(3000),
});

export interface Config {
  databaseUrl: string;
  nwsUserAgent: string;
  usgsApiKey?: string;
  geocodingEnabled: boolean;
  port: number;
}

// Validates the environment at startup and fails fast, listing every problem by variable name.
// Messages never include the values, which may be secrets.
export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${problems.join('\n')}`);
  }
  const { DATABASE_URL, NWS_USER_AGENT, USGS_API_KEY, GEOCODING_ENABLED, PORT } = parsed.data;
  return {
    databaseUrl: DATABASE_URL,
    nwsUserAgent: NWS_USER_AGENT,
    ...(USGS_API_KEY ? { usgsApiKey: USGS_API_KEY } : {}),
    geocodingEnabled: GEOCODING_ENABLED === 'true',
    port: PORT,
  };
}
