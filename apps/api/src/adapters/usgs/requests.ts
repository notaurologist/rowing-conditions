// URLs for the USGS Water Data APIs v1. Shared by the adapter and the fixture recorder, so
// recorded fixtures match the requests the adapter really makes. See docs/DATA_SOURCES.md.

export const USGS_BASE_URL = 'https://api.waterdata.usgs.gov/ogcapi/v1';

export const usgsParameterCodes = {
  flow: '00060',
  gaugeHeight: '00065',
  waterTemp: '00010',
} as const;

export const INSTANTANEOUS = '00011';

const allParameters = Object.values(usgsParameterCodes).join(',');

const readingFields = [
  'monitoring_location_id',
  'parameter_code',
  'statistic_id',
  'time',
  'value',
  'unit_of_measure',
  'approval_status',
  'qualifier',
].join(',');

function url(collection: string, params: Record<string, string>): string {
  const query = new URLSearchParams({ f: 'json', ...params });
  return `${USGS_BASE_URL}/collections/${collection}/items?${query.toString()}`;
}

// Stream gauges in [minLon, minLat, maxLon, maxLat].
export function nearbyLocationsUrl(bbox: readonly [number, number, number, number]): string {
  return url('monitoring-locations', {
    bbox: bbox.join(','),
    site_type_code: 'ST',
    properties: 'monitoring_location_name,site_type_code,state_name',
    limit: '500',
  });
}

export function locationUrl(locationId: string): string {
  return `${USGS_BASE_URL}/collections/monitoring-locations/items/${encodeURIComponent(locationId)}?f=json`;
}

// Which of our parameters each gauge reports.
export function timeSeriesMetadataUrl(locationIds: readonly string[]): string {
  return url('time-series-metadata', {
    monitoring_location_id: locationIds.join(','),
    parameter_code: allParameters,
    skipGeometry: 'true',
    properties: 'monitoring_location_id,parameter_code,statistic_id,unit_of_measure,begin,end',
    limit: '5000',
  });
}

export function latestReadingsUrl(locationIds: readonly string[]): string {
  return url('latest-continuous', {
    monitoring_location_id: locationIds.join(','),
    parameter_code: allParameters,
    skipGeometry: 'true',
    properties: readingFields,
    limit: '5000',
  });
}

// Readings in [from, to], both ISO 8601 UTC.
export function historyUrl(
  locationId: string,
  parameterCode: string,
  from: string,
  to: string,
): string {
  return url('continuous', {
    monitoring_location_id: locationId,
    parameter_code: parameterCode,
    time: `${from}/${to}`,
    skipGeometry: 'true',
    properties: readingFields,
    limit: '10000',
  });
}
