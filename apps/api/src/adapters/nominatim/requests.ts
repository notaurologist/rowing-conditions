// URLs for OpenStreetMap's Nominatim search. Shared by the adapter and the fixture recorder.
// Usage policy: https://operations.osmfoundation.org/policies/nominatim/ (see docs/DATA_SOURCES.md).

export const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';

// The policy allows at most one request per second for the whole app.
export const NOMINATIM_MIN_INTERVAL_MS = 1100;

export const SEARCH_RESULT_LIMIT = 5;

// US only for now, matching the data sources (USGS, NWPS, NWS).
export function searchUrl(query: string): string {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    countrycodes: 'us',
    limit: String(SEARCH_RESULT_LIMIT),
  });
  return `${NOMINATIM_BASE_URL}/search?${params}`;
}
