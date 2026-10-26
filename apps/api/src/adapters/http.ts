import type { SourceId } from '@rowing/core';
import type { z } from 'zod';

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

// Data sources, plus services that aren't data sources, such as place search.
export type ErrorSource = SourceId | 'nominatim';

export interface SourceError {
  source: ErrorSource;
  // 'unavailable': the request wasn't sent, for example because its rate gate couldn't be checked.
  kind: 'timeout' | 'network' | 'http' | 'parse' | 'unavailable';
  message: string;
  status?: number;
}

export type SourceResult<T> = { ok: true; data: T } | { ok: false; error: SourceError };

export interface Logger {
  warn(message: string, details?: Record<string, unknown>): void;
}

export const consoleLogger: Logger = {
  warn: (message, details) => console.warn(message, details ?? ''),
};

export const DEFAULT_TIMEOUT_MS = 10_000;

export interface RequestOptions {
  source: ErrorSource;
  fetch: FetchFn;
  logger: Logger;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

// The shape of a payload without its values, for logging a parse failure without dumping data.
export function describeShape(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) {
    return depth > 3 ? 'array' : [value.length, describeShape(value[0], depth + 1)];
  }
  if (value !== null && typeof value === 'object') {
    if (depth > 3) return 'object';
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, describeShape(v, depth + 1)]),
    );
  }
  return value === null ? 'null' : typeof value;
}

// Fetches JSON and parses it with the schema. Never throws: every failure becomes a SourceError.
export async function fetchJson<T>(
  url: string,
  schema: z.ZodType<T>,
  options: RequestOptions,
): Promise<SourceResult<T>> {
  const { source, logger } = options;
  const fail = (error: Omit<SourceError, 'source'>): SourceResult<T> => ({
    ok: false,
    error: { source, ...error },
  });

  let response: Response;
  try {
    response = await options.fetch(url, {
      headers: { Accept: 'application/json', ...options.headers },
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return fail({
      kind: timedOut ? 'timeout' : 'network',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  if (!response.ok) {
    return fail({ kind: 'http', status: response.status, message: `HTTP ${response.status}` });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    return fail({ kind: 'parse', message: `Invalid JSON: ${String(error)}` });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    logger.warn(`${source}: response did not match schema`, {
      url,
      issues: parsed.error.issues.slice(0, 5),
      shape: describeShape(body),
    });
    return fail({ kind: 'parse', message: parsed.error.issues[0]?.message ?? 'Invalid response' });
  }
  return { ok: true, data: parsed.data };
}
