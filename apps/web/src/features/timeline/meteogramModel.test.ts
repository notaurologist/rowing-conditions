import { type RuleSet, type SavedLocation, toInternal } from '@rowing/core';
import { describe, expect, it } from 'vitest';
import montague from '../../../test/fixtures/conditions-montague.json' with { type: 'json' };
import northfield from '../../../test/fixtures/conditions-northfield.json' with { type: 'json' };
import type { Conditions } from '../../lib/api.ts';
import { evaluateLocation } from './evaluateLocation.ts';
import { type MeteogramRow, meteogramModel } from './meteogramModel.ts';

// Recorded from the live API. Montague (USGS-01170500) has an NWPS flow forecast and no water
// temperature; Northfield (USGS-01161280) has no forecast but measures water temperature.
const NOW = '2026-10-26T12:35:00.000Z'; // 8:35 AM in Turners Falls
const location: SavedLocation = {
  id: 'l',
  name: 'Turners Falls',
  lat: 42.6,
  lon: -72.55,
  gaugeRef: 'usgs:USGS-01170500',
  ruleSetIds: ['rs'],
};
const data = (fixture: unknown = montague) => structuredClone(fixture) as Conditions;

const clubA: RuleSet = {
  id: 'rs',
  name: 'Club A',
  boatClasses: [
    { id: 'small', name: '1x and 2x' },
    { id: 'big', name: '8+' },
  ],
  thresholds: [
    {
      id: 'flow',
      metric: 'flow',
      comparison: 'max',
      boundary: 'inclusive',
      value: toInternal('flow', 3100, 'cfs'),
      enteredUnit: 'cfs',
    },
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
      id: 'air',
      metric: 'airTemp',
      comparison: 'min',
      boundary: 'inclusive',
      value: toInternal('airTemp', 35, 'degF'),
      enteredUnit: 'degF',
    },
  ],
};

function model(
  options: {
    conditions?: Conditions;
    ruleSet?: RuleSet;
    units?: 'us' | 'metric';
    boatClass?: string;
  } = {},
) {
  const conditions = options.conditions ?? data();
  const ruleSet = options.ruleSet === undefined ? clubA : options.ruleSet;
  const rs = options.boatClass
    ? { ...ruleSet, boatClasses: ruleSet.boatClasses.filter((c) => c.id === options.boatClass) }
    : ruleSet;
  return meteogramModel({
    conditions,
    location,
    units: options.units ?? 'us',
    now: NOW,
    evaluated: evaluateLocation(conditions, location, rs, NOW),
  });
}
const row = (m: ReturnType<typeof model>, id: MeteogramRow['id']) => {
  const found = m.rows.find((r) => r.id === id);
  if (!found) throw new Error(`no ${id} row`);
  return found;
};

describe('meteogramModel rows', () => {
  it('stacks river, wind, air, water and rain, in that order', () => {
    expect(model().rows.map((r) => r.id)).toEqual(['flow', 'wind', 'airTemp', 'waterTemp', 'rain']);
  });

  it('draws flow in display units, one point per forecast hour', () => {
    const flow = row(model(), 'flow');
    expect(flow.kind).toBe('line');
    expect(flow.unit).toBe('cfs');
    expect(flow.series[0]?.points).toHaveLength(48);
    expect(flow.series[0]?.points[0]?.value).toBe(3230);
    expect(row(model({ units: 'metric' }), 'flow').unit).toBe('m³/s');
  });

  it('draws wind as a band from sustained speed to gusts, with direction arrows every 3 hours', () => {
    const wind = row(model(), 'wind');
    expect(wind.kind).toBe('band');
    expect(wind.series.map((s) => s.role)).toEqual(['main', 'gust']);
    expect(wind.arrows?.map((a) => a.index)).toEqual([
      1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34, 37, 40, 43, 46,
    ]);
    expect(wind.arrows?.[0]?.degrees).toBe(200);
  });

  it('says water temperature is not measured at a gauge without it', () => {
    expect(row(model(), 'waterTemp')).toMatchObject({
      kind: 'message',
      message: 'Not measured at this gauge.',
    });
  });

  it('draws water temperature where the gauge measures it', () => {
    const water = row(model({ conditions: data(northfield) }), 'waterTemp');
    expect(water.kind).toBe('line');
    expect(water.unit).toBe('°F');
  });

  it('shows weather-only locations without a river row', () => {
    const conditions = data();
    delete conditions.gauge;
    for (const p of conditions.forecast) {
      delete p.values.flow;
      delete p.values.gaugeHeight;
      delete p.provenance.flow;
      delete p.provenance.gaugeHeight;
    }
    conditions.current = conditions.current.filter((r) => r.source !== 'usgs');
    const { gaugeRef: _, ...lakeLocation } = location;
    const m = meteogramModel({
      conditions,
      location: lakeLocation,
      units: 'us',
      now: NOW,
      evaluated: evaluateLocation(conditions, lakeLocation, clubA, NOW),
    });
    expect(row(m, 'flow')).toMatchObject({
      kind: 'message',
      message: 'No gauge for this location (weather only).',
    });
    expect(m.rows.some((r) => r.id === 'waterTemp')).toBe(false);
  });

  it('draws rain chance as bars on a 0 to 100% scale', () => {
    const rain = row(model(), 'rain');
    expect(rain.kind).toBe('bars');
    expect(rain.domain).toEqual([0, 100]);
  });
});

describe('meteogramModel limits', () => {
  it('puts each applicable limit on its row, in the chart unit', () => {
    const m = model();
    expect(row(m, 'flow').limits).toEqual([
      { thresholdId: 'flow', metric: 'flow', comparison: 'max', value: 3100, label: 'limit 3,100' },
    ]);
    expect(row(m, 'wind').limits).toMatchObject([
      { metric: 'windGust', value: 15, label: 'gust limit 15' },
    ]);
    expect(row(m, 'airTemp').limits).toMatchObject([
      { comparison: 'min', value: 35, label: 'limit 35°' },
    ]);
  });

  it('leaves out limits that do not apply to the boat class', () => {
    expect(row(model({ boatClass: 'big' }), 'wind').limits).toEqual([]);
  });

  it('has no limits, status or windows without a rule set', () => {
    const m = model({ ruleSet: { ...clubA, boatClasses: [] } });
    expect(m.rows.every((r) => r.limits.length === 0)).toBe(true);
    expect(m.status).toBeNull();
    expect(m.windows).toEqual([]);
  });

  it('keeps every limit and observed value inside the row’s scale', () => {
    for (const r of model().rows) {
      const [lo, hi] = r.domain;
      for (const l of r.limits)
        expect(l.value).toBeGreaterThan(lo), expect(l.value).toBeLessThan(hi);
      if (r.observed)
        expect(r.observed.value).toBeGreaterThanOrEqual(lo),
          expect(r.observed.value).toBeLessThan(hi);
    }
  });

  it('starts flow, wind and rain at zero or above, and gives wind room for its arrows', () => {
    const m = model();
    expect(row(m, 'wind').domain[0]).toBe(0);
    expect(row(m, 'wind').domain[1]).toBeGreaterThanOrEqual(15 * 1.3);
    expect(row(m, 'flow').domain[0]).toBeGreaterThanOrEqual(0);
  });
});

describe('meteogramModel measurements and readouts', () => {
  it('pins a measurement far off the forecast’s scale to the edge, so the forecast keeps its detail', () => {
    const conditions = data();
    const flow = conditions.current.find((r) => r.metric === 'flow');
    if (flow) flow.value = 183.5; // 6,480 cfs, double the forecast
    const r = row(model({ conditions }), 'flow');
    expect(r.domain[1]).toBeLessThan(4000);
    expect(r.observed).toMatchObject({
      value: 6480,
      offScale: 'above',
      label: '6,480 measured 8:15 AM ↑',
    });
  });

  it('keeps a measurement near the forecast on the scale', () => {
    expect(row(model(), 'flow').observed?.offScale).toBeUndefined();
  });

  it('places the latest measurement at the current time, labelled', () => {
    const m = model();
    expect(row(m, 'flow').observed).toMatchObject({
      value: 3750,
      at: 0.58,
      label: '3,750 measured 8:15 AM',
    });
    expect(row(m, 'airTemp').observed?.label).toBe('30° measured 8:30 AM');
    expect(row(m, 'wind').observed?.label).toBe('calm');
  });

  it('reads out every row at an hour, with the margin to its limit', () => {
    const m = model();
    expect(row(m, 'flow').readouts[6]).toBe('3,090 cfs · 10 under');
    expect(row(m, 'flow').readouts[0]).toBe('3,230 cfs · 130 over');
    expect(row(m, 'wind').readouts[6]).toBe('6, gusts 12 mph · 3 under · from W');
    expect(row(m, 'airTemp').readouts[6]).toBe('65 °F · 30 above');
    expect(row(m, 'airTemp').readouts[0]).toBe('26 °F · 9 below');
    expect(row(m, 'rain').readouts[6]).toBe('2%');
  });

  it('says when an hour has no value', () => {
    const conditions = data();
    const p = conditions.forecast[3];
    if (p) p.values.flow = null;
    expect(row(model({ conditions }), 'flow').readouts[3]).toBe('no value');
  });
});

describe('meteogramModel status and windows', () => {
  it('turns hourly statuses into spans', () => {
    expect(model().status).toEqual([
      { from: 0, to: 6, status: 'outside' },
      { from: 6, to: 37, status: 'within' },
      { from: 37, to: 48, status: 'outside' },
    ]);
  });

  it('marks windows within the limits, the next one first and named', () => {
    const windows = model().windows;
    expect(windows[0]).toMatchObject({ from: 6, label: 'Next window · 2 – 6:20 PM' });
    expect(windows[0]?.to).toBeCloseTo(10.33, 1);
    expect(windows[1]).toMatchObject({ label: 'Tue · 6:49 AM – 6:18 PM' });
  });

  it('leaves out windows that have already ended', () => {
    const conditions = data();
    const later = '2026-10-27T00:00:00.000Z'; // 8 PM, after today's window closed
    // A fresher weather forecast, so the hours aren't stale at 8 PM.
    for (const p of conditions.forecast) {
      for (const prov of Object.values(p.provenance))
        if (prov?.source === 'nws') prov.asOf = '2026-10-26T20:00:00.000Z';
    }
    const m = meteogramModel({
      conditions,
      location,
      units: 'us',
      now: later,
      evaluated: evaluateLocation(conditions, location, clubA, later),
    });
    expect(m.windows.map((w) => w.label)).toEqual(['Next window · 6:49 AM – 6:18 PM']);
  });

  it('starts the readout at the next window', () => {
    expect(model().defaultHour).toBe(6);
    expect(model({ ruleSet: { ...clubA, boatClasses: [] } }).defaultHour).toBe(0);
  });
});

describe('meteogramModel time and light', () => {
  it('shades twilight and night from the exact daylight times', () => {
    const bands = model().light;
    expect(bands.map((b) => b.light)).toEqual([
      'twilight',
      'night',
      'twilight',
      'twilight',
      'night',
      'twilight',
    ]);
    expect(bands[0]?.from).toBeCloseTo(9.85, 1);
  });

  it('labels days at local midnight and hours every six', () => {
    const m = model();
    expect(m.days).toEqual([
      { at: 0, label: 'Mon 26' },
      { at: 16, label: 'Tue 27' },
      { at: 40, label: 'Wed 28' },
    ]);
    expect(m.ticks.map((t) => t.label)).toEqual(['noon', '6 PM', '6 AM', 'noon', '6 PM', '6 AM']);
  });

  it('names each hour for the readout', () => {
    const m = model();
    expect(m.hours[6]?.label).toBe('Today 2 PM');
    expect(m.hours[35]?.label).toBe('Tomorrow 7 PM');
  });
});
