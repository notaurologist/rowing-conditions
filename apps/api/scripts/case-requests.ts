// What to record for one backtesting case: arguments in, fixture names and URLs out. Kept apart
// from record-case.ts so it can be tested without the network.

import { parseArgs } from 'node:util';
import {
  archiveUrl,
  asosUrl,
  iemStationId,
  previousRunsUrl,
} from '../src/adapters/historical/requests.ts';
import { historyUrl, usgsParameterCodes } from '../src/adapters/usgs/requests.ts';

export interface BacktestCase {
  name: string; // kebab-case; fixtures go in test/fixtures/cases/<name>/
  date: string; // YYYY-MM-DD, the day being replayed
  lat: number;
  lon: number;
  gauges: string[]; // USGS monitoring location IDs, e.g. USGS-01170500
  station?: string; // airport station for observations, e.g. KORE; omitted: modeled history
}

// Open-Meteo's Previous Runs archive starts in January 2024 for most models.
const EARLIEST_DATE = '2024-01-01';
const DAY_MS = 86_400_000;

const usage = `Usage: pnpm fixtures:record-case --name <kebab-name> --date YYYY-MM-DD \\
  --lat <lat> --lon <lon> --gauge USGS-<id> [--gauge USGS-<id> ...] [--station KORE]`;

// Throws an Error whose message says what's wrong and how to call the script.
export function parseCaseArgs(args: string[], today: Date): BacktestCase {
  const fail = (problem: string): never => {
    throw new Error(`${problem}\n${usage}`);
  };
  let values: ReturnType<typeof parse>['values'];
  try {
    values = parse(args).values;
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }

  const name = values.name ?? fail('--name is required');
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) fail(`--name must be kebab-case: ${name}`);

  const date = values.date ?? fail('--date is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    fail(`--date must be YYYY-MM-DD: ${date}`);
  }
  if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    fail(`--date is not a real date: ${date}`);
  }
  if (date < EARLIEST_DATE) fail(`--date must be ${EARLIEST_DATE} or later: ${date}`);
  // The window runs two days past the date, and all of it must be in the past.
  const lastDay = addDays(date, 2);
  if (lastDay >= today.toISOString().slice(0, 10)) {
    fail(`--date must be at least three days ago, so the whole window has data: ${date}`);
  }

  const lat = Number(values.lat ?? fail('--lat is required'));
  const lon = Number(values.lon ?? fail('--lon is required'));
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) fail(`--lat is out of range: ${values.lat}`);
  if (!Number.isFinite(lon) || lon < -180 || lon > 180)
    fail(`--lon is out of range: ${values.lon}`);

  const gauges = values.gauge ?? [];
  if (gauges.length === 0) fail('at least one --gauge is required');
  for (const gauge of gauges) {
    if (!/^USGS-\d{8,15}$/.test(gauge)) fail(`--gauge must look like USGS-01170500: ${gauge}`);
  }

  const station = values.station?.toUpperCase();
  if (station !== undefined && !/^[A-Z0-9]{3,4}$/.test(station)) {
    fail(`--station must be an airport identifier such as KORE: ${values.station}`);
  }

  return { name, date, lat, lon, gauges, ...(station ? { station } : {}) };
}

function parse(args: string[]) {
  return parseArgs({
    args: joinNumberArgs(args),
    strict: true,
    allowPositionals: false,
    options: {
      name: { type: 'string' },
      date: { type: 'string' },
      lat: { type: 'string' },
      lon: { type: 'string' },
      gauge: { type: 'string', multiple: true },
      station: { type: 'string' },
    },
  });
}

// parseArgs reads "--lon -72.55" as two options. US longitudes are always negative, so join a
// coordinate onto its option as "--lon=-72.55".
function joinNumberArgs(args: string[]): string[] {
  const joined: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? '';
    const next = args[i + 1];
    if ((arg === '--lat' || arg === '--lon') && next !== undefined && /^-\d/.test(next)) {
      joined.push(`${arg}=${next}`);
      i += 1;
    } else {
      joined.push(arg);
    }
  }
  return joined;
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

// The window, in UTC: the day before the date, for recent trends, through two days after it, for
// the 48 hours ahead of a morning on the date.
export function caseWindow(date: string): { start: string; endExclusive: string } {
  return { start: addDays(date, -1), endExclusive: addDays(date, 3) };
}

const metricSlugs = {
  flow: 'flow',
  gaugeHeight: 'gauge-height',
  waterTemp: 'water-temp',
} as const satisfies Record<keyof typeof usgsParameterCodes, string>;

// Fixture name (under test/fixtures, without .json) -> URL.
export function caseRequests(c: BacktestCase): Record<string, string> {
  const { start, endExclusive } = caseWindow(c.date);
  const lastDay = addDays(endExclusive, -1);
  const dir = `cases/${c.name}`;
  const requests: Record<string, string> = {};

  for (const gauge of c.gauges) {
    const site = gauge.replace(/^USGS-/, '');
    for (const [metric, code] of Object.entries(usgsParameterCodes)) {
      const slug = metricSlugs[metric as keyof typeof usgsParameterCodes];
      requests[`${dir}/usgs-${site}-${slug}`] = historyUrl(
        gauge,
        code,
        `${start}T00:00:00Z`,
        `${endExclusive}T00:00:00Z`,
      );
    }
  }

  requests[`${dir}/open-meteo-previous-runs`] = previousRunsUrl(c.lat, c.lon, start, lastDay);
  if (c.station) {
    requests[`${dir}/iem-asos-${iemStationId(c.station).toLowerCase()}`] = asosUrl(
      c.station,
      start,
      endExclusive,
    );
  } else {
    requests[`${dir}/open-meteo-archive`] = archiveUrl(c.lat, c.lon, start, lastDay);
  }
  return requests;
}

// True when a recorded body holds no readings: a USGS response with no features, or IEM CSV with
// only its header. Missing data is unknown in a replay, so the recorder says so.
export function isEmptyRecording(body: unknown): boolean {
  if (typeof body === 'string') return body.trim().split('\n').length <= 1;
  if (body !== null && typeof body === 'object' && 'features' in body) {
    return Array.isArray(body.features) && body.features.length === 0;
  }
  return false;
}
