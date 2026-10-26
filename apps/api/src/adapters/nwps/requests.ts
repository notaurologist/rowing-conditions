// URLs for the NOAA National Water Prediction Service API. Shared by the adapter and the fixture
// recorder. See docs/DATA_SOURCES.md.

export const NWPS_BASE_URL = 'https://api.water.noaa.gov/nwps/v1';

// identifier: an NWS location ID (MNTM3) or a bare USGS site number (01170500).
export function gaugeUrl(identifier: string): string {
  return `${NWPS_BASE_URL}/gauges/${encodeURIComponent(identifier)}`;
}

export function stageFlowUrl(lid: string): string {
  return `${NWPS_BASE_URL}/gauges/${encodeURIComponent(lid)}/stageflow`;
}

// Gauges in [minLon, minLat, maxLon, maxLat].
export function nearbyGaugesUrl(bbox: readonly [number, number, number, number]): string {
  const [xmin, ymin, xmax, ymax] = bbox;
  const query = new URLSearchParams({
    'bbox.xmin': String(xmin),
    'bbox.ymin': String(ymin),
    'bbox.xmax': String(xmax),
    'bbox.ymax': String(ymax),
    srid: 'EPSG_4326',
  });
  return `${NWPS_BASE_URL}/gauges?${query.toString()}`;
}
