import { type RuleSet, type SavedLocation, toInternal } from '@rowing/core';
import { describe, expect, it } from 'vitest';
import montague from '../../../test/fixtures/conditions-montague.json' with { type: 'json' };
import northfield from '../../../test/fixtures/conditions-northfield.json' with { type: 'json' };
import { NAMED_GAUGE, withNamedGauge } from '../../../test/namedGauge.ts';
import type { Conditions } from '../../lib/api.ts';
import { evaluateLocation } from './evaluateLocation.ts';
import { dewPointGapWords, fogWords, type MeteogramRow, meteogramModel } from './meteogramModel.ts';

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
    location?: SavedLocation;
  } = {},
) {
  const at = options.location ?? location;
  const conditions = options.conditions ?? data();
  const ruleSet = options.ruleSet === undefined ? clubA : options.ruleSet;
  const rs = options.boatClass
    ? { ...ruleSet, boatClasses: ruleSet.boatClasses.filter((c) => c.id === options.boatClass) }
    : ruleSet;
  return meteogramModel({
    conditions,
    location: at,
    units: options.units ?? 'us',
    now: NOW,
    evaluated: evaluateLocation(conditions, at, rs, NOW),
  });
}
const row = (m: ReturnType<typeof model>, id: MeteogramRow['id']) => {
  const found = m.rows.find((r) => r.id === id);
  if (!found) throw new Error(`no ${id} row`);
  return found;
};

describe('meteogramModel rows', () => {
  it('stacks river, wind, air, water and rain, in that order', () => {
    expect(model({ conditions: data(northfield) }).rows.map((r) => r.id)).toEqual([
      'flow',
      'wind',
      'airTemp',
      'waterTemp',
      'rain',
    ]);
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

  it('leaves out water temperature at a gauge without it', () => {
    expect(model().rows.map((r) => r.id)).toEqual(['flow', 'wind', 'airTemp', 'rain']);
  });

  it.each([
    ['waterTemp', 'degF', 50],
    ['combinedTempF', 'degF', 90],
  ] as const)(
    'says water temperature is not measured when a %s limit needs it',
    (metric, unit, v) => {
      const ruleSet: RuleSet = {
        ...clubA,
        thresholds: [
          ...clubA.thresholds,
          {
            id: 'water',
            metric,
            comparison: 'min',
            boundary: 'inclusive',
            value: metric === 'combinedTempF' ? v : toInternal(metric, v, unit),
            enteredUnit: unit,
          },
        ],
      };
      expect(row(model({ ruleSet }), 'waterTemp')).toMatchObject({
        kind: 'message',
        message: 'Not measured at this gauge.',
      });
    },
  );

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
    expect(m.statuses).toEqual([]);
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

  it('rounds each scale to steps of 1, 2 or 5, so its top and bottom read cleanly', () => {
    const m = model();
    expect(row(m, 'flow').domain).toEqual([3000, 4000]);
    expect(row(m, 'wind').domain).toEqual([0, 25]);
    expect(row(m, 'airTemp').domain).toEqual([10, 80]);
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

  it('marks a measured current hour followed by forecasts, and reads it out as measured', () => {
    const conditions = data();
    const first = conditions.forecast[0];
    if (first) {
      first.values.flow = toInternal('flow', 1860, 'cfs');
      first.provenance.flow = {
        kind: 'observation',
        asOf: '2026-10-26T12:15:00.000Z',
        source: 'usgs',
      };
    }
    const flow = row(model({ conditions }), 'flow');
    expect(flow.series[0]?.points[0]).toMatchObject({ value: 1860, measured: true });
    expect(flow.series[0]?.points[1]?.measured).toBeUndefined();
    expect(flow.readouts[0]).toBe('1,860 cfs measured · 1,240 under');
    expect(flow.readouts[1]).not.toContain('measured');
    expect(row(model(), 'flow').series[0]?.points[0]?.measured).toBeUndefined();
  });

  it('leaves a held reading unmarked, since no forecast follows it', () => {
    const conditions = data();
    for (const p of conditions.forecast)
      p.provenance.flow = { kind: 'observation', asOf: '2026-10-26T12:15:00.000Z', source: 'usgs' };
    expect(row(model({ conditions }), 'flow').series[0]?.points.some((p) => p.measured)).toBe(
      false,
    );
  });

  it('says when an hour has no value', () => {
    const conditions = data();
    const p = conditions.forecast[3];
    if (p) p.values.flow = null;
    expect(row(model({ conditions }), 'flow').readouts[3]).toBe('no value');
  });
});

describe('meteogramModel status and windows', () => {
  it('turns the periods into spans, dawn to dusk, so they match the windows', () => {
    const m = model();
    const spans = m.statuses[0]?.spans ?? [];
    expect(spans.map((s) => s.status)).toEqual(['outside', 'within', 'within', 'outside']);
    expect(spans[0]).toMatchObject({ from: 0, to: 6, words: 'Today 8 AM to 2 PM' });
    // Night is blank: today's span ends at dusk, and tomorrow's starts at dawn.
    expect(spans[1]).toMatchObject({ from: 6, words: 'Today 2 PM to 6:20 PM' });
    expect(spans[2]?.words).toBe('Tomorrow 6:49 AM to 6:18 PM');
    // The within spans are the windows.
    for (const [i, w] of m.windows.entries()) {
      expect(spans[i + 1]).toMatchObject({ from: w.from, to: w.to });
    }
  });

  it('gives each attached rule set its own strip, and draws only the selected one’s limits', () => {
    // A second club on the same water: one class, and a flow limit of 20 kcfs instead of 3,100 cfs.
    const clubB: RuleSet = {
      id: 'rs-b',
      name: 'Club B',
      boatClasses: [{ id: 'all', name: 'All boats' }],
      thresholds: [
        {
          id: 'flow-b',
          metric: 'flow',
          comparison: 'max',
          boundary: 'inclusive',
          value: toInternal('flow', 20, 'kcfs'),
          enteredUnit: 'kcfs',
        },
      ],
    };
    const conditions = data();
    const a = evaluateLocation(conditions, location, clubA, NOW);
    const b = evaluateLocation(conditions, location, clubB, NOW);
    if (!a || !b) throw new Error('expected evaluations');
    const m = meteogramModel({
      conditions,
      location,
      units: 'us',
      now: NOW,
      evaluated: b,
      alongside: [a, b],
    });

    expect(m.statuses.map((s) => [s.name, s.sub, s.selected])).toEqual([
      ['Club A', '1x and 2x', false],
      ['Club B', 'all limits', true],
    ]);
    // Club A is outside early on (flow over 3,100 cfs); Club B is within for every hour.
    expect(m.statuses[0]?.spans[0]).toMatchObject({ from: 0, to: 6, status: 'outside' });
    expect(m.statuses[1]?.spans.every((s) => s.status === 'within')).toBe(true);
    expect(row(m, 'flow').limits.map((l) => l.value)).toEqual([20000]);
    expect(row(m, 'wind').limits).toEqual([]);
  });

  it('evaluates the chosen boat class, falling back to the first', () => {
    const conditions = data();
    expect(evaluateLocation(conditions, location, clubA, NOW, 'big')?.boatClassName).toBe('8+');
    expect(evaluateLocation(conditions, location, clubA, NOW, 'gone')?.boatClassName).toBe(
      '1x and 2x',
    );
  });

  it('marks windows within the limits, in time order', () => {
    const windows = model().windows;
    expect(windows[0]?.from).toBe(6);
    expect(windows[0]?.to).toBeCloseTo(10.33, 1);
    expect(windows[1]?.from).toBeCloseTo(22.82, 1);
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
    expect(m.windows).toHaveLength(1);
    expect(m.windows[0]?.from).toBeCloseTo(22.82, 1);
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

  it('names the light in each hour in words, including hours that cross sunset and dusk', () => {
    const m = model();
    expect(m.hours[6]?.light).toBe('Daylight');
    expect(m.hours[9]?.light).toBe('Daylight, then twilight');
    expect(m.hours[10]?.light).toBe('Twilight, then night');
    expect(m.hours[14]?.light).toBe('Night');
  });
});

describe('meteogramModel with a rule set that names its flow gauge', () => {
  const named: RuleSet = { ...clubA, flowGaugeRef: NAMED_GAUGE };

  it('draws flow, the measurement and the gauge name from that gauge, not the location’s', () => {
    const flow = row(model({ conditions: withNamedGauge(data()), ruleSet: named }), 'flow');
    const own = row(model(), 'flow');
    const value = (r: MeteogramRow, i: number) => r.series[0]?.points[i]?.value ?? 0;
    expect(value(flow, 5)).toBeCloseTo(value(own, 5) * 2, -1);
    expect(flow.observed?.label).toBe('9,000 measured 8:15 AM');
    expect(flow.sub).toBe('cfs, limit 3,100 · gauge: North River at Shattuckville, MA');
    expect(own.sub).toBe('cfs, limit 3,100');
  });

  it('shows flow at a weather-only location instead of saying it has no gauge', () => {
    const lake = { ...location, gaugeRef: undefined };
    const conditions = withNamedGauge(data(), { weatherOnly: true });
    expect(row(model({ conditions, location: lake }), 'flow').message).toBe(
      'No gauge for this location (weather only).',
    );
    const flow = row(model({ conditions, location: lake, ruleSet: named }), 'flow');
    expect(flow.kind).toBe('line');
    expect(flow.observed?.label).toBe('9,000 measured 8:15 AM');
  });

  it('says so when the named gauge sent no flow', () => {
    const conditions = { ...data(), flowSeries: [] };
    expect(row(model({ conditions, ruleSet: named }), 'flow')).toMatchObject({
      kind: 'message',
      message: 'No flow values from USGS 01169000.',
    });
  });
});

describe('fog and dew point (#42)', () => {
  it('words the NWS fog coverage, and never calls an uncovered hour fog-free', () => {
    expect(fogWords('patchy')).toEqual({ state: 'fog', text: 'Patchy fog' });
    expect(fogWords('areas')).toEqual({ state: 'fog', text: 'Areas of fog' });
    expect(fogWords('unspecified')).toEqual({ state: 'fog', text: 'Fog' });
    expect(fogWords('frequent')).toEqual({ state: 'fog', text: 'Fog (frequent)' });
    expect(fogWords(null)).toEqual({ state: 'none', text: 'No fog forecast' });
    expect(fogWords(undefined)).toEqual({ state: 'unknown', text: 'Fog forecast unknown' });
  });

  it('gives the dew point gap as a temperature difference, without the 32° offset', () => {
    expect(dewPointGapWords(5, 'degF')).toBe('9° above dew point');
    expect(dewPointGapWords(5, 'degC')).toBe('5.0° above dew point');
    expect(dewPointGapWords(0.2, 'degF')).toBe('at dew point');
    expect(dewPointGapWords(-0.5, 'degF')).toBe('at dew point');
  });

  it('labels each hour with its fog, and adds the dew point gap to the air temperature readout', () => {
    const conditions = data();
    for (const [i, p] of conditions.forecast.entries()) {
      p.values.dewPoint = (p.values.airTemp ?? 0) - 2;
      p.provenance.dewPoint = { kind: 'forecast', asOf: NOW, source: 'nws' };
      if (i === 3) p.fog = 'patchy';
      else if (i < 6) p.fog = null;
    }
    const m = model({ conditions });
    expect(m.hours[3]?.fog).toEqual({ state: 'fog', text: 'Patchy fog' });
    expect(m.hours[4]?.fog.state).toBe('none');
    expect(m.hours[10]?.fog.state).toBe('unknown');
    expect(row(m, 'airTemp').readouts[5]).toMatch(/· 4° above dew point$/);
  });

  it('leaves the gap out when there is no dew point', () => {
    expect(row(model(), 'airTemp').readouts[5]).not.toContain('dew point');
  });
});
