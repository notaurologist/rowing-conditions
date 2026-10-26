// Records real API responses as test fixtures. Run manually with `pnpm fixtures:record`; never
// in tests, the pre-push check, or CI. Sends no API key, so fixtures contain no secrets.
//
//   pnpm fixtures:record          record every fixture
//   pnpm fixtures:record usgs     record only names starting with "usgs"

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gaugeUrl, nearbyGaugesUrl, stageFlowUrl } from '../src/adapters/nwps/requests.ts';
import {
  historyUrl,
  latestReadingsUrl,
  locationUrl,
  nearbyLocationsUrl,
  timeSeriesMetadataUrl,
  usgsParameterCodes,
} from '../src/adapters/usgs/requests.ts';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures');

const MONTAGUE = 'USGS-01170500'; // Connecticut River at Montague City, MA: no water temperature
const NORTHFIELD = 'USGS-01161280'; // Connecticut River near Northfield, MA: reports water temperature
const ICE_GAUGE = 'USGS-15743850'; // Alaska; reported ICE with a null flow value on 2026-10-25

const now = new Date();
now.setUTCMinutes(0, 0, 0);
const sixHoursAgo = new Date(now.getTime() - 6 * 3_600_000);

// name -> URL. The name is the fixture's path under test/fixtures, without .json.
const fixtures: Record<string, string> = {
  'usgs/nearby-turners-falls': nearbyLocationsUrl([-72.7, 42.45, -72.4, 42.75]),
  'usgs/location-montague': locationUrl(MONTAGUE),
  'usgs/metadata-montague-northfield': timeSeriesMetadataUrl([MONTAGUE, NORTHFIELD]),
  'usgs/latest-montague': latestReadingsUrl([MONTAGUE]),
  'usgs/latest-northfield': latestReadingsUrl([NORTHFIELD]),
  'usgs/latest-ice': latestReadingsUrl([ICE_GAUGE]),
  'nwps/nearby-turners-falls': nearbyGaugesUrl([-72.7, 42.45, -72.4, 42.75]),
  'nwps/gauge-mntm3': gaugeUrl('MNTM3'), // has a forecast
  'nwps/gauge-by-usgs-01161280': gaugeUrl('01161280'), // Northfield, looked up by USGS number
  'nwps/stageflow-mntm3': stageFlowUrl('MNTM3'),
  'nwps/stageflow-nfdm3': stageFlowUrl('NFDM3'), // no forecast: sentinel issuedTime, -999 flows
  'usgs/history-montague-flow': historyUrl(
    MONTAGUE,
    usgsParameterCodes.flow,
    sixHoursAgo.toISOString(),
    now.toISOString(),
  ),
};

// Fixtures trimmed to keep the repo small. The trim is recorded in the fixture, so it's never
// mistaken for the full response. NWPS stageflow returns about 30 days of 15-minute observations.
const OBSERVED_POINTS_KEPT = 96; // 24 hours
const trims: Record<string, { note: string; apply: (body: unknown) => unknown }> = {};
for (const name of ['nwps/stageflow-mntm3', 'nwps/stageflow-nfdm3']) {
  trims[name] = {
    note: `observed.data trimmed to the last ${OBSERVED_POINTS_KEPT} points`,
    apply: (body) => {
      const b = body as { observed?: { data?: unknown[] } };
      if (Array.isArray(b.observed?.data))
        b.observed.data = b.observed.data.slice(-OBSERVED_POINTS_KEPT);
      return b;
    },
  };
}

const filter = process.argv[2];
const selected = Object.entries(fixtures).filter(([name]) => !filter || name.startsWith(filter));
if (selected.length === 0) {
  console.error(`No fixtures match "${filter}". Names: ${Object.keys(fixtures).join(', ')}`);
  process.exit(1);
}

let failed = 0;
for (const [name, url] of selected) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!response.ok) {
    failed += 1;
    console.error(`FAILED ${name}: HTTP ${response.status}`);
    continue;
  }
  const file = join(fixturesDir, `${name}.json`);
  await mkdir(dirname(file), { recursive: true });
  const trim = trims[name];
  const record = {
    url,
    recordedAt: new Date().toISOString(),
    status: response.status,
    ...(trim ? { trimmed: trim.note } : {}),
    body: trim ? trim.apply(body) : body,
  };
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`recorded ${name}`);
}

console.log(`${selected.length - failed} of ${selected.length} fixtures recorded`);
if (failed > 0) process.exit(1);
