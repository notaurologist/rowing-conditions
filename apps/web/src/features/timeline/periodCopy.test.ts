import { describe, expect, it } from 'vitest';
import { dayLabel, formatClock } from './periodCopy.ts';

const TZ = 'America/New_York';

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
