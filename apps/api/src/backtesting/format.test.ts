import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RuleSet } from '@rowing/core';
import { describe, expect, it } from 'vitest';
import { fixturesDir } from '../../scripts/recorder.ts';
import { formatReplay } from './format.ts';
import { loadCase, replayCase } from './replay.ts';

const recorded = await loadCase(join(fixturesDir, 'cases', 'replay-test'));
const ruleSet = RuleSet.parse(
  JSON.parse(readFileSync(join(fixturesDir, 'rule-sets', 'test-club.json'), 'utf8')),
);
const timeZone = 'America/New_York';
const replay = await replayCase({ recorded, at: '2026-05-15T10:00:00.000Z', timeZone, ruleSet });
const us = formatReplay(replay, { caseName: 'replay-test', timeZone, units: 'us' });
const lines = us.split('\n');

describe('formatReplay', () => {
  it('names the case, the local and UTC replay time, the rule set and the boat class', () => {
    expect(lines[0]).toBe(
      'Replay of replay-test at Fri, May 15, 06:00 EDT (2026-05-15T10:00:00.000Z)',
    );
    expect(us).toContain('Rule set: Test Club, boat class 1x and 2x');
    expect(us).toContain('Current weather: station KORE, 21.7 km away');
  });

  it('says what the replay cannot show', () => {
    expect(us).toContain('Not the NWS forecast as issued');
    expect(us).toContain('NWPS keeps no past forecasts');
    expect(us).toContain('Alerts: not recorded');
  });

  it('writes one row per hour with status in words against the rule set', () => {
    const header = lines.find((l) => l.startsWith('Time'));
    expect(header).toContain("Test Club's limits");
    const rows = lines.filter((l) => /^(Fri|Sat|Sun) \d{2}:00/.test(l));
    expect(rows).toHaveLength(48);
    expect(rows[0]).toMatch(/^Fri 06:00\s+unknown\s+daylight/);
    for (const row of rows) expect(row).toMatch(/\s(within|outside|unknown)\s/);
  });

  it('never words a status as safe or unsafe', () => {
    expect(us.toLowerCase()).not.toMatch(/\bsafe\b|\bunsafe\b|go \/ no go/);
  });

  it('gives the reason for each unknown and each limit outside', () => {
    expect(lines.find((l) => l.startsWith('Fri 06:00'))).toContain('water temp unknown: no source');
    expect(lines.find((l) => l.startsWith('Fri 22:00'))).toContain('outside the daylight window');
  });

  it('shows values in the chosen units, with the lead of each forecast', () => {
    const row = lines.find((l) => l.startsWith('Fri 07:00')) ?? '';
    expect(row).toMatch(/\d+ °F/);
    expect(row).toMatch(/\d+ mph/);
    expect(row).toMatch(/\d+ cfs/);
    expect(row).toContain('1 day');
    expect(lines.find((l) => l.startsWith('Sat 07:00'))).toContain('2 day');

    const metric = formatReplay(replay, { caseName: 'replay-test', timeZone, units: 'metric' });
    const metricRow = metric.split('\n').find((l) => l.startsWith('Fri 07:00')) ?? '';
    expect(metricRow).toMatch(/\d+\.\d °C/); // shown at the unit's precision, 10.0 not 10
    expect(metricRow).toMatch(/km\/h/);
    expect(metricRow).toMatch(/m³\/s/);
  });

  it('marks a missing value with a dash, never zero', () => {
    // Montague reports no water temperature.
    const header = lines.find((l) => l.startsWith('Time')) ?? '';
    const row = lines.find((l) => l.startsWith('Fri 07:00')) ?? '';
    const water = header.indexOf('Water');
    expect(row.slice(water, water + 1)).toBe('–');
  });

  it('labels the observed columns by where they came from', () => {
    expect(us).toContain('Observed columns: the station report filed in each hour.');
  });

  it('says so when the rule set has nothing to compare for the boat class', async () => {
    const empty = RuleSet.parse({ ...ruleSet, thresholds: [], daylight: undefined });
    const r = await replayCase({ recorded, at: replay.at, timeZone, ruleSet: empty });
    const text = formatReplay(r, { caseName: 'replay-test', timeZone, units: 'us' });
    expect(text).toContain('Test Club has no limits for this boat class, so nothing was compared.');
    expect(text).not.toMatch(/^Fri 06:00/m);
  });
});
