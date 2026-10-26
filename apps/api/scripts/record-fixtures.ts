// Records real API responses as test fixtures. Run manually with `pnpm fixtures:record`; never
// in tests, the pre-push check, or CI. Sends no API key, so fixtures contain no secrets.
//
//   pnpm fixtures:record          record every fixture
//   pnpm fixtures:record usgs     record only names starting with "usgs"

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NOMINATIM_BASE_URL,
  NOMINATIM_MIN_INTERVAL_MS,
  searchUrl,
} from '../src/adapters/nominatim/requests.ts';
import { gaugeUrl, nearbyGaugesUrl, stageFlowUrl } from '../src/adapters/nwps/requests.ts';
import {
  alertsUrl,
  gridUrl,
  latestObservationUrl,
  NWS_BASE_URL,
  pointsUrl,
  stationsUrl,
} from '../src/adapters/nws/requests.ts';
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
  'nws/points-turners-falls': pointsUrl(42.6, -72.55),
  'nws/grid-box-20-103': gridUrl('BOX', 20, 103), // has PT3H and P1D intervals
  'nws/stations-box-20-103': stationsUrl('BOX', 20, 103),
  'nws/observation-kore': latestObservationUrl('KORE'), // windGust null: no gust reported
  'nws/alerts-turners-falls': alertsUrl(42.6, -72.55), // usually empty
  // Not a URL the adapter builds: a statewide query, to have real alerts to parse.
  'nws/alerts-sample-ak': `${NWS_BASE_URL}/alerts/active?area=AK`,
  'usgs/history-montague-flow': historyUrl(
    MONTAGUE,
    usgsParameterCodes.flow,
    sixHoursAgo.toISOString(),
    now.toISOString(),
  ),
  'nominatim/search-turners-falls': searchUrl('Turners Falls'),
  'nominatim/search-no-results': searchUrl('qqzzxx no such place'),
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

// NWS grid data has about 60 series; the adapter reads five.
const NWS_SERIES = [
  'temperature',
  'windSpeed',
  'windGust',
  'windDirection',
  'probabilityOfPrecipitation',
];
trims['nws/grid-box-20-103'] = {
  note: `properties trimmed to updateTime, validTimes, and ${NWS_SERIES.join(', ')}`,
  apply: (body) => {
    const b = body as { properties: Record<string, unknown> };
    const keep = ['updateTime', 'validTimes', ...NWS_SERIES];
    b.properties = Object.fromEntries(keep.map((k) => [k, b.properties[k]]));
    return b;
  },
};
for (const [name, count] of [
  ['nws/stations-box-20-103', 5],
  ['nws/alerts-sample-ak', 3],
] as const) {
  trims[name] = {
    note: `features trimmed to the first ${count}`,
    apply: (body) => {
      const b = body as { features: unknown[] };
      b.features = b.features.slice(0, count);
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
let lastNominatimRequest = 0;
for (const [name, url] of selected) {
  // Nominatim allows one request per second.
  if (url.startsWith(NOMINATIM_BASE_URL)) {
    const wait = lastNominatimRequest + NOMINATIM_MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastNominatimRequest = Date.now();
  }
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
