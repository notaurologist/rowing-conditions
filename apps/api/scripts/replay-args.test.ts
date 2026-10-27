import { describe, expect, it } from 'vitest';
import { localToUtc, parseReplayArgs } from './replay-args.ts';

const args = [
  '--name',
  'may-15',
  '--at',
  '2026-05-15T06:00',
  '--timezone',
  'America/New_York',
  '--rule-set',
  'club.json',
];

describe('localToUtc', () => {
  it.each([
    ['2026-05-15T06:00', 'America/New_York', '2026-05-15T10:00:00.000Z'], // EDT
    ['2026-01-15T06:00', 'America/New_York', '2026-01-15T11:00:00.000Z'], // EST
    ['2026-11-01T01:30', 'America/New_York', '2026-11-01T05:30:00.000Z'], // repeated hour: the first
    ['2026-05-15T06:00', 'Europe/London', '2026-05-15T05:00:00.000Z'],
    ['2026-05-15T06:00', 'UTC', '2026-05-15T06:00:00.000Z'],
  ])('reads %s in %s as %s', (local, zone, utc) => {
    expect(localToUtc(local, zone)).toBe(utc);
  });

  it.each([
    ['2026-03-08T02:30', 'a time skipped when clocks spring forward'],
    ['2026-02-30T06:00', 'a date that does not exist'],
    ['2026-05-15T24:00', 'an hour out of range'],
    ['2026-05-15 06:00', 'a space instead of T'],
    ['2026-05-15T06:00Z', 'a UTC time'],
  ])('rejects %s, %s', (local) => {
    expect(localToUtc(local, 'America/New_York')).toBeUndefined();
  });
});

describe('parseReplayArgs', () => {
  it('reads a full set of arguments, with US units by default', () => {
    expect(parseReplayArgs(args)).toEqual({
      name: 'may-15',
      at: '2026-05-15T10:00:00.000Z',
      timeZone: 'America/New_York',
      ruleSetPath: 'club.json',
      units: 'us',
    });
    expect(parseReplayArgs([...args, '--boat-class', 'big', '--units', 'metric'])).toMatchObject({
      boatClassId: 'big',
      units: 'metric',
    });
  });

  it.each([
    ['no name', args.slice(2), /--name is required/],
    ['no time zone', [...args.slice(0, 4), ...args.slice(6)], /--timezone is required/],
    ['an unknown time zone', args.with(5, 'Eastern'), /not a time zone/],
    ['no time', [...args.slice(0, 2), ...args.slice(4)], /--at is required/],
    ['a time skipped by daylight saving', args.with(3, '2026-03-08T02:30'), /exists in/],
    ['no rule set', args.slice(0, 6), /--rule-set is required/],
    ['other units', [...args, '--units', 'imperial'], /us or metric/],
    ['an unknown option', [...args, '--hours', '24'], /Unknown option/],
  ])('rejects %s with the usage line', (_, input, message) => {
    expect(() => parseReplayArgs(input)).toThrow(message);
    expect(() => parseReplayArgs(input)).toThrow(/Usage: pnpm fixtures:replay-case/);
  });
});
