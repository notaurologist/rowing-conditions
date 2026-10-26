import { describe, expect, it } from 'vitest';
import { freshness } from './evaluate.ts';

const NOW = '2026-10-26T12:00:00.000Z';
const hoursBefore = (h: number) => new Date(Date.parse(NOW) - h * 3_600_000).toISOString();

describe('freshness', () => {
  it('is fresh up to and including the maximum age', () => {
    expect(freshness('flow', 'observation', hoursBefore(6), NOW)).toBe('fresh');
    expect(freshness('flow', 'observation', hoursBefore(0), NOW)).toBe('fresh');
  });

  it('is stale past the maximum age for the metric and kind', () => {
    expect(freshness('flow', 'observation', hoursBefore(6.01), NOW)).toBe('stale');
    expect(freshness('flow', 'forecast', hoursBefore(30), NOW)).toBe('fresh');
    expect(freshness('flow', 'forecast', hoursBefore(37), NOW)).toBe('stale');
    expect(freshness('waterTemp', 'observation', hoursBefore(23), NOW)).toBe('fresh');
    expect(freshness('waterTemp', 'observation', hoursBefore(25), NOW)).toBe('stale');
    expect(freshness('airTemp', 'observation', hoursBefore(13), NOW)).toBe('stale');
  });

  it('flags a time more than an hour ahead of now', () => {
    expect(freshness('airTemp', 'observation', hoursBefore(-0.9), NOW)).toBe('fresh');
    expect(freshness('airTemp', 'observation', hoursBefore(-1.1), NOW)).toBe('future');
  });

  it('treats an unparseable time as stale', () => {
    expect(freshness('flow', 'observation', 'not a time', NOW)).toBe('stale');
  });
});
