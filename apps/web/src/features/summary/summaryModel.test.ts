import { type RuleSet, type SavedLocation, toInternal } from '@rowing/core';
import { describe, expect, it } from 'vitest';
import montague from '../../../test/fixtures/conditions-montague.json' with { type: 'json' };
import type { Conditions } from '../../lib/api.ts';
import { evaluateLocation } from '../timeline/evaluateLocation.ts';
import { summaryModel } from './summaryModel.ts';

const NOW = '2026-10-26T12:35:00.000Z'; // 8:35 AM in Turners Falls
const location: SavedLocation = {
  id: 'l',
  name: 'Turners Falls',
  lat: 42.6,
  lon: -72.55,
  gaugeRef: 'usgs:USGS-01170500',
  ruleSetIds: ['rs'],
};
const clubA: RuleSet = {
  id: 'rs',
  name: 'Club A',
  boatClasses: [{ id: 'small', name: '1x and 2x' }],
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

// The recorded weather forecast was issued at 1:40 AM, so it goes stale (12 h) at 1:40 PM.
// Later times in these tests use a fresher copy.
function fresh(): Conditions {
  const conditions = structuredClone(montague) as Conditions;
  for (const p of conditions.forecast) {
    for (const prov of Object.values(p.provenance)) {
      if (prov?.source === 'nws') prov.asOf = '2026-10-26T20:00:00.000Z';
    }
  }
  return conditions;
}

function summary(
  ruleSet: RuleSet | null = clubA,
  options: { now?: string; conditions?: Conditions } = {},
) {
  const conditions = options.conditions ?? (structuredClone(montague) as Conditions);
  const now = options.now ?? NOW;
  return summaryModel({
    conditions,
    evaluated: evaluateLocation(conditions, location, ruleSet ?? undefined, now),
    now,
  });
}

describe('summaryModel headline', () => {
  it('names the next window', () => {
    expect(summary().headline).toBe('Within limits today, 2 PM to 6:20 PM');
  });

  it('says when the window is under way', () => {
    expect(summary(clubA, { now: '2026-10-26T19:00:00.000Z', conditions: fresh() }).headline).toBe(
      'Within limits now, until 6:20 PM',
    );
  });

  it('names the day of a later window', () => {
    // After today's window closes, the next is tomorrow's.
    const conditions = fresh();
    expect(summary(clubA, { now: '2026-10-27T00:00:00.000Z', conditions }).headline).toBe(
      'Within limits tomorrow, 6:49 AM to 6:18 PM',
    );
  });

  it('says when no rowing hour is within the limits', () => {
    const strict = structuredClone(clubA);
    const flow = strict.thresholds[0];
    if (flow) flow.value = toInternal('flow', 2000, 'cfs');
    expect(summary(strict).headline).toBe(
      'No hours within limits from dawn to dusk in the next 48 hours',
    );
  });

  it('explains a missing rule set and a rule set without limits', () => {
    expect(summary(null)).toMatchObject({
      headline: 'No limits to compare against yet',
      detail: ['Enter your club’s limits, or your own, to see when conditions are within them.'],
    });
    expect(summary({ ...clubA, thresholds: [] })).toMatchObject({
      headline: 'Club A has no limits for 1x and 2x yet',
      detail: ['Enter your or your club’s limits to see when conditions are within them.'],
    });
  });
});

describe('summaryModel detail', () => {
  it('says nothing more under a plain answer', () => {
    expect(summary().detail).toEqual([]);
  });

  it('never gives a verdict', () => {
    const all = [summary(), summary(null)]
      .flatMap((s) => [s.headline, ...s.detail])
      .join(' ')
      .toLowerCase();
    expect(all).not.toMatch(/\bsafe\b|\bunsafe\b|go out|no go|good to go|row now/);
  });
});

describe('summaryModel with several rule sets', () => {
  it('leads with the selected rule set and gives each other one a sentence', () => {
    const conditions = structuredClone(montague) as Conditions;
    const clubB: RuleSet = {
      id: 'rs-b',
      name: 'Club B',
      boatClasses: [
        { id: 'small', name: '1x' },
        { id: 'big', name: 'Eights' },
      ],
      thresholds: [
        {
          ...(clubA.thresholds[0] as RuleSet['thresholds'][0]),
          value: toInternal('flow', 20, 'kcfs'),
          enteredUnit: 'kcfs',
        },
      ],
    };
    const empty: RuleSet = { ...clubB, id: 'rs-e', name: 'Club E', thresholds: [] };
    const a = evaluateLocation(conditions, location, clubA, NOW);
    const b = evaluateLocation(conditions, location, clubB, NOW, 'big');
    const e = evaluateLocation(conditions, location, empty, NOW);
    const result = summaryModel({
      conditions,
      evaluated: a,
      alongside: [a, b, e].flatMap((x) => x ?? []),
      now: NOW,
    });
    expect(result.headline).toBe(summary().headline);
    expect(result.others).toEqual([
      'Within Club B’s limits now, until 6:20 PM (Eights).',
      'Club E has no limits for 1x yet.',
    ]);
  });

  it('has no other sentences with one rule set', () => {
    expect(summary().others).toEqual([]);
  });
});

describe('summaryModel degrees of certainty (decision 0020)', () => {
  // Flow withheld after the current hour because the forecast disagrees with the gauge, with the
  // set-aside forecast at 2,000 cfs: under Club A's 3,100 cfs limit.
  function doubted(): Conditions {
    const conditions = structuredClone(montague) as Conditions;
    const asOf = '2026-10-26T12:15:00.000Z';
    for (const [i, p] of conditions.forecast.entries()) {
      if (i === 0) continue;
      p.values.flow = null;
      p.provenance.flow = {
        kind: 'observation',
        asOf,
        source: 'usgs',
        withheld: 'forecastDisagrees',
        setAside: { value: toInternal('flow', 2000, 'cfs'), asOf: '2026-10-26T10:00:00.000Z' },
      };
    }
    conditions.flowSetAside = [
      {
        gaugeRef: 'usgs:USGS-01170500',
        issuedAt: '2026-10-26T10:00:00.000Z',
        measured: toInternal('flow', 3750, 'cfs'),
        measuredAt: asOf,
        forecastForMeasurement: toInternal('flow', 2600, 'cfs'),
        points: [],
      },
    ];
    return conditions;
  }

  it('offers a probable window when no hour is plainly within, and says why', () => {
    const s = summary(clubA, { conditions: doubted() });
    expect(s.headline).toMatch(/^Probably within limits /);
    expect(s.detail).toEqual(['The flow forecast doesn’t match the gauge.']);
  });

  it('puts the caveat with every answer', () => {
    expect(summary().caveat).toBe(
      'Forecasts can be wrong. Check conditions on the water before you go.',
    );
    expect(summary(clubA, { conditions: doubted() }).caveat).toBe(
      'Forecasts can be wrong. Check conditions on the water before you go.',
    );
  });

  it('says no hours are known to be within when the rest are unknown, not that none are', () => {
    const conditions = doubted();
    for (const p of conditions.forecast) {
      const prov = p.provenance.flow;
      if (prov) delete prov.setAside;
    }
    expect(summary(clubA, { conditions }).headline).toBe(
      'No hours known to be within limits from dawn to dusk in the next 48 hours',
    );
  });
});
