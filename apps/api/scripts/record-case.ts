// Records the fixtures for one backtesting case (decision 0019): USGS readings for each gauge,
// the NBM forecast as it stood one and two days ahead, and what an airport station reported, or
// modeled history when there's no station. Live network; run manually, never in tests or CI.
//
//   pnpm fixtures:record-case --name may-15-high-water --date 2026-05-15 \
//     --lat 42.6 --lon -72.55 --gauge USGS-01170500 --gauge USGS-01161280 --station KORE
//
// Writes test/fixtures/cases/<name>/, including case.json with the arguments. See
// docs/backtesting.md.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { caseRequests, caseWindow, isEmptyRecording, parseCaseArgs } from './case-requests.ts';
import { fixturesDir, recordFixture } from './recorder.ts';

// IEM states no rate limit and Open-Meteo's is far above this; space requests anyway.
const REQUEST_SPACING_MS = 1_000;

let backtestCase: ReturnType<typeof parseCaseArgs>;
try {
  backtestCase = parseCaseArgs(process.argv.slice(2), new Date());
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const requests = Object.entries(caseRequests(backtestCase));
let failed = 0;
const empty: string[] = [];
for (const [index, [name, url]] of requests.entries()) {
  if (index > 0) await new Promise((resolve) => setTimeout(resolve, REQUEST_SPACING_MS));
  const recorded = await recordFixture(name, url);
  if (!recorded) failed += 1;
  else if (isEmptyRecording(recorded.body)) empty.push(name);
}

const dir = join(fixturesDir, 'cases', backtestCase.name);
await mkdir(dir, { recursive: true });
const window = caseWindow(backtestCase.date);
await writeFile(
  join(dir, 'case.json'),
  `${JSON.stringify({ ...backtestCase, window, recordedAt: new Date().toISOString() }, null, 2)}\n`,
);

console.log(`${requests.length - failed} of ${requests.length} fixtures recorded in ${dir}`);
// Not a failure: a gauge may not report a metric, or a sensor may have been out.
if (empty.length > 0) console.log(`No readings in: ${empty.join(', ')}`);
if (failed > 0) process.exit(1);
