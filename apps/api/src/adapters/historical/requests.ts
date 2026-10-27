// URLs for the historical weather sources used only for backtesting (decision 0019): the
// Open-Meteo Previous Runs and Historical Weather APIs, and the IEM ASOS archive. Never used by
// the live app. See docs/DATA_SOURCES.md.

export const OPEN_METEO_PREVIOUS_RUNS_URL = 'https://previous-runs-api.open-meteo.com/v1/forecast';
export const OPEN_METEO_ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
export const IEM_ASOS_URL = 'https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py';

// The National Blend of Models, which NWS grids start from.
export const FORECAST_MODEL = 'ncep_nbm_conus';

const forecastVariables = [
  'temperature_2m',
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m',
  'precipitation_probability',
];
// How many days ahead each recorded forecast was made: a day ahead and two days ahead.
export const FORECAST_LEADS_DAYS = [1, 2] as const;

const archiveVariables = [
  'temperature_2m',
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m',
];

const asosFields = ['tmpc', 'sknt', 'gust', 'drct'];

// Dates are YYYY-MM-DD in UTC. Open-Meteo's start and end dates are both inclusive.
function openMeteoParams(lat: number, lon: number, startDate: string, endDate: string) {
  return {
    latitude: String(lat),
    longitude: String(lon),
    start_date: startDate,
    end_date: endDate,
    wind_speed_unit: 'ms',
    timezone: 'GMT',
  };
}

// Forecasts as they stood one and two days before each hour, from the NBM.
export function previousRunsUrl(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string,
): string {
  const hourly = forecastVariables.flatMap((v) =>
    FORECAST_LEADS_DAYS.map((days) => `${v}_previous_day${days}`),
  );
  const query = new URLSearchParams({
    ...openMeteoParams(lat, lon, startDate, endDate),
    hourly: hourly.join(','),
    models: FORECAST_MODEL,
  });
  return `${OPEN_METEO_PREVIOUS_RUNS_URL}?${query.toString()}`;
}

// Modeled history, for places with no weather station within 30 km.
export function archiveUrl(lat: number, lon: number, startDate: string, endDate: string): string {
  const query = new URLSearchParams({
    ...openMeteoParams(lat, lon, startDate, endDate),
    hourly: archiveVariables.join(','),
  });
  return `${OPEN_METEO_ARCHIVE_URL}?${query.toString()}`;
}

// IEM station IDs drop the K of US airport identifiers: KORE is ORE.
export function iemStationId(stationId: string): string {
  const id = stationId.toUpperCase();
  return /^K[A-Z0-9]{3}$/.test(id) ? id.slice(1) : id;
}

// Routine hourly reports from an airport station, as CSV. IEM's end date is exclusive.
export function asosUrl(stationId: string, startDate: string, endDateExclusive: string): string {
  const [year1, month1, day1] = startDate.split('-').map(Number);
  const [year2, month2, day2] = endDateExclusive.split('-').map(Number);
  const query = new URLSearchParams({ station: iemStationId(stationId) });
  for (const field of asosFields) query.append('data', field);
  for (const [key, value] of Object.entries({ year1, month1, day1, year2, month2, day2 })) {
    query.append(key, String(value));
  }
  for (const [key, value] of Object.entries({
    tz: 'Etc/UTC',
    format: 'onlycomma',
    latlon: 'no',
    missing: 'empty',
    report_type: '3',
  })) {
    query.append(key, value);
  }
  return `${IEM_ASOS_URL}?${query.toString()}`;
}
