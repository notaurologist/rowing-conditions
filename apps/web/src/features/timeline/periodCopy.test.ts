import type { PeriodReason } from '@rowing/core';
import { describe, expect, it } from 'vitest';
import { dayLabel, formatClock, reasonText } from './periodCopy.ts';

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
    ['noForecast', 'no water temperature forecast, and the last reading is over 3 hours earlier'],
    ['forecastDisagrees', 'water temperature forecast set aside: over 25% off the latest reading'],
  ] as const)('words an unknown that is %s', (reason, text) => {
    expect(reasonText({ kind: 'unknown', metric: 'waterTemp', reason, hours: 1 })).toBe(text);
  });
});

describe('formatClock and dayLabel', () => {
  const now = '2026-10-26T14:00:00.000Z'; // 10 AM Monday in New York

  it('drops :00 and keeps other minutes', () => {
    expect(formatClock('2026-10-26T15:00:00.000Z', TZ)).toBe('11 AM');
    expect(formatClock('2026-10-26T10:47:00.000Z', TZ)).toBe('6:47 AM');
  });

  it('names today and tomorrow, and the weekday after that', () => {
    expect(dayLabel('2026-10-26T15:00:00.000Z', now, TZ)).toBe('Today');
    expect(dayLabel('2026-10-27T11:00:00.000Z', now, TZ)).toBe('Tomorrow');
    expect(dayLabel('2026-10-28T11:00:00.000Z', now, TZ)).toBe('Wed, Oct 28');
  });
});
