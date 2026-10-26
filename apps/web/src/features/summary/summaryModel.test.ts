import { type RuleSet, type SavedLocation, toInternal } from '@rowing/core';
import { describe, expect, it } from 'vitest';
import montague from '../../../test/fixtures/conditions-montague.json' with { type: 'json' };
import type { Conditions } from '../../lib/api.ts';
import { evaluateLocation } from '../timeline/evaluateLocation.ts';
import { summaryModel, tidyGaugeName } from './summaryModel.ts';

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
    expect(summary().headline).toBe('Within Club A’s limits today, 2 PM to 6:20 PM');
  });

  it('says when the window is under way', () => {
    expect(summary(clubA, { now: '2026-10-26T19:00:00.000Z', conditions: fresh() }).headline).toBe(
      'Within Club A’s limits now, until 6:20 PM',
    );
  });

  it('names the day of a later window', () => {
    // After today's window closes, the next is tomorrow's.
    const conditions = fresh();
    expect(summary(clubA, { now: '2026-10-27T00:00:00.000Z', conditions }).headline).toBe(
      'Within Club A’s limits tomorrow, 6:49 AM to 6:18 PM',
    );
  });

  it('says when no rowing hour is within the limits', () => {
    const strict = structuredClone(clubA);
    const flow = strict.thresholds[0];
    if (flow) flow.value = toInternal('flow', 2000, 'cfs');
    expect(summary(strict).headline).toBe(
      'No hours within Club A’s limits from dawn to dusk in the next 48 hours',
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
  it('names the deciding limit, its closest margin in the window, and a measurement that disagrees with the forecast', () => {
    expect(summary().detail).toEqual([
      'Flow decides it, with 6 rowing hours past its limit.',
      'In the window, it comes no closer than 10 cfs to the 3,100 cfs limit.',
      'The river measured 3,750 cfs at 8:15 AM; the forecast for that hour was 3,230 cfs.',
    ]);
  });

  it('leaves out the measurement note when it agrees with the forecast', () => {
    const conditions = structuredClone(montague) as Conditions;
    const flow = conditions.current.find((r) => r.metric === 'flow');
    if (flow) flow.value = toInternal('flow', 3250, 'cfs');
    expect(
      summary(clubA, { conditions }).detail.some((d) => d.startsWith('The river measured')),
    ).toBe(false);
  });

  it('describes the closest limit when none is crossed', () => {
    const loose = structuredClone(clubA);
    loose.thresholds = loose.thresholds.filter((t) => t.id === 'gust');
    expect(summary(loose).detail[0]).toBe('Wind gusts decide it, coming closest to their limit.');
  });
});

describe('summaryModel days', () => {
  it('says what each day holds from dawn to dusk, with reasons', () => {
    expect(summary().days).toEqual([
      {
        name: 'Today',
        text: 'Outside from 8 AM to 2 PM: flow up to 3,230 cfs (limit: at most 3,100 cfs); air temperature down to 26 °F (limit: at least 35 °F). Within from 2 PM to dusk, 6:20 PM.',
      },
      { name: 'Tomorrow', text: 'Within from dawn, 6:49 AM, to dusk, 6:18 PM.' },
      {
        name: 'Wed, Oct 28',
        text: 'Outside from dawn, 6:51 AM, to 8 AM: air temperature down to 23 °F (limit: at least 35 °F). The forecast ends at 8 AM.',
      },
    ]);
  });

  it('leaves out periods that have already ended', () => {
    const days = summary(clubA, { now: '2026-10-27T00:00:00.000Z', conditions: fresh() }).days;
    expect(days[0]?.name).toBe('Tomorrow');
  });

  it('gives daylight times when there is no rule set', () => {
    expect(summary(null).days[0]).toEqual({
      name: 'Today',
      text: 'Civil dawn 6:47 AM, sunrise 7:16 AM, sunset 5:51 PM, civil dusk 6:20 PM.',
    });
  });

  it('never gives a verdict', () => {
    const all = [summary(), summary(null)]
      .flatMap((s) => [s.headline, ...s.detail, ...s.days.map((d) => d.text)])
      .join(' ')
      .toLowerCase();
    expect(all).not.toMatch(/\bsafe\b|\bunsafe\b|go out|no go|good to go|row now/);
  });
});

describe('tidyGaugeName', () => {
  it('turns USGS capitals into a readable name', () => {
    expect(tidyGaugeName('CONNECTICUT RIVER AT MONTAGUE CITY, MA')).toBe(
      'Connecticut River at Montague City, MA',
    );
    expect(tidyGaugeName('FARMINGTON R AT RAINBOW, CT.')).toBe('Farmington R at Rainbow, CT');
    expect(tidyGaugeName('McDowell Creek at Oak, NC')).toBe('McDowell Creek at Oak, NC');
  });
});
