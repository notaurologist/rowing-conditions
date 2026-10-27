// Records real API responses as test fixtures. Run manually with `pnpm fixtures:record`; never
// in tests, the pre-push check, or CI. Sends no API key, so fixtures contain no secrets.
//
//   pnpm fixtures:record          record every fixture
//   pnpm fixtures:record usgs     record only names starting with "usgs"

import { archiveUrl, asosUrl, previousRunsUrl } from '../src/adapters/historical/requests.ts';
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
import { waterwaysUrl } from '../src/adapters/overpass/requests.ts';
import {
  historyUrl,
  latestReadingsUrl,
  locationUrl,
  nearbyLocationsUrl,
  timeSeriesMetadataUrl,
  usgsParameterCodes,
} from '../src/adapters/usgs/requests.ts';
import { courseBox } from '../src/services/courseSnap.ts';
import { COURSE_START, COURSE_TURN, NORTHAMPTON_LOOP } from '../test/course.ts';
import { recordFixture, type Trim } from './recorder.ts';

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
  'nws/grid-mfr-90-80': gridUrl('MFR', 90, 80), // Medford, OR: fog (patchy, areas) and dew point
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
  // The Connecticut River above the Turners Falls dam, from a start to a turn about 6 km upriver.
  'overpass/waterways-turners-falls': waterwaysUrl(courseBox([COURSE_START, COURSE_TURN])),
  // The Elwell Island loop at Northampton (#142).
  'overpass/waterways-northampton': waterwaysUrl(courseBox(NORTHAMPTON_LOOP)),
  'nominatim/search-turners-falls': searchUrl('Turners Falls'),
  'nominatim/search-no-results': searchUrl('qqzzxx no such place'),
  // Backtesting sources (decision 0019), for fixed past dates so re-recording gives the same data.
  'historical/previous-runs-turners-falls': previousRunsUrl(
    42.6,
    -72.55,
    '2026-05-14',
    '2026-05-17',
  ),
  'historical/archive-turners-falls': archiveUrl(42.6, -72.55, '2026-05-14', '2026-05-17'),
  'historical/asos-ore': asosUrl('KORE', '2026-05-14', '2026-05-18'),
};

// Fixtures trimmed to keep the repo small. The trim is recorded in the fixture, so it's never
// mistaken for the full response. NWPS stageflow returns about 30 days of 15-minute observations.
const OBSERVED_POINTS_KEPT = 96; // 24 hours
const trims: Record<string, Trim> = {};
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

// NWS grid data has about 60 series; the adapter reads these.
const NWS_SERIES = [
  'temperature',
  'windSpeed',
  'windGust',
  'windDirection',
  'probabilityOfPrecipitation',
  'dewpoint',
  'weather',
];
for (const name of ['nws/grid-box-20-103', 'nws/grid-mfr-90-80']) {
  trims[name] = {
    note: `properties trimmed to updateTime, validTimes, and ${NWS_SERIES.join(', ')}`,
    apply: (body) => {
      const b = body as { properties: Record<string, unknown> };
      const keep = ['updateTime', 'validTimes', ...NWS_SERIES];
      b.properties = Object.fromEntries(keep.map((k) => [k, b.properties[k]]));
      return b;
    },
  };
}
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
  if (!(await recordFixture(name, url, trims[name]))) failed += 1;
}

console.log(`${selected.length - failed} of ${selected.length} fixtures recorded`);
if (failed > 0) process.exit(1);
