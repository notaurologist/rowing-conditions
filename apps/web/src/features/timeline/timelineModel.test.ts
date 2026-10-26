import {
  type DaylightTimes,
  evaluateTimeline,
  type ForecastPoint,
  type RuleSet,
  toInternal,
} from '@rowing/core';
import { describe, expect, it } from 'vitest';
import montague from '../../../test/fixtures/conditions-montague.json' with { type: 'json' };
import northfield from '../../../test/fixtures/conditions-northfield.json' with { type: 'json' };
import { limitWording, timelineModel } from './timelineModel.ts';

// Recorded from the live API: Montague (NWPS flow forecast) and Northfield (no flow forecast).
const LAT = 42.6;
const LON = -72.55;
const forecast = () => structuredClone(montague.forecast) as ForecastPoint[];
const NOW = montague.forecast[0]?.time ?? '';

const clubA: RuleSet = {
  id: 'rs-a',
  name: 'Club A',
  boatClasses: [
    { id: 'small', name: '1x and 2x' },
    { id: 'big', name: '4+ and 8+' },
  ],
  thresholds: [
    {
      id: 'gust',
      metric: 'windGust',
      comparison: 'max',
      boundary: 'inclusive',
      value: toInternal('windGust', 15, 'mph'),
      enteredUnit: 'mph',
      boatClassIds: ['small'],
    },
    {
      id: 'flow',
      metric: 'flow',
      comparison: 'max',
      boundary: 'exclusive',
      value: toInternal('flow', 20, 'kcfs'),
      enteredUnit: 'kcfs',
    },
  ],
};

function evaluation(boatClassId = 'small', points = forecast()) {
  const result = evaluateTimeline({
    forecast: points,
    ruleSet: clubA,
    boatClassId,
    lat: LAT,
    lon: LON,
    now: NOW,
  });
  return { ruleSet: clubA, boatClassId, hours: result.hours };
}

const base = { lat: LAT, lon: LON, units: 'us' as const };

describe('timelineModel', () => {
  it('has one entry per forecast hour', () => {
    const model = timelineModel({ ...base, forecast: forecast(), metric: 'flow' });
    expect(model.hours).toHaveLength(48);
    expect(model.hours[0]?.time).toBe('2026-10-26T12:00:00.000Z');
  });

  it('converts values to the display unit at display precision', () => {
    const us = timelineModel({ ...base, forecast: forecast(), metric: 'flow' });
    const metric = timelineModel({
      ...base,
      units: 'metric',
      forecast: forecast(),
      metric: 'flow',
    });
    expect(us.unit).toBe('cfs');
    expect(metric.unit).toBe('m³/s');
    const first = montague.forecast[0]?.values.flow as number;
    expect(us.series[0]?.points[0]?.value).toBe(Math.round(first * 35.3146667));
    expect(metric.series[0]?.points[0]?.value).toBe(Math.round(first * 10) / 10);
  });

  it('shows wind as two series, speed and gusts', () => {
    const model = timelineModel({ ...base, forecast: forecast(), metric: 'wind' });
    expect(model.series.map((s) => [s.metric, s.label])).toEqual([
      ['windSpeed', 'Wind'],
      ['windGust', 'Gusts'],
    ]);
    expect(model.unit).toBe('mph');
  });

  it('shows rain chance as a percentage', () => {
    const points = forecast();
    const first = points[0];
    if (first) first.values.precipChance = 0.35;
    const model = timelineModel({ ...base, forecast: points, metric: 'precipChance' });
    expect(model.unit).toBe('%');
    expect(model.series[0]?.points[0]?.value).toBe(35);
  });

  it('adds air and water temperature in °F for the combined chart, in either unit system', () => {
    const points = forecast().map((p) => ({
      ...p,
      values: { ...p.values, airTemp: 10, waterTemp: 5 },
    }));
    const model = timelineModel({
      ...base,
      units: 'metric',
      forecast: points,
      metric: 'combinedTempF',
    });
    expect(model.unit).toBe('°F');
    expect(model.series[0]?.points[0]?.value).toBe(50 + 41);
  });

  it('leaves gaps where a value is null or absent', () => {
    const points = forecast();
    const a = points[3];
    const b = points[4];
    if (a) a.values.flow = null;
    if (b) delete b.values.flow;
    const values = timelineModel({ ...base, forecast: points, metric: 'flow' }).series[0]?.points;
    expect(values?.[3]?.value).toBeNull();
    expect(values?.[4]?.value).toBeNull();
    expect(values?.[5]?.value).not.toBeNull();
  });

  it('includes only the limits that apply to the boat class, worded as entered', () => {
    const small = timelineModel({
      ...base,
      forecast: forecast(),
      metric: 'wind',
      evaluation: evaluation('small'),
    });
    expect(small.limits).toEqual([
      { thresholdId: 'gust', metric: 'windGust', value: 15, label: 'Club A gusts: at most 15 mph' },
    ]);
    const big = timelineModel({
      ...base,
      forecast: forecast(),
      metric: 'wind',
      evaluation: evaluation('big'),
    });
    expect(big.limits).toEqual([]);
  });

  it('places a limit in the chart unit even when it was entered in another', () => {
    const model = timelineModel({
      ...base,
      units: 'metric',
      forecast: forecast(),
      metric: 'flow',
      evaluation: evaluation(),
    });
    expect(model.limits[0]?.label).toBe('Club A flow: below 20.0 kcfs');
    expect(model.limits[0]?.value).toBeCloseTo(566.3, 1); // 20 kcfs in m³/s
  });

  it('takes each hour’s status from the evaluation, and has none without a rule set', () => {
    const evaluated = timelineModel({
      ...base,
      forecast: forecast(),
      metric: 'flow',
      evaluation: evaluation(),
    });
    expect(evaluated.hours.every((h) => h.status !== undefined)).toBe(true);
    const plain = timelineModel({ ...base, forecast: forecast(), metric: 'flow' });
    expect(plain.hours.every((h) => h.status === undefined)).toBe(true);
  });

  it('labels each hour’s light level, and groups runs into bands', () => {
    const model = timelineModel({ ...base, forecast: forecast(), metric: 'flow' });
    // 12:00Z is 8 AM in Turners Falls on Oct 26: daylight. 23:00Z is 7 PM: dark.
    expect(model.hours[0]?.light).toBe('daylight');
    expect(model.hours[11]?.light).toBe('dark');
    const bands = model.lightBands;
    expect(bands[0]).toMatchObject({ light: 'daylight', start: '2026-10-26T12:00:00.000Z' });
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i]?.start).toBe(bands[i - 1]?.end);
      expect(bands[i]?.light).not.toBe(bands[i - 1]?.light);
    }
    expect(bands.at(-1)?.end).toBe('2026-10-28T12:00:00.000Z');
  });

  it('draws light bands from exact twilight times when daylight data is given', () => {
    const model = timelineModel({
      ...base,
      forecast: forecast(),
      metric: 'flow',
      daylight: structuredClone(montague.daylight) as DaylightTimes[],
    });
    const oct26 = montague.daylight.find((d) => d.date === '2026-10-26');
    // The chart starts in daylight on Oct 26, then evening twilight starts at sunset.
    expect(model.lightBands[0]).toEqual({
      light: 'daylight',
      start: '2026-10-26T12:00:00.000Z',
      end: oct26?.sunset,
    });
    expect(model.lightBands[1]).toEqual({
      light: 'twilight',
      start: oct26?.sunset,
      end: oct26?.civilDusk,
    });
    expect(model.lightBands[2]?.light).toBe('dark');
    expect(model.lightBands.filter((b) => b.light === 'twilight')).toHaveLength(4);
    expect(model.lightBands.at(-1)?.end).toBe('2026-10-28T12:00:00.000Z');
  });

  it('starts with the light level in effect at the first hour, when it starts at night', () => {
    // From 23:00Z (7 PM local), after civil dusk on Oct 26.
    const model = timelineModel({
      ...base,
      forecast: forecast().slice(11),
      metric: 'flow',
      daylight: structuredClone(montague.daylight) as DaylightTimes[],
    });
    expect(model.lightBands[0]).toMatchObject({ light: 'dark', start: '2026-10-26T23:00:00.000Z' });
    expect(model.lightBands[1]?.light).toBe('twilight'); // dawn on Oct 27
  });

  it('falls back to hourly light levels when a day has no sunrise', () => {
    const daylight = structuredClone(montague.daylight) as DaylightTimes[];
    const day = daylight[1];
    if (day) day.sun = 'alwaysDown';
    const model = timelineModel({ ...base, forecast: forecast(), metric: 'flow', daylight });
    expect(model.lightBands[0]?.end).toBe(
      timelineModel({ ...base, forecast: forecast(), metric: 'flow' }).lightBands[0]?.end,
    );
  });

  it('pads the value range and includes the limit line', () => {
    const model = timelineModel({
      ...base,
      forecast: forecast(),
      metric: 'wind',
      evaluation: evaluation(),
    });
    const [min, max] = model.domain;
    const values = model.series
      .flatMap((s) => s.points.map((p) => p.value))
      .filter((v) => v !== null);
    expect(min).toBe(0); // wind can't be negative
    expect(max).toBeGreaterThan(Math.max(...values, 15));
  });

  it('lets temperatures go below zero', () => {
    const points = forecast().map((p) => ({ ...p, values: { ...p.values, airTemp: -10 } }));
    const model = timelineModel({ ...base, units: 'metric', forecast: points, metric: 'airTemp' });
    expect(model.domain[0]).toBeLessThan(-10);
  });

  it('says where flow comes from: a forecast or a carried observation', () => {
    expect(timelineModel({ ...base, forecast: forecast(), metric: 'flow' }).flowSource).toEqual({
      kind: 'forecast',
      asOf: '2026-10-25T14:44:00.000Z',
    });
    const carried = timelineModel({
      ...base,
      forecast: structuredClone(northfield.forecast) as ForecastPoint[],
      metric: 'flow',
    });
    expect(carried.flowSource).toEqual({ kind: 'observation', asOf: '2026-10-26T01:00:00.000Z' });
    expect(timelineModel({ ...base, forecast: forecast(), metric: 'wind' }).flowSource).toBeNull();
  });
});

describe('limitWording', () => {
  it('words each comparison the way club policies do', () => {
    expect(limitWording('max', 'inclusive')).toBe('at most');
    expect(limitWording('max', 'exclusive')).toBe('below');
    expect(limitWording('min', 'inclusive')).toBe('at least');
    expect(limitWording('min', 'exclusive')).toBe('above');
  });
});
