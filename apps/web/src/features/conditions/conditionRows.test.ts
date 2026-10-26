import { describe, expect, it } from 'vitest';
import recorded from '../../../test/fixtures/conditions-northfield.json' with { type: 'json' };
import type { Conditions } from '../../lib/api.ts';
import {
  type ConditionRow,
  conditionRows,
  sourceNotices,
  todaysDaylight,
} from './conditionRows.ts';

// Recorded from the live API at 02:15Z on 2026-10-26 for the Northfield gauge (USGS-01161280).
const NOW = '2026-10-26T02:20:00.000Z';
const base = () => structuredClone(recorded) as Conditions;

const row = (rows: ConditionRow[], metric: ConditionRow['metric']) => {
  const found = rows.find((r) => r.metric === metric);
  if (!found) throw new Error(`no ${metric} row`);
  return found;
};

describe('conditionRows', () => {
  it('lists water temperature first, then river and weather metrics', () => {
    expect(conditionRows(base(), { units: 'us', now: NOW }).map((r) => r.metric)).toEqual([
      'waterTemp',
      'flow',
      'gaugeHeight',
      'airTemp',
      'windSpeed',
      'windGust',
      'windDirection',
    ]);
  });

  it('shows values in US units at display precision', () => {
    const rows = conditionRows(base(), { units: 'us', now: NOW });
    expect(row(rows, 'waterTemp')).toMatchObject({ state: 'value', value: '53', unit: '°F' });
    expect(row(rows, 'flow')).toMatchObject({ value: '2,070', unit: 'cfs' });
    expect(row(rows, 'gaugeHeight')).toMatchObject({ value: '12.21', unit: 'ft' });
    expect(row(rows, 'airTemp')).toMatchObject({ value: '36', unit: '°F' });
    expect(row(rows, 'windSpeed')).toMatchObject({ value: '0', unit: 'mph' });
  });

  it('shows the same readings in metric units', () => {
    const rows = conditionRows(base(), { units: 'metric', now: NOW });
    expect(row(rows, 'waterTemp')).toMatchObject({ value: '11.7', unit: '°C' });
    expect(row(rows, 'flow')).toMatchObject({ value: '58.6', unit: 'm³/s' });
    expect(row(rows, 'gaugeHeight')).toMatchObject({ value: '3.72', unit: 'm' });
    expect(row(rows, 'airTemp')).toMatchObject({ value: '2.0', unit: '°C' });
    expect(row(rows, 'windSpeed')).toMatchObject({ value: '0', unit: 'km/h' });
  });

  it('gives every value its source and observation time', () => {
    const rows = conditionRows(base(), { units: 'us', now: NOW });
    for (const r of rows.filter((r) => r.state === 'value')) {
      expect(r.source, r.metric).toBeTruthy();
      expect(r.observedAt, r.metric).toBeTruthy();
    }
    expect(row(rows, 'flow')).toMatchObject({
      source: 'USGS gauge: CONNECTICUT RIVER NEAR NORTHFIELD, MA',
      observedAt: '2026-10-26T01:00:00.000Z',
      kind: 'observation',
      freshness: 'fresh',
    });
    expect(row(rows, 'airTemp').source).toBe('NWS station: Orange Municipal Airport, 13.5 mi away');
  });

  it('labels weather taken from the forecast when no station is close enough', () => {
    const conditions = base();
    conditions.currentBasis = 'forecast';
    delete conditions.station;
    const rows = conditionRows(conditions, { units: 'us', now: NOW });
    expect(row(rows, 'airTemp')).toMatchObject({
      source: 'NWS forecast for this hour',
      kind: 'forecast',
    });
  });

  it('shows qualifiers in words, marking those that keep a value out of limits', () => {
    const conditions = base();
    const flow = conditions.current.find((r) => r.metric === 'flow');
    if (flow) flow.qualifiers = ['provisional', 'iceAffected'];
    const rows = conditionRows(conditions, { units: 'us', now: NOW });
    expect(row(rows, 'flow').qualifiers).toEqual([
      { qualifier: 'provisional', label: 'Provisional', disqualifying: false },
      { qualifier: 'iceAffected', label: 'Ice affected', disqualifying: true },
    ]);
    expect(row(rows, 'waterTemp').qualifiers).toEqual([
      { qualifier: 'provisional', label: 'Provisional', disqualifying: false },
    ]);
  });

  it('marks a reading older than its maximum age as stale', () => {
    const rows = conditionRows(base(), { units: 'us', now: '2026-10-26T07:30:00.000Z' });
    expect(row(rows, 'flow').freshness).toBe('stale'); // 6.5 h old; limit 6 h
    expect(row(rows, 'waterTemp').freshness).toBe('fresh'); // limit 24 h
  });

  it('marks a reading dated well in the future', () => {
    const rows = conditionRows(base(), { units: 'us', now: '2026-10-25T23:00:00.000Z' });
    expect(row(rows, 'flow').freshness).toBe('future');
  });

  it('says when the source reported no value', () => {
    const gust = row(conditionRows(base(), { units: 'us', now: NOW }), 'windGust');
    expect(gust).toMatchObject({ state: 'noValue', message: 'No gusts reported' });
    expect(gust.source).toBeTruthy();
    expect(gust.value).toBeUndefined();
  });

  it('says when the gauge does not report a metric', () => {
    const conditions = base();
    conditions.current = conditions.current.filter((r) => r.metric !== 'waterTemp');
    expect(row(conditionRows(conditions, { units: 'us', now: NOW }), 'waterTemp')).toMatchObject({
      state: 'notReported',
      message: "This gauge doesn't report water temperature",
    });
  });

  it('explains river metrics in weather-only mode', () => {
    const conditions = base();
    delete conditions.gauge;
    conditions.current = conditions.current.filter((r) => r.source !== 'usgs');
    const rows = conditionRows(conditions, { units: 'us', now: NOW });
    for (const metric of ['waterTemp', 'flow', 'gaugeHeight'] as const) {
      expect(row(rows, metric)).toMatchObject({
        state: 'noGauge',
        message: 'No gauge for this location (weather only)',
      });
    }
  });

  it('reports a failed source instead of calling its metrics unreported', () => {
    const conditions = base();
    conditions.current = conditions.current.filter((r) => r.source !== 'nws');
    conditions.sources = conditions.sources.map((s) =>
      s.id === 'nws' ? { id: 'nws', status: 'error', message: 'nws timed out' } : s,
    );
    const rows = conditionRows(conditions, { units: 'us', now: NOW });
    expect(row(rows, 'airTemp')).toMatchObject({
      state: 'sourceError',
      message: "Couldn't load from the National Weather Service",
    });
    expect(row(rows, 'flow').state).toBe('value');
  });

  it('calls a direction reported with no wind calm, rather than giving a heading', () => {
    // The recorded station reported 0 m/s from 0°, which NWS uses for calm.
    expect(row(conditionRows(base(), { units: 'us', now: NOW }), 'windDirection')).toMatchObject({
      state: 'noValue',
      message: 'Calm, no direction',
    });
  });

  it('gives wind direction as a compass point and degrees, without a unit system', () => {
    const conditions = base();
    const speed = conditions.current.find((r) => r.metric === 'windSpeed');
    if (speed) speed.value = 3;
    const dir = conditions.current.find((r) => r.metric === 'windDirection');
    if (dir) dir.value = 315;
    const us = row(conditionRows(conditions, { units: 'us', now: NOW }), 'windDirection');
    const metric = row(conditionRows(conditions, { units: 'metric', now: NOW }), 'windDirection');
    expect(us).toMatchObject({ value: 'NW', unit: '315°', label: 'Wind from' });
    expect(metric).toMatchObject({ value: 'NW', unit: '315°' });
  });
});

describe('sourceNotices', () => {
  it('is empty when every source is ok', () => {
    expect(sourceNotices(base())).toEqual([]);
  });

  it('names failed and stale sources in words', () => {
    const conditions = base();
    conditions.sources = [
      { id: 'usgs', status: 'stale', fetchedAt: '2026-10-26T01:00:00.000Z', message: 'HTTP 503' },
      { id: 'nwps', status: 'ok', fetchedAt: '2026-10-26T02:15:16.309Z' },
      { id: 'nws', status: 'error', message: 'nws timed out' },
    ];
    expect(sourceNotices(conditions)).toEqual([
      {
        source: 'usgs',
        status: 'stale',
        name: 'USGS',
        fetchedAt: '2026-10-26T01:00:00.000Z',
        message: 'HTTP 503',
      },
      {
        source: 'nws',
        status: 'error',
        name: 'the National Weather Service',
        message: 'nws timed out',
      },
    ]);
  });
});

describe('todaysDaylight', () => {
  it("picks the location's local date, not the UTC date", () => {
    // 02:20Z on Oct 26 is still Oct 25 in New York.
    expect(todaysDaylight(base(), NOW)?.date).toBe('2026-10-25');
    expect(todaysDaylight(base(), '2026-10-26T12:00:00.000Z')?.date).toBe('2026-10-26');
  });

  it('returns undefined when the date is missing', () => {
    expect(todaysDaylight(base(), '2027-01-01T12:00:00.000Z')).toBeUndefined();
  });
});
