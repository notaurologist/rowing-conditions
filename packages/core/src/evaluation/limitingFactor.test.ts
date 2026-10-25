import { describe, expect, it } from 'vitest';
import type { Metric, Unit } from '../types/measurement.ts';
import type { ForecastPoint, ValueProvenance } from '../types/readings.ts';
import type { RuleSet, Threshold } from '../types/rules.ts';
import { toSI } from '../units/units.ts';
import { evaluateTimeline, type TimelineInput } from './evaluate.ts';
import { findLimitingFactor } from './limitingFactor.ts';

const lat = 42.6;
const lon = -72.55;
const NOW = '2026-04-15T16:00:00Z';
const HOUR = 3_600_000;
const DAY_START = '2026-04-15T14:00:00Z'; // 10:00 EDT
const NIGHT = '2026-04-16T04:00:00Z'; // 00:00 EDT

const at = (iso: string, hours = 0) => new Date(Date.parse(iso) + hours * HOUR).toISOString();
const ago = (hours: number) => at(NOW, -hours);

function point(
  time: string,
  values: Partial<Record<Metric, number | null>>,
  provenance: Partial<Record<Metric, Partial<ValueProvenance>>> = {},
): ForecastPoint {
  const full: ForecastPoint['provenance'] = {};
  for (const metric of Object.keys(values) as Metric[]) {
    full[metric] = { kind: 'forecast', asOf: ago(1), source: 'nws', ...provenance[metric] };
  }
  return { time, values, provenance: full };
}

let nextId = 0;
function limit(
  metric: Metric,
  comparison: 'min' | 'max',
  value: number,
  enteredUnit: Unit,
  extra: Partial<Threshold> = {},
): Threshold {
  nextId += 1;
  const internal = metric === 'combinedTempF' ? value : toSI(value, enteredUnit);
  return {
    id: `t${nextId}`,
    metric,
    comparison,
    boundary: 'inclusive',
    value: internal,
    enteredUnit,
    ...extra,
  };
}

function ruleSet(thresholds: Threshold[], extra: Partial<RuleSet> = {}): RuleSet {
  return {
    id: 'rs',
    name: 'Club A rules',
    boatClasses: [
      { id: 'small', name: '1x' },
      { id: 'large', name: '8+' },
    ],
    thresholds,
    ...extra,
  };
}

// Daytime hours starting at DAY_START, one per entry.
function day(entries: Partial<Record<Metric, number | null>>[]): ForecastPoint[] {
  return entries.map((values, i) => point(at(DAY_START, i), values));
}

function limiting(
  forecast: ForecastPoint[],
  rs: RuleSet,
  boatClassId = 'small',
  extra: Partial<TimelineInput> = {},
) {
  const input: TimelineInput = { forecast, ruleSet: rs, boatClassId, lat, lon, now: NOW, ...extra };
  return findLimitingFactor(input, evaluateTimeline(input));
}

const mph = (v: number) => toSI(v, 'mph');
const kcfs = (v: number) => toSI(v, 'kcfs');

describe('findLimitingFactor: most hours outside', () => {
  it('picks the metric causing the most hours outside, even when another is further past its limit', () => {
    // Wind is just over for 3 hours (-0.07); water is far under for 1 hour (-0.5).
    const forecast = day([
      { windSpeed: mph(16), waterTemp: 5 },
      { windSpeed: mph(16), waterTemp: 12 },
      { windSpeed: mph(16), waterTemp: 12 },
    ]);
    const rs = ruleSet([
      limit('windSpeed', 'max', 15, 'mph'),
      limit('waterTemp', 'min', 10, 'degC'),
    ]);
    expect(limiting(forecast, rs)).toMatchObject({
      metric: 'windSpeed',
      reason: 'mostHoursOutside',
      hoursOutside: 3,
    });
  });

  it('breaks a tie by least headroom', () => {
    // Both outside for 2 hours. Gusts reach 30 against 20 (-0.5); wind 18 against 15 (-0.2).
    const forecast = day([
      { windSpeed: mph(18), windGust: mph(30) },
      { windSpeed: mph(18), windGust: mph(25) },
      { windSpeed: mph(10), windGust: mph(15) },
    ]);
    const rs = ruleSet([limit('windSpeed', 'max', 15, 'mph'), limit('windGust', 'max', 20, 'mph')]);
    const result = limiting(forecast, rs);
    expect(result).toMatchObject({
      metric: 'windGust',
      reason: 'mostHoursOutside',
      hoursOutside: 2,
    });
    expect(result?.headroom).toBeCloseTo(-0.5, 9);
  });

  it('counts an hour once when two limits on the same metric fail', () => {
    // A min and a max on water temperature: hour 1 fails the max, hour 2 the min.
    const forecast = day([{ waterTemp: 30 }, { waterTemp: 2 }, { waterTemp: 15 }]);
    const rs = ruleSet([
      limit('waterTemp', 'max', 25, 'degC'),
      limit('waterTemp', 'min', 5, 'degC'),
    ]);
    expect(limiting(forecast, rs)).toMatchObject({ metric: 'waterTemp', hoursOutside: 2 });
  });

  it('counts an hour once when two limits on the same metric fail in it', () => {
    // Wind fails both its limits in 3 hours; gusts fail in 4. Counted once, gusts lead.
    const forecast = day([
      { windSpeed: mph(20), windGust: mph(25) },
      { windSpeed: mph(20), windGust: mph(25) },
      { windSpeed: mph(20), windGust: mph(25) },
      { windSpeed: mph(5), windGust: mph(25) },
    ]);
    const rs = ruleSet([
      limit('windSpeed', 'max', 15, 'mph'),
      limit('windSpeed', 'max', 10, 'mph', { boatClassIds: ['small'] }),
      limit('windGust', 'max', 20, 'mph'),
    ]);
    expect(limiting(forecast, rs)).toMatchObject({ metric: 'windGust', hoursOutside: 4 });
  });

  it("uses a metric's least headroom across its limits", () => {
    // Water between 15 and 24 against 5-25: the max has 0.1 left, the min 1.0. Wind has 0.33.
    const forecast = day([
      { waterTemp: 15, windSpeed: mph(10) },
      { waterTemp: 24, windSpeed: mph(10) },
    ]);
    const rs = ruleSet([
      limit('waterTemp', 'min', 5, 'degC'),
      limit('waterTemp', 'max', 25, 'degC'),
      limit('windSpeed', 'max', 15, 'mph'),
    ]);
    const result = limiting(forecast, rs);
    expect(result?.metric).toBe('waterTemp');
    expect(result?.headroom).toBeCloseTo(0.1, 9);
  });
});

describe('findLimitingFactor: least headroom when nothing is outside', () => {
  it('ranks ratio-scale metrics by margin over the limit', () => {
    // Wind: (15 - 13) / 15 = 0.133. Flow: (20 - 19) / 20 = 0.05.
    const forecast = day([
      { windSpeed: mph(13), flow: kcfs(18) },
      { windSpeed: mph(9), flow: kcfs(19) },
    ]);
    const rs = ruleSet([limit('windSpeed', 'max', 15, 'mph'), limit('flow', 'max', 20, 'kcfs')]);
    const result = limiting(forecast, rs);
    expect(result).toMatchObject({ metric: 'flow', reason: 'leastHeadroom', hoursOutside: 0 });
    expect(result?.headroom).toBeCloseTo(0.05, 6);
  });

  it('uses a 10 °C scale for temperatures, so a limit of 0 °C works', () => {
    // Air: (1 - 0) / 10 = 0.1. Water: (14 - 10) / 10 = 0.4.
    const forecast = day([{ airTemp: 1, waterTemp: 14 }]);
    const rs = ruleSet([limit('airTemp', 'min', 0, 'degC'), limit('waterTemp', 'min', 10, 'degC')]);
    const result = limiting(forecast, rs);
    expect(result).toMatchObject({ metric: 'airTemp', reason: 'leastHeadroom' });
    expect(result?.headroom).toBeCloseTo(0.1, 9);
  });

  it('uses a 1 m scale for gauge height', () => {
    // Gauge height: (3 - 2.8) / 1 = 0.2. Wind: (15 - 10) / 15 = 0.333.
    const forecast = day([{ gaugeHeight: 2.8, windSpeed: mph(10) }]);
    const rs = ruleSet([limit('gaugeHeight', 'max', 3, 'm'), limit('windSpeed', 'max', 15, 'mph')]);
    const result = limiting(forecast, rs);
    expect(result?.metric).toBe('gaugeHeight');
    expect(result?.headroom).toBeCloseTo(0.2, 9);
  });

  it('uses an 18 °F scale for combined temperature', () => {
    // 10 °C + 10 °C is 50 + 50 = 100 °F against a 90 °F minimum: 10 / 18 = 0.556.
    const forecast = day([{ airTemp: 10, waterTemp: 10, windSpeed: mph(5) }]);
    const rs = ruleSet([
      limit('combinedTempF', 'min', 90, 'degF'),
      limit('windSpeed', 'max', 15, 'mph'),
    ]);
    const result = limiting(forecast, rs);
    expect(result?.metric).toBe('combinedTempF');
    expect(result?.headroom).toBeCloseTo(10 / 18, 9);
  });
});

describe('findLimitingFactor: which hours count', () => {
  const maxWind = limit('windSpeed', 'max', 15, 'mph');
  const maxFlow = limit('flow', 'max', 20, 'kcfs');

  it('ignores hours outside civil dawn to dusk when the rule set has no window', () => {
    const forecast = [
      ...day([{ windSpeed: mph(10), flow: kcfs(18) }]),
      point(NIGHT, { windSpeed: mph(30), flow: kcfs(18) }),
    ];
    const result = limiting(forecast, ruleSet([maxWind, maxFlow]));
    expect(result).toMatchObject({ metric: 'flow', reason: 'leastHeadroom', hoursOutside: 0 });
  });

  it('counts pre-sunrise twilight, which crews row in with lights', () => {
    // 06:00 EDT on April 15 is between civil dawn (05:43) and sunrise (06:12).
    const forecast = [
      point('2026-04-15T10:00:00Z', { windSpeed: mph(25), flow: kcfs(10) }),
      ...day([{ windSpeed: mph(10), flow: kcfs(10) }]),
    ];
    expect(limiting(forecast, ruleSet([maxWind, maxFlow]))).toMatchObject({
      metric: 'windSpeed',
      hoursOutside: 1,
    });
  });

  it('uses the daylight window instead when the rule set has one', () => {
    // A window closing 90 minutes before sunset (about 17:56 EDT) excludes the 19:00 EDT hour,
    // which civil daylight (until about 19:55) would include.
    const window = { minutesBeforeSunrise: 0, minutesAfterSunset: -90 };
    const evening = '2026-04-15T23:00:00Z';
    const forecast = [
      ...day([{ windSpeed: mph(10), flow: kcfs(10) }]),
      point(evening, { windSpeed: mph(25), flow: kcfs(10) }),
    ];
    const withWindow = limiting(forecast, ruleSet([maxWind, maxFlow], { daylight: window }));
    expect(withWindow?.hoursOutside).toBe(0);
    const without = limiting(forecast, ruleSet([maxWind, maxFlow]));
    expect(without).toMatchObject({ metric: 'windSpeed', hoursOutside: 1 });
  });

  it('ignores unknown hours when finding the worst value', () => {
    // The stale 19 kcfs reading is ignored; the usable worst is 12 kcfs: (20 - 12) / 20 = 0.4.
    const forecast = [
      point(DAY_START, { flow: kcfs(19) }, { flow: { asOf: ago(48) } }),
      point(at(DAY_START, 1), { flow: kcfs(12) }),
    ];
    const result = limiting(forecast, ruleSet([maxFlow]));
    expect(result?.headroom).toBeCloseTo(0.4, 9);
  });

  it('only considers limits that apply to the boat class', () => {
    const smallOnly = limit('windSpeed', 'max', 10, 'mph', { boatClassIds: ['small'] });
    const forecast = day([{ windSpeed: mph(12), flow: kcfs(10) }]);
    expect(limiting(forecast, ruleSet([smallOnly, maxFlow]), 'small')?.metric).toBe('windSpeed');
    expect(limiting(forecast, ruleSet([smallOnly, maxFlow]), 'large')?.metric).toBe('flow');
  });

  it('ranks flow at the gauge the rule set names', () => {
    const forecast = day([{ flow: kcfs(10), windSpeed: mph(10) }]);
    const named = day([{ flow: kcfs(25) }]);
    const rs = ruleSet([maxFlow, maxWind], { flowGaugeRef: 'nwps:MNTM3' });
    const result = limiting(forecast, rs, 'small', { flowByGauge: { 'nwps:MNTM3': named } });
    expect(result).toMatchObject({ metric: 'flow', hoursOutside: 1 });
    // Headroom from the named gauge's 25 kcfs, not the display gauge's 10: (20 - 25) / 20.
    expect(result?.headroom).toBeCloseTo(-0.25, 9);
  });
});

describe('findLimitingFactor: no answer', () => {
  it('excludes metrics no hour has a source for', () => {
    const forecast = day([{ windSpeed: mph(10) }]);
    const rs = ruleSet([
      limit('windSpeed', 'max', 15, 'mph'),
      limit('waterTemp', 'min', 10, 'degC'),
    ]);
    expect(limiting(forecast, rs)?.metric).toBe('windSpeed');
    expect(limiting(forecast, ruleSet([limit('waterTemp', 'min', 10, 'degC')]))).toBeNull();
  });

  it('returns null when the rule set has no limits', () => {
    expect(limiting(day([{ windSpeed: mph(10) }]), ruleSet([]))).toBeNull();
  });

  it('returns null when every rowing hour is unknown', () => {
    const forecast = day([{ windSpeed: null }, { windSpeed: null }]);
    expect(limiting(forecast, ruleSet([limit('windSpeed', 'max', 15, 'mph')]))).toBeNull();
  });

  it('returns null when there are no rowing hours', () => {
    const forecast = [point(NIGHT, { windSpeed: mph(30) })];
    expect(limiting(forecast, ruleSet([limit('windSpeed', 'max', 15, 'mph')]))).toBeNull();
  });
});
