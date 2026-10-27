// Fetches one URL and writes it as a fixture, { url, recordedAt, status, body }. Shared by the
// fixture recorders. Sends no API key, so fixtures contain no secrets.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures');

export interface Trim {
  note: string;
  apply: (body: unknown) => unknown;
}

// Returns the recorded body, or undefined after reporting the failure when the response isn't OK.
export async function recordFixture(
  name: string,
  url: string,
  trim?: Trim,
): Promise<{ body: unknown } | undefined> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    // NWS rejects requests without a User-Agent, and Nominatim requires one that identifies
    // the app. The recorder identifies itself by repository.
    headers: {
      'User-Agent':
        'rowing-conditions fixture recorder (github.com/notaurologist/rowing-conditions)',
    },
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text; // IEM's CSV, for example
  }
  if (!response.ok) {
    console.error(`FAILED ${name}: HTTP ${response.status}`);
    return undefined;
  }
  const file = join(fixturesDir, `${name}.json`);
  await mkdir(dirname(file), { recursive: true });
  const recorded = trim ? trim.apply(body) : body;
  const record = {
    url,
    recordedAt: new Date().toISOString(),
    status: response.status,
    ...(trim ? { trimmed: trim.note } : {}),
    body: recorded,
  };
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`recorded ${name}`);
  return { body: recorded };
}
