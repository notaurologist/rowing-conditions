import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FetchFn } from '../src/adapters/http.ts';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

export interface Fixture {
  url: string;
  recordedAt: string;
  status: number;
  body: unknown;
}

export function loadFixture(name: string): Fixture {
  return JSON.parse(readFileSync(join(fixturesDir, `${name}.json`), 'utf8'));
}

export interface Route {
  // Matches when the request path ends with this and every listed query parameter is equal.
  path: string;
  query?: Record<string, string>;
  respond: () => Response;
}

export const json =
  (body: unknown, status = 200) =>
  () =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const fixture = (name: string) => json(loadFixture(name).body);

// A fetch that serves routes and fails the test on any unmatched request, so no test can reach
// the network.
export function routedFetch(routes: Route[]): FetchFn & { calls: string[] } {
  const calls: string[] = [];
  const fetch = async (input: string) => {
    calls.push(input);
    const url = new URL(input);
    const route = routes.find(
      (r) =>
        url.pathname.endsWith(r.path) &&
        Object.entries(r.query ?? {}).every(([k, v]) => url.searchParams.get(k) === v),
    );
    if (!route) throw new Error(`Unexpected request in test: ${input}`);
    return route.respond();
  };
  return Object.assign(fetch, { calls });
}
