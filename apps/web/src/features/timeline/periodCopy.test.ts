import type { Period, PeriodReason } from '@rowing/core';
import { describe, expect, it } from 'vitest';
import { formatClock, formatRange, mergeReasons, reasonText, statusText } from './periodCopy.ts';

const TZ = 'America/New_York';

const gust: PeriodReason = {
  kind: 'limit',
  thresholdId: 'gust',
  metric: 'windGust',
  comparison: 'max',
  boundary: 'inclusive',
  worst: 22,
  limit: 15,
  unit: 'mph',
  hours: 3,
};

describe('reasonText', () => {
  it('words a max limit with the worst value and the limit as entered', () => {
    expect(reasonText(gust)).toBe('wind gusts up to 22 mph (limit: at most 15 mph)');
    expect(
      reasonText({
        ...gust,
        metric: 'flow',
        worst: 3300,
        limit: 3100,
        unit: 'cfs',
        boundary: 'exclusive',
      }),
    ).toBe('flow up to 3,300 cfs (limit: below 3,100 cfs)');
  });

  it('words a min limit as down to', () => {
    expect(
      reasonText({
        ...gust,
        metric: 'waterTemp',
        comparison: 'min',
        worst: 44,
        limit: 50,
        unit: 'degF',
      }),
    ).toBe('water temperature down to 44 °F (limit: at least 50 °F)');
  });

  it.each([
    ['missing', 'no water temperature value'],
    ['stale', 'water temperature reading too old'],
    ['qualified', 'water temperature reading flagged as possibly wrong'],
    ['noSource', 'no source reports water temperature here'],
  ] as const)('words an unknown that is %s', (reason, text) => {
    expect(reasonText({ kind: 'unknown', metric: 'waterTemp', reason, hours: 1 })).toBe(text);
  });
});

describe('statusText', () => {
  it('names the rule set and never gives a verdict', () => {
    expect(statusText('within', 'Club A')).toBe("Within Club A's limits");
    expect(statusText('outside', 'Club A')).toBe("Outside Club A's limits");
    expect(statusText('unknown', 'Club A')).toBe('Unknown');
  });
});

describe('formatClock and formatRange', () => {
  const now = '2026-10-26T14:00:00.000Z'; // 10 AM Monday in New York

  it('drops :00 and keeps other minutes', () => {
    expect(formatClock('2026-10-26T15:00:00.000Z', TZ)).toBe('11 AM');
    expect(formatClock('2026-10-26T10:47:00.000Z', TZ)).toBe('6:47 AM');
  });

  it('names today and tomorrow, and the weekday after that', () => {
    expect(formatRange('2026-10-26T15:00:00.000Z', '2026-10-26T19:00:00.000Z', now, TZ)).toBe(
      'Today 11 AM – 3 PM',
    );
    expect(formatRange('2026-10-27T11:00:00.000Z', '2026-10-27T13:00:00.000Z', now, TZ)).toBe(
      'Tomorrow 7 AM – 9 AM',
    );
    expect(formatRange('2026-10-28T11:00:00.000Z', '2026-10-28T13:00:00.000Z', now, TZ)).toBe(
      'Wed, Oct 28 7 AM – 9 AM',
    );
  });
});

describe('mergeReasons', () => {
  const period = (reasons: PeriodReason[]): Period => ({
    status: 'outside',
    start: '',
    end: '',
    reasons,
  });

  it('keeps the worst value per limit and each unknown once, across periods', () => {
    const merged = mergeReasons([
      period([gust, { kind: 'unknown', metric: 'waterTemp', reason: 'stale', hours: 2 }]),
      period([
        { ...gust, worst: 25, hours: 1 },
        { kind: 'unknown', metric: 'waterTemp', reason: 'stale', hours: 1 },
      ]),
    ]);
    expect(merged).toEqual([
      { ...gust, worst: 25, hours: 4 },
      { kind: 'unknown', metric: 'waterTemp', reason: 'stale', hours: 3 },
    ]);
  });

  it('uses the lowest value for a min limit', () => {
    const water: PeriodReason = {
      ...gust,
      thresholdId: 'w',
      metric: 'waterTemp',
      comparison: 'min',
      worst: 44,
      limit: 50,
      unit: 'degF',
    };
    expect(mergeReasons([period([water]), period([{ ...water, worst: 41 }])])[0]).toMatchObject({
      worst: 41,
    });
  });
});
