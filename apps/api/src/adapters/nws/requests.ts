// URLs for the National Weather Service API. Shared by the adapter and the fixture recorder.
// See docs/DATA_SOURCES.md.

export const NWS_BASE_URL = 'https://api.weather.gov';

// The API redirects points with more than 4 decimals, so round first.
const round4 = (n: number) => Number(n.toFixed(4));

export function pointsUrl(lat: number, lon: number): string {
  return `${NWS_BASE_URL}/points/${round4(lat)},${round4(lon)}`;
}

export function gridUrl(office: string, x: number, y: number): string {
  return `${NWS_BASE_URL}/gridpoints/${encodeURIComponent(office)}/${x},${y}`;
}

export function stationsUrl(office: string, x: number, y: number): string {
  return `${gridUrl(office, x, y)}/stations`;
}

export function latestObservationUrl(stationId: string): string {
  return `${NWS_BASE_URL}/stations/${encodeURIComponent(stationId)}/observations/latest`;
}

export function alertsUrl(lat: number, lon: number): string {
  return `${NWS_BASE_URL}/alerts/active?point=${round4(lat)},${round4(lon)}`;
}
