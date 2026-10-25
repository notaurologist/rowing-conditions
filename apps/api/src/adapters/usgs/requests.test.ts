import { describe, expect, it } from 'vitest';
import {
  historyUrl,
  latestReadingsUrl,
  locationUrl,
  nearbyLocationsUrl,
  timeSeriesMetadataUrl,
} from './requests.ts';

const params = (url: string) => Object.fromEntries(new URL(url).searchParams);

describe('USGS request URLs', () => {
  it('uses the v1 base URL and asks for JSON, never the legacy WaterServices API', () => {
    for (const url of [
      nearbyLocationsUrl([-72.7, 42.45, -72.4, 42.75]),
      locationUrl('USGS-01170500'),
      latestReadingsUrl(['USGS-01170500']),
    ]) {
      expect(url.startsWith('https://api.waterdata.usgs.gov/ogcapi/v1/collections/')).toBe(true);
      expect(params(url).f).toBe('json');
      expect(url).not.toContain('waterservices');
    }
  });

  it('searches stream gauges in a bounding box', () => {
    const p = params(nearbyLocationsUrl([-72.7, 42.45, -72.4, 42.75]));
    expect(p).toMatchObject({ bbox: '-72.7,42.45,-72.4,42.75', site_type_code: 'ST' });
  });

  it('asks for flow, gauge height, and water temperature for several gauges at once', () => {
    for (const url of [
      latestReadingsUrl(['USGS-01170500', 'USGS-01161280']),
      timeSeriesMetadataUrl(['USGS-01170500', 'USGS-01161280']),
    ]) {
      expect(params(url)).toMatchObject({
        monitoring_location_id: 'USGS-01170500,USGS-01161280',
        parameter_code: '00060,00065,00010',
        skipGeometry: 'true',
      });
    }
  });

  it('requests the qualifier and approval fields with readings', () => {
    const fields = params(latestReadingsUrl(['USGS-01170500'])).properties?.split(',');
    expect(fields).toEqual(
      expect.arrayContaining(['value', 'time', 'qualifier', 'approval_status']),
    );
  });

  it('asks for history in an explicit UTC interval', () => {
    const p = params(
      historyUrl('USGS-01170500', '00060', '2026-10-25T13:00:00.000Z', '2026-10-25T19:00:00.000Z'),
    );
    expect(p.time).toBe('2026-10-25T13:00:00.000Z/2026-10-25T19:00:00.000Z');
  });
});
