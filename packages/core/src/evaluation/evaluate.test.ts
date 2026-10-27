import { describe, expect, it } from 'vitest';
import { daylightTimes } from '../daylight/daylight.ts';
import type { Metric, Qualifier, Unit } from '../types/measurement.ts';
import type { ForecastPoint, ValueProvenance } from '../types/readings.ts';
import type { RuleSet, Threshold } from '../types/rules.ts';
import { toSI } from '../units/units.ts';
import {
  evaluateHour,
  evaluateTimeline,
  futureToleranceHours,
  hourOutsideSpan,
  maxAgeHours,
} from './evaluate.ts';

const lat = 42.6;
const lon = -72.55;
const NOW = '2026-04-15T16:00:00Z';
const MIDDAY = '2026-04-15T16:00:00Z'; // noon EDT
const MIDNIGHT = '2026-04-16T04:00:00Z'; // midnight EDT
const HOUR = 3_600_000;

const ago = (hours: number) => new Date(Date.parse(NOW) - hours * HOUR).toISOString();

function provenanceFor(metric: Metric): ValueProvenance {
  if (metric === 'flow' || metric === 'gaugeHeight' || metric === 'waterTemp') {
    return { kind: 'observation', asOf: ago(0.25), source: 'usgs' };
  }
  return { kind: 'forecast', asOf: ago(1), source: 'nws' };
}

function point(
  time: string,
  values: Partial<Record<Metric, number | null>>,
  provenance: Partial<Record<Metric, Partial<ValueProvenance>>> = {},
): ForecastPoint {
  const full: ForecastPoint['provenance'] = {};
  for (const metric of Object.keys(values) as Metric[]) {
    full[metric] = { ...provenanceFor(metric), ...provenance[metric] };
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
      { id: 'small', name: '1x and 2x' },
      { id: 'large', name: '4+ and 8+' },
    ],
    thresholds,
    ...extra,
  };
}

function hour(p: ForecastPoint, rs: RuleSet, boatClassId = 'small') {
  return evaluateHour(p, { ruleSet: rs, boatClassId, lat, lon, now: NOW });
}

const maxWind15 = limit('windSpeed', 'max', 15, 'mph');
const minWater10C = limit('waterTemp', 'min', 10, 'degC');
const calm = { windSpeed: toSI(8, 'mph'), waterTemp: 12 };

describe('evaluateHour status', () => {
  it('is within when every applicable limit is present, usable, and passing', () => {
    const r = hour(point(MIDDAY, calm), ruleSet([maxWind15, minWater10C]));
    expect(r).toMatchObject({ time: MIDDAY, status: 'within', failures: [], unknowns: [] });
  });

  it('is outside when any limit fails, and reports the rounded value and limit', () => {
    const r = hour(point(MIDDAY, { ...calm, windSpeed: toSI(17.4, 'mph') }), ruleSet([maxWind15]));
    expect(r.status).toBe('outside');
    expect(r.failures).toEqual([
      {
        kind: 'limit',
        thresholdId: maxWind15.id,
        metric: 'windSpeed',
        value: 17,
        limit: 15,
        unit: 'mph',
      },
    ]);
  });

  it('is unknown when a value is missing and the rest pass', () => {
    const r = hour(point(MIDDAY, { ...calm, waterTemp: null }), ruleSet([maxWind15, minWater10C]));
    expect(r.status).toBe('unknown');
    expect(r.unknowns).toEqual([
      { thresholdId: minWater10C.id, metric: 'waterTemp', reason: 'missing' },
    ]);
  });

  it('is outside when one limit fails and another is unknown, and reports both', () => {
    const p = point(MIDDAY, { windSpeed: toSI(20, 'mph'), waterTemp: null });
    const r = hour(p, ruleSet([maxWind15, minWater10C]));
    expect(r.status).toBe('outside');
    expect(r.failures).toHaveLength(1);
    expect(r.unknowns).toHaveLength(1);
  });

  it('never compares a reversed flow, against a max or a min limit (#116)', () => {
    const maxFlow = limit('flow', 'max', 20, 'kcfs');
    const minFlow = limit('flow', 'min', 1, 'kcfs');
    const p = point(
      MIDDAY,
      { flow: toSI(-1.6, 'kcfs') },
      { flow: { qualifiers: ['reversedFlow'] } },
    );
    for (const t of [maxFlow, minFlow]) {
      const r = hour(p, ruleSet([t]));
      expect(r.status).toBe('unknown');
      expect(r.failures).toEqual([]);
      expect(r.unknowns).toEqual([{ thresholdId: t.id, metric: 'flow', reason: 'reversed' }]);
    }
  });

  it('reports why a withheld value has none, instead of missing (#117, #82)', () => {
    for (const withheld of ['noForecast', 'forecastDisagrees'] as const) {
      const p = point(MIDDAY, { ...calm, waterTemp: null });
      const provenance = p.provenance.waterTemp;
      if (provenance) p.provenance.waterTemp = { ...provenance, withheld };
      const r = hour(p, ruleSet([maxWind15, minWater10C]));
      expect(r.status).toBe('unknown');
      expect(r.unknowns).toEqual([
        { thresholdId: minWater10C.id, metric: 'waterTemp', reason: withheld },
      ]);
    }
  });

  it('treats a metric absent from the hour as missing', () => {
    const r = hour(point(MIDDAY, { windSpeed: toSI(8, 'mph') }), ruleSet([maxWind15, minWater10C]));
    expect(r.unknowns).toEqual([
      { thresholdId: minWater10C.id, metric: 'waterTemp', reason: 'missing' },
    ]);
  });
});

describe('comparison at display precision in the entered unit', () => {
  const at = (mph: number, boundary: 'inclusive' | 'exclusive') =>
    hour(
      point(MIDDAY, { windSpeed: toSI(mph, 'mph') }),
      ruleSet([limit('windSpeed', 'max', 15, 'mph', { boundary })]),
    ).status;

  it('includes a value exactly at an inclusive max and excludes it for an exclusive max', () => {
    expect(at(15, 'inclusive')).toBe('within');
    expect(at(15, 'exclusive')).toBe('outside');
  });

  it('compares the displayed value: 15.4 mph shows as 15, so it is at the limit', () => {
    expect(at(15.4, 'inclusive')).toBe('within');
    expect(at(15.5, 'inclusive')).toBe('outside');
  });

  it('shows a 24 km/h forecast as 15 mph, matching a 15 mph limit', () => {
    const r = hour(
      point(MIDDAY, { windSpeed: toSI(24, 'km/h') }),
      ruleSet([limit('windSpeed', 'max', 15, 'mph', { boundary: 'exclusive' })]),
    );
    expect(r.failures[0]).toMatchObject({ value: 15, limit: 15, unit: 'mph' });
  });

  it('handles inclusive and exclusive minimums at the limit', () => {
    const p = point(MIDDAY, { waterTemp: 10 });
    expect(hour(p, ruleSet([limit('waterTemp', 'min', 10, 'degC')])).status).toBe('within');
    expect(
      hour(p, ruleSet([limit('waterTemp', 'min', 10, 'degC', { boundary: 'exclusive' })])).status,
    ).toBe('outside');
  });

  it('compares flow in kcfs when the limit was entered in kcfs', () => {
    const maxFlow = limit('flow', 'max', 20, 'kcfs');
    expect(hour(point(MIDDAY, { flow: toSI(20.04, 'kcfs') }), ruleSet([maxFlow])).status).toBe(
      'within',
    );
    expect(hour(point(MIDDAY, { flow: toSI(20.05, 'kcfs') }), ruleSet([maxFlow])).status).toBe(
      'outside',
    );
  });
});

describe('unknown reasons', () => {
  const maxFlow = limit('flow', 'max', 20, 'kcfs');
  const okFlow = toSI(12, 'kcfs');
  const reasonFor = (prov: Partial<ValueProvenance>, metric: Metric = 'flow', value = okFlow) => {
    const t = metric === 'flow' ? maxFlow : limit(metric, 'max', 30, 'mph');
    return hour(point(MIDDAY, { [metric]: value }, { [metric]: prov }), ruleSet([t])).unknowns[0]
      ?.reason;
  };

  it.each<Qualifier>(['iceAffected', 'equipmentMalfunction', 'estimated', 'unreliable'])(
    'treats a %s reading as unknown',
    (q) => {
      expect(reasonFor({ qualifiers: [q] })).toBe('qualified');
    },
  );

  it('accepts provisional readings', () => {
    expect(reasonFor({ qualifiers: ['provisional'] })).toBeUndefined();
  });

  it('marks an observation older than its maximum age as stale, and accepts one exactly at it', () => {
    expect(reasonFor({ kind: 'observation', asOf: ago(3) })).toBeUndefined();
    expect(reasonFor({ kind: 'observation', asOf: ago(3.01) })).toBe('stale');
  });

  it('uses 36 hours for a flow forecast', () => {
    expect(reasonFor({ kind: 'forecast', asOf: ago(36) })).toBeUndefined();
    expect(reasonFor({ kind: 'forecast', asOf: ago(36.01) })).toBe('stale');
  });

  it('uses 24 hours for a water temperature observation', () => {
    const minWater = limit('waterTemp', 'min', 10, 'degC');
    const at = (h: number) =>
      hour(point(MIDDAY, { waterTemp: 12 }, { waterTemp: { asOf: ago(h) } }), ruleSet([minWater]))
        .status;
    expect(at(24)).toBe('within');
    expect(at(24.01)).toBe('unknown');
  });

  it('uses 12 hours for a weather forecast', () => {
    const windAt = (h: number) => reasonFor({ asOf: ago(h) }, 'windSpeed', toSI(5, 'mph'));
    expect(windAt(12)).toBeUndefined();
    expect(windAt(12.01)).toBe('stale');
  });

  it('checks missing before qualified, and qualified before stale', () => {
    expect(reasonFor({ qualifiers: ['iceAffected'] }, 'flow', null as unknown as number)).toBe(
      'missing',
    );
    expect(reasonFor({ qualifiers: ['iceAffected'], asOf: ago(48) })).toBe('qualified');
  });

  it('does not compare an unusable value, even one far outside the limit', () => {
    const r = hour(
      point(MIDDAY, { flow: toSI(40, 'kcfs') }, { flow: { asOf: ago(10) } }),
      ruleSet([maxFlow]),
    );
    expect(r.status).toBe('unknown');
    expect(r.failures).toEqual([]);
  });
});

describe('boat class scoping', () => {
  const smallOnly = limit('windSpeed', 'max', 10, 'mph', { boatClassIds: ['small'] });
  const p = point(MIDDAY, { windSpeed: toSI(12, 'mph') });

  it('applies a scoped limit only to its boat classes', () => {
    expect(hour(p, ruleSet([smallOnly]), 'small').status).toBe('outside');
    expect(hour(p, ruleSet([smallOnly]), 'large').status).toBe('within');
  });

  it('throws for a boat class the rule set does not have', () => {
    expect(() => hour(p, ruleSet([smallOnly]), 'eights')).toThrow();
  });
});

describe('combined air plus water temperature', () => {
  const minCombined90 = limit('combinedTempF', 'min', 90, 'degF');

  it('adds each part rounded to a whole °F: 7 °C + 7 °C is 45 + 45 = 90', () => {
    const r = hour(point(MIDDAY, { airTemp: 7, waterTemp: 7 }), ruleSet([minCombined90]));
    expect(r.status).toBe('within');
  });

  it('fails below the minimum and reports the combined value in °F', () => {
    const r = hour(point(MIDDAY, { airTemp: 5, waterTemp: 6 }), ruleSet([minCombined90]));
    expect(r.failures[0]).toMatchObject({
      metric: 'combinedTempF',
      value: 84,
      limit: 90,
      unit: 'degF',
    });
  });

  it('is unknown with the part that is unusable, and its reason', () => {
    const p = point(MIDDAY, { airTemp: 20, waterTemp: 20 }, { waterTemp: { asOf: ago(30) } });
    const r = hour(p, ruleSet([minCombined90]));
    expect(r.status).toBe('unknown');
    expect(r.unknowns).toEqual([
      { thresholdId: minCombined90.id, metric: 'waterTemp', reason: 'stale' },
    ]);
  });

  it('is unknown when a part is missing', () => {
    const r = hour(point(MIDDAY, { airTemp: 20 }), ruleSet([minCombined90]));
    expect(r.unknowns).toEqual([
      { thresholdId: minCombined90.id, metric: 'waterTemp', reason: 'missing' },
    ]);
  });

  it('names air temperature when both parts are unusable', () => {
    const p = point(MIDDAY, { airTemp: null, waterTemp: 20 }, { waterTemp: { asOf: ago(30) } });
    expect(hour(p, ruleSet([minCombined90])).unknowns).toEqual([
      { thresholdId: minCombined90.id, metric: 'airTemp', reason: 'missing' },
    ]);
  });
});

describe('daylight window and light level', () => {
  const window = { minutesBeforeSunrise: 60, minutesAfterSunset: 30 };
  const today = daylightTimes('2026-04-15', lat, lon);

  it('marks an hour entirely outside the window as outside, even when every limit passes', () => {
    const r = hour(point(MIDNIGHT, calm), ruleSet([maxWind15], { daylight: window }));
    expect(r.status).toBe('outside');
    expect(r.failures).toEqual([{ kind: 'daylight' }]);
    expect(r.light).toBe('dark');
  });

  it('evaluates an hour that partly overlaps the window normally, and the hour before as outside', () => {
    // The window opens 60 minutes before sunrise, partway through this hour.
    const opens = Date.parse(today.sunrise as string) - 60 * 60_000;
    const overlapping = Math.floor(opens / HOUR) * HOUR;
    expect(overlapping).toBeLessThan(opens);
    const rs = ruleSet([maxWind15], { daylight: window });

    const r = hour(point(new Date(overlapping).toISOString(), calm), rs);
    expect(r.failures).toEqual([]);
    expect(r.status).toBe('within');

    const before = hour(point(new Date(overlapping - HOUR).toISOString(), calm), rs);
    expect(before.failures).toEqual([{ kind: 'daylight' }]);
  });

  it('never lets light change the status without a window', () => {
    const r = hour(point(MIDNIGHT, calm), ruleSet([maxWind15]));
    expect(r.status).toBe('within');
    expect(r.light).toBe('dark');
  });

  it('reports light at the middle of the hour', () => {
    expect(hour(point(MIDDAY, calm), ruleSet([maxWind15])).light).toBe('daylight');
  });

  it('treats a window measured from a sunrise that never comes (polar night) as closed', () => {
    const ctx = { boatClassId: 'small', lat: 71.29, lon: -156.79, now: NOW };
    const rs = ruleSet([maxWind15], { daylight: window });
    const night = evaluateHour(point('2026-12-21T22:00:00Z', calm), { ...ctx, ruleSet: rs });
    expect(night.failures).toEqual([{ kind: 'daylight' }]);
    const midnightSun = evaluateHour(point('2026-06-21T10:00:00Z', calm), { ...ctx, ruleSet: rs });
    expect(midnightSun.failures).toEqual([]);
  });
});

describe('hourOutsideSpan', () => {
  const start = '2026-04-15T10:00:00Z';
  const end = '2026-04-15T20:00:00Z';
  const at = (iso: string, deltaMs = 0) => hourOutsideSpan(Date.parse(iso) + deltaMs, start, end);

  it('counts an hour ending exactly at the span start as outside, and one ending later as inside', () => {
    expect(at('2026-04-15T09:00:00Z')).toBe(true);
    expect(at('2026-04-15T09:00:00Z', 1)).toBe(false);
  });

  it('counts an hour starting exactly at the span end as outside, and one starting earlier as inside', () => {
    expect(at('2026-04-15T20:00:00Z')).toBe(true);
    expect(at('2026-04-15T20:00:00Z', -1)).toBe(false);
  });
});

describe('maximum ages', () => {
  // The table in ARCHITECTURE.md ("Maximum ages"), every metric and kind.
  const spec: [Exclude<Metric, 'combinedTempF'>, 'observation' | 'forecast', number][] = [
    ['flow', 'observation', 3],
    ['gaugeHeight', 'observation', 3],
    ['waterTemp', 'observation', 24],
    ['flow', 'forecast', 36],
    ['gaugeHeight', 'forecast', 36],
    ['waterTemp', 'forecast', 24],
    ['airTemp', 'forecast', 12],
    ['airTemp', 'observation', 12],
    ['windSpeed', 'forecast', 12],
    ['windSpeed', 'observation', 12],
    ['windGust', 'forecast', 12],
    ['windGust', 'observation', 12],
    ['windDirection', 'forecast', 12],
    ['windDirection', 'observation', 12],
    ['precipChance', 'forecast', 12],
    ['precipChance', 'observation', 12],
  ];

  it('matches the spec table exactly', () => {
    expect(spec).toHaveLength(16);
    for (const [metric, kind, hours] of spec) {
      expect(maxAgeHours[metric][kind], `${metric} ${kind}`).toBe(hours);
    }
  });

  // Wind direction can't have a limit, so the table check above is its only coverage.
  const unitFor: Partial<Record<Metric, Unit>> = {
    flow: 'm3/s',
    gaugeHeight: 'm',
    waterTemp: 'degC',
    airTemp: 'degC',
    windSpeed: 'm/s',
    windGust: 'm/s',
    precipChance: 'percent',
  };
  const limited = spec.filter(([m]) => m !== 'windDirection');

  it.each(limited)(
    'accepts %s %s at exactly %d hours, and marks it stale just after',
    (m, kind, h) => {
      const t = limit(m, 'max', 1, unitFor[m] as Unit);
      const reason = (age: number) =>
        hour(point(MIDDAY, { [m]: 0.2 }, { [m]: { kind, asOf: ago(age) } }), ruleSet([t]))
          .unknowns[0]?.reason;
      expect(reason(h)).toBeUndefined();
      expect(reason(h + 0.01)).toBe('stale');
    },
  );
});

describe('invalid and future times', () => {
  const maxFlow = limit('flow', 'max', 20, 'kcfs');
  const p = point(MIDDAY, { flow: toSI(10, 'kcfs') });

  it('throws for an invalid now rather than treating every value as fresh', () => {
    const ctx = { ruleSet: ruleSet([maxFlow]), boatClassId: 'small', lat, lon };
    expect(() => evaluateHour(p, { ...ctx, now: '' })).toThrow();
    expect(() => evaluateHour(p, { ...ctx, now: 'garbage' })).toThrow();
  });

  it('throws for a point whose time is not on the hour', () => {
    expect(() => hour(point('2026-04-15T16:37:00Z', calm), ruleSet([maxWind15]))).toThrow();
  });

  it('marks a value dated more than the tolerance after now as stale', () => {
    const at = (hoursAhead: number) =>
      hour(
        point(MIDDAY, { flow: toSI(10, 'kcfs') }, { flow: { asOf: ago(-hoursAhead) } }),
        ruleSet([maxFlow]),
      ).unknowns[0]?.reason;
    expect(at(futureToleranceHours)).toBeUndefined();
    expect(at(futureToleranceHours + 0.01)).toBe('stale');
    expect(at(240)).toBe('stale');
  });
});

describe('evaluateTimeline', () => {
  const maxFlow = limit('flow', 'max', 20, 'kcfs');
  const hours = [MIDDAY, '2026-04-15T17:00:00Z', '2026-04-15T18:00:00Z'];

  it('evaluates every hour in order', () => {
    const forecast = hours.map((t, i) => point(t, { windSpeed: toSI(10 + i * 5, 'mph') }));
    const result = evaluateTimeline({
      forecast,
      ruleSet: ruleSet([maxWind15]),
      boatClassId: 'small',
      lat,
      lon,
      now: NOW,
    });
    expect(result.hours.map((h) => [h.time, h.status])).toEqual([
      [hours[0], 'within'],
      [hours[1], 'within'],
      [hours[2], 'outside'],
    ]);
  });

  it('reports a metric no hour has a source for as unavailable, with every hour noSource', () => {
    const forecast = hours.map((t) => point(t, { windSpeed: toSI(5, 'mph') }));
    const result = evaluateTimeline({
      forecast,
      ruleSet: ruleSet([maxWind15, minWater10C]),
      boatClassId: 'small',
      lat,
      lon,
      now: NOW,
    });
    expect(result.unavailableMetrics).toEqual(['waterTemp']);
    expect(result.hours.every((h) => h.unknowns[0]?.reason === 'noSource')).toBe(true);
  });

  it('distinguishes noSource from missing when only some hours lack a value', () => {
    const forecast = [
      point(hours[0] as string, { flow: toSI(10, 'kcfs') }),
      point(hours[1] as string, { flow: null }),
      point(hours[2] as string, {}),
    ];
    const result = evaluateTimeline({
      forecast,
      ruleSet: ruleSet([maxFlow]),
      boatClassId: 'small',
      lat,
      lon,
      now: NOW,
    });
    expect(result.unavailableMetrics).toEqual([]);
    expect(result.hours.map((h) => h.unknowns[0]?.reason)).toEqual([
      undefined,
      'missing',
      'missing',
    ]);
  });

  it('reports a combined limit whose part has no source as that part being unavailable', () => {
    const forecast = hours.map((t) => point(t, { airTemp: 20 }));
    const result = evaluateTimeline({
      forecast,
      ruleSet: ruleSet([limit('combinedTempF', 'min', 90, 'degF')]),
      boatClassId: 'small',
      lat,
      lon,
      now: NOW,
    });
    expect(result.unavailableMetrics).toEqual(['waterTemp']);
  });

  it('evaluates flow at the gauge the rule set names, not the display gauge', () => {
    const forecast = hours.map((t) => point(t, { flow: toSI(10, 'kcfs') }));
    const named = hours.map((t) =>
      point(t, { flow: toSI(25, 'kcfs') }, { flow: { kind: 'forecast', source: 'nwps' } }),
    );
    const result = evaluateTimeline({
      forecast,
      ruleSet: ruleSet([maxFlow], { flowGaugeRef: 'nwps:MNTM3' }),
      boatClassId: 'small',
      lat,
      lon,
      now: NOW,
      flowByGauge: { 'nwps:MNTM3': named },
    });
    expect(result.hours.every((h) => h.status === 'outside')).toBe(true);
  });

  it('never falls back to the display gauge when the named gauge has no data', () => {
    const forecast = hours.map((t) => point(t, { flow: toSI(10, 'kcfs') }));
    const result = evaluateTimeline({
      forecast,
      ruleSet: ruleSet([maxFlow], { flowGaugeRef: 'nwps:MNTM3' }),
      boatClassId: 'small',
      lat,
      lon,
      now: NOW,
    });
    expect(result.unavailableMetrics).toEqual(['flow']);
    expect(result.hours.every((h) => h.status === 'unknown')).toBe(true);
  });

  it('gives different results for two rule sets on the same water', () => {
    const forecast = [point(MIDDAY, { windSpeed: toSI(12, 'mph') })];
    const base = { forecast, boatClassId: 'small', lat, lon, now: NOW };
    const clubA = evaluateTimeline({ ...base, ruleSet: ruleSet([maxWind15]) });
    const clubB = evaluateTimeline({
      ...base,
      ruleSet: ruleSet([limit('windSpeed', 'max', 10, 'mph')], {
        id: 'rs-b',
        name: 'Club B rules',
      }),
    });
    expect(clubA.hours[0]?.status).toBe('within');
    expect(clubB.hours[0]?.status).toBe('outside');
  });

  it('throws for an unknown boat class even with no hours to evaluate', () => {
    expect(() =>
      evaluateTimeline({
        forecast: [],
        ruleSet: ruleSet([maxWind15]),
        boatClassId: 'eights',
        lat,
        lon,
        now: NOW,
      }),
    ).toThrow();
  });

  it('says whether the rule set has any limits for the boat class', () => {
    const forecast = [point(MIDDAY, calm)];
    const base = { forecast, lat, lon, now: NOW };
    const scoped = ruleSet([limit('windSpeed', 'max', 10, 'mph', { boatClassIds: ['small'] })]);
    expect(evaluateTimeline({ ...base, ruleSet: scoped, boatClassId: 'small' }).hasLimits).toBe(
      true,
    );
    expect(evaluateTimeline({ ...base, ruleSet: scoped, boatClassId: 'large' }).hasLimits).toBe(
      false,
    );
    expect(
      evaluateTimeline({ ...base, ruleSet: ruleSet([]), boatClassId: 'small' }).hasLimits,
    ).toBe(false);
    const windowOnly = ruleSet([], {
      daylight: { minutesBeforeSunrise: 0, minutesAfterSunset: 0 },
    });
    expect(evaluateTimeline({ ...base, ruleSet: windowOnly, boatClassId: 'small' }).hasLimits).toBe(
      true,
    );
  });

  it('returns no hours when there are no limits, so nothing can show as within', () => {
    const forecast = [point(MIDDAY, calm), point('2026-04-15T17:00:00Z', calm)];
    const base = { forecast, lat, lon, now: NOW };
    const scoped = ruleSet([limit('windSpeed', 'max', 10, 'mph', { boatClassIds: ['small'] })]);

    expect(evaluateTimeline({ ...base, ruleSet: ruleSet([]), boatClassId: 'small' })).toEqual({
      hours: [],
      unavailableMetrics: [],
      hasLimits: false,
    });
    expect(evaluateTimeline({ ...base, ruleSet: scoped, boatClassId: 'large' }).hours).toEqual([]);
    expect(evaluateTimeline({ ...base, ruleSet: scoped, boatClassId: 'small' }).hours).toHaveLength(
      2,
    );
  });

  it('evaluates gauge height at the display gauge even when the rule set names a flow gauge', () => {
    const maxHeight = limit('gaugeHeight', 'max', 3, 'm');
    const forecast = [point(MIDDAY, { gaugeHeight: 2, flow: toSI(10, 'kcfs') })];
    const named = [point(MIDDAY, { flow: toSI(10, 'kcfs') })];
    const result = evaluateTimeline({
      forecast,
      ruleSet: ruleSet([maxHeight], { flowGaugeRef: 'nwps:MNTM3' }),
      boatClassId: 'small',
      lat,
      lon,
      now: NOW,
      flowByGauge: { 'nwps:MNTM3': named },
    });
    expect(result.hours[0]?.status).toBe('within');
    expect(result.unavailableMetrics).toEqual([]);
  });
});

describe('degrees of certainty: a set-aside flow forecast (decision 0020)', () => {
  const maxFlow = limit('flow', 'max', 20, 'kcfs');
  // Flow withheld for disagreeing with the gauge, carrying the set-aside forecast.
  const doubted = (kcfs: number, issued = ago(6)) =>
    point(
      MIDDAY,
      { ...calm, flow: null },
      {
        flow: {
          withheld: 'forecastDisagrees',
          setAside: { value: toSI(kcfs, 'kcfs'), asOf: issued },
        },
      },
    );

  it('is probably within when the doubted forecast meets the limit', () => {
    const r = hour(doubted(5), ruleSet([maxWind15, maxFlow]));
    expect(r.status).toBe('probablyWithin');
    expect(r.unknowns).toEqual([]);
    expect(r.doubtful).toEqual([
      { thresholdId: maxFlow.id, metric: 'flow', reason: 'forecastDisagrees' },
    ]);
  });

  it('is outside when the doubted forecast is past the limit, with the failure marked', () => {
    const r = hour(doubted(25), ruleSet([maxWind15, maxFlow]));
    expect(r.status).toBe('outside');
    expect(r.failures).toEqual([
      {
        kind: 'limit',
        thresholdId: maxFlow.id,
        metric: 'flow',
        value: 25,
        limit: 20,
        unit: 'kcfs',
        doubtful: true,
      },
    ]);
  });

  it('stays unknown when another limit is unknown, since nothing is known about that one', () => {
    const p = doubted(5);
    p.values.waterTemp = null;
    expect(hour(p, ruleSet([maxFlow, minWater10C])).status).toBe('unknown');
  });

  it('is outside when a trusted value fails, whatever the doubted one says', () => {
    const p = doubted(5);
    p.values.windSpeed = toSI(20, 'mph');
    expect(hour(p, ruleSet([maxWind15, maxFlow])).status).toBe('outside');
  });

  it('treats a doubted forecast older than the forecast maximum age as stale', () => {
    const r = hour(doubted(5, ago(40)), ruleSet([maxFlow]));
    expect(r.status).toBe('unknown');
    expect(r.unknowns).toEqual([{ thresholdId: maxFlow.id, metric: 'flow', reason: 'stale' }]);
  });

  it('is unknown with no set-aside forecast for the hour', () => {
    const p = point(MIDDAY, { flow: null }, { flow: { withheld: 'forecastDisagrees' } });
    expect(hour(p, ruleSet([maxFlow])).unknowns).toEqual([
      { thresholdId: maxFlow.id, metric: 'flow', reason: 'forecastDisagrees' },
    ]);
  });

  it('never uses a set-aside value for any other withheld reason', () => {
    const p = point(
      MIDDAY,
      { flow: null },
      { flow: { withheld: 'noForecast', setAside: { value: toSI(5, 'kcfs'), asOf: ago(6) } } },
    );
    expect(hour(p, ruleSet([maxFlow])).status).toBe('unknown');
  });

  it('is plain within when nothing is doubted, with no doubtful list', () => {
    const r = hour(
      point(MIDDAY, { ...calm, flow: toSI(5, 'kcfs') }),
      ruleSet([maxWind15, maxFlow]),
    );
    expect(r.status).toBe('within');
    expect(r).not.toHaveProperty('doubtful');
  });
});
