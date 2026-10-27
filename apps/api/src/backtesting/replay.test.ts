import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RuleSet } from '@rowing/core';
import { describe, expect, it } from 'vitest';
import { fixturesDir } from '../../scripts/recorder.ts';
import { loadFixture } from '../../test/fixtures.ts';
import { forecastLead, loadCase, type RecordedCase, replayCase, replayRange } from './replay.ts';

// Recorded with: pnpm fixtures:record-case --name replay-test --date 2026-05-15 --lat 42.6
// --lon -72.55 --gauge USGS-01170500 --station KORE. Montague reports no water temperature.
const recorded = await loadCase(join(fixturesDir, 'cases', 'replay-test'));
// A made-up rule set for tests, not any club's limits.
const ruleSet = RuleSet.parse(
  JSON.parse(readFileSync(join(fixturesDir, 'rule-sets', 'test-club.json'), 'utf8')),
);
const AT = '2026-05-15T10:00:00.000Z'; // 6 a.m. EDT
const HOUR = 3_600_000;

const replay = (overrides: Partial<Parameters<typeof replayCase>[0]> = {}) =>
  replayCase({ recorded, at: AT, timeZone: 'America/New_York', ruleSet, ...overrides });

// A copy of the case to change, so one test's edits don't leak into another.
function copyCase(): RecordedCase {
  return {
    meta: structuredClone(recorded.meta),
    byName: new Map(recorded.byName),
    byUrl: new Map(recorded.byUrl),
  };
}

describe('replayCase', () => {
  it('shows the 48 hours from the replay time, as the app does', async () => {
    const r = await replay();
    expect(r.conditions.forecast).toHaveLength(48);
    expect(r.conditions.forecast[0]?.time).toBe(AT);
    expect(r.timeline.hours).toHaveLength(48);
    expect(r.warnings).toEqual([]);
  });

  it('uses the day-ahead forecast for 24 hours, then the two-day-ahead one', async () => {
    const r = await replay();
    expect(r.forecastLeads.slice(0, 25)).toEqual(Array(25).fill(1));
    expect(r.forecastLeads.slice(25)).toEqual(Array(23).fill(2));
    expect(r.conditions.forecast[30]?.provenance.airTemp?.sourceRef).toBe(
      'open-meteo:ncep_nbm_conus:day2',
    );
  });

  it('uses the station report within 30 km for current weather, in the current hour only', async () => {
    const r = await replay();
    expect(r.conditions.currentBasis).toBe('station');
    expect(r.conditions.station?.id).toBe('KORE');
    expect(r.conditions.station?.distanceKm).toBeCloseTo(21.7, 1);
    const first = r.conditions.forecast[0];
    expect(first?.provenance.airTemp?.kind).toBe('observation');
    expect(first?.provenance.airTemp?.asOf).toBe('2026-05-15T09:52:00.000Z');
    expect(r.conditions.forecast[1]?.provenance.airTemp?.kind).toBe('forecast');
  });

  it('falls back to the forecast when the station is more than 30 km away', async () => {
    const far = copyCase();
    far.meta.lat = 43.2; // about 70 km north of Orange
    const r = await replayCase({ recorded: far, at: AT, timeZone: 'America/New_York', ruleSet });
    expect(r.conditions.currentBasis).toBe('forecast');
    expect(r.conditions.station).toBeUndefined();
    expect(r.conditions.forecast[0]?.provenance.airTemp?.kind).toBe('forecast');
  });

  it('dates the forecast an hour before the replay time', async () => {
    const r = await replay();
    expect(r.conditions.forecast[5]?.provenance.windSpeed?.asOf).toBe('2026-05-15T09:00:00.000Z');
  });

  it('uses the latest flow measured at or before the replay time for every hour', async () => {
    const r = await replay();
    const flows = r.forecast.map((p) => p.provenance.flow);
    expect(new Set(flows.map((f) => f?.asOf)).size).toBe(1);
    const asOf = Date.parse(flows[0]?.asOf ?? '');
    expect(asOf).toBeLessThanOrEqual(Date.parse(AT));
    expect(Date.parse(AT) - asOf).toBeLessThan(HOUR);
    expect(flows[0]?.kind).toBe('observation');
  });

  it('never uses a reading from after the replay time', async () => {
    const r = await replay({ at: '2026-05-14T00:00:00.000Z' });
    for (const p of r.conditions.forecast) {
      for (const provenance of Object.values(p.provenance)) {
        if (provenance.kind === 'observation') {
          expect(Date.parse(provenance.asOf)).toBeLessThanOrEqual(Date.parse(r.at));
        }
      }
    }
  });

  it('leaves water temperature unknown when the gauge has none, never within', async () => {
    const r = await replay();
    expect(r.timeline.unavailableMetrics).toContain('waterTemp');
    for (const hour of r.timeline.hours) expect(hour.status).not.toBe('within');
  });

  it('applies limits only to the chosen boat class', async () => {
    // A 1 mph wind limit for small boats, which the forecast wind goes over.
    const strict = RuleSet.parse({
      ...ruleSet,
      thresholds: ruleSet.thresholds.map((t) => (t.id === 't-wind' ? { ...t, value: 0.44704 } : t)),
    });
    const windFailures = (r: Awaited<ReturnType<typeof replayCase>>) =>
      r.timeline.hours.filter((h) =>
        h.failures.some((f) => f.kind === 'limit' && f.thresholdId === 't-wind'),
      ).length;
    expect(windFailures(await replay({ ruleSet: strict }))).toBeGreaterThan(0);
    const big = await replay({ ruleSet: strict, boatClassId: 'big' });
    expect(big.boatClassId).toBe('big');
    expect(windFailures(big)).toBe(0);
  });

  it('puts the station report from each hour beside the forecast', async () => {
    const r = await replay();
    expect(r.observed[0]).toMatchObject({ time: AT, basis: 'station' });
    expect(r.observed[0]?.values.airTemp).toBeTypeOf('number');
  });

  it('uses modeled history beside the forecast when there is no station', async () => {
    const noStation = copyCase();
    delete noStation.meta.station;
    noStation.byName.delete('iem-asos-ore');
    noStation.byName.set(
      'open-meteo-archive',
      loadFixture('historical/archive-turners-falls').body,
    );
    const r = await replayCase({
      recorded: noStation,
      at: AT,
      timeZone: 'America/New_York',
      ruleSet,
    });
    expect(r.conditions.currentBasis).toBe('forecast');
    expect(r.observed.every((o) => o.basis === 'modeled')).toBe(true);
  });

  it('builds measured hours from the station report and the gauge reading in each hour', async () => {
    const r = await replay();
    expect(r.measured.points).toHaveLength(48);
    const first = r.measured.points[0];
    expect(first?.time).toBe(AT);
    expect(first?.provenance.airTemp).toMatchObject({ kind: 'observation', source: 'nws' });
    expect(first?.provenance.airTemp?.asOf).toBe('2026-05-15T10:52:00.000Z');
    const flowAt = Date.parse(first?.provenance.flow?.asOf ?? '');
    expect(flowAt).toBeGreaterThanOrEqual(Date.parse(AT));
    expect(flowAt).toBeLessThan(Date.parse(AT) + HOUR);
    expect(first?.values.precipChance).toBeUndefined();
    expect(r.measured.hours).toHaveLength(48);
  });

  it('marks an hour outside when the measured value is over the limit, whatever the forecast said', async () => {
    // A 5 mph wind limit for small boats.
    const windy = RuleSet.parse({
      ...ruleSet,
      thresholds: ruleSet.thresholds.map((t) => (t.id === 't-wind' ? { ...t, value: 2.2352 } : t)),
    });
    const r = await replay({ ruleSet: windy });
    let checked = 0;
    r.measured.points.forEach((point, i) => {
      const wind = point.values.windSpeed;
      if (wind == null) return;
      const over = Math.round(wind / 0.44704) > 5;
      const failed = r.measured.hours[i]?.failures.some(
        (f) => f.kind === 'limit' && f.thresholdId === 't-wind',
      );
      expect(failed).toBe(over);
      checked += 1;
    });
    expect(checked).toBeGreaterThan(40);
    expect(r.measured.hours.some((h, i) => h.status !== r.timeline.hours[i]?.status)).toBe(true);
  });

  it('leaves out rain limits from the measured status, and says so', async () => {
    const plain = await replay();
    expect(plain.measured.leftOut).toEqual([]);
    const rainy = RuleSet.parse({
      ...ruleSet,
      thresholds: [
        ...ruleSet.thresholds,
        {
          id: 't-rain',
          metric: 'precipChance',
          comparison: 'max',
          boundary: 'inclusive',
          value: 0.01,
          enteredUnit: 'percent',
        },
      ],
    });
    const r = await replay({ ruleSet: rainy });
    expect(r.measured.leftOut).toEqual(['precipChance']);
    for (const hour of r.measured.hours) {
      expect(hour.failures.some((f) => f.kind === 'limit' && f.metric === 'precipChance')).toBe(
        false,
      );
    }
    expect(r.timeline.hours.some((h) => h.failures.some((f) => f.kind === 'limit'))).toBe(true);
  });

  it('never treats modeled history as measured', async () => {
    const noStation = copyCase();
    delete noStation.meta.station;
    noStation.byName.delete('iem-asos-ore');
    noStation.byName.set(
      'open-meteo-archive',
      loadFixture('historical/archive-turners-falls').body,
    );
    const r = await replayCase({
      recorded: noStation,
      at: AT,
      timeZone: 'America/New_York',
      ruleSet,
    });
    expect(r.measured.points.every((p) => p.values.airTemp === undefined)).toBe(true);
  });

  it('reports a source that failed instead of hiding it', async () => {
    const missing = copyCase();
    for (const url of missing.byUrl.keys()) {
      if (url.includes('parameter_code=00060')) missing.byUrl.delete(url);
    }
    const r = await replayCase({
      recorded: missing,
      at: AT,
      timeZone: 'America/New_York',
      ruleSet,
    });
    expect(r.warnings.some((w) => w.startsWith('usgs:'))).toBe(true);
    expect(r.forecast[0]?.provenance.flow).toBeUndefined();
  });

  it('rejects a replay time whose 48 hours the case does not cover', async () => {
    const range = replayRange(recorded.meta);
    expect(range).toEqual({
      earliest: '2026-05-14T00:00:00.000Z',
      latest: '2026-05-16T00:00:00.000Z',
    });
    await expect(replay({ at: '2026-05-16T01:00:00.000Z' })).rejects.toThrow(/outside the case/);
    await expect(replay({ at: '2026-05-13T23:00:00.000Z' })).rejects.toThrow(/outside the case/);
  });

  it('rejects a boat class the rule set does not have', async () => {
    await expect(replay({ boatClassId: 'quad' })).rejects.toThrow(/no boat class quad/);
  });

  it('rejects a case without its forecast', async () => {
    const noForecast = copyCase();
    noForecast.byName.delete('open-meteo-previous-runs');
    await expect(
      replayCase({ recorded: noForecast, at: AT, timeZone: 'America/New_York', ruleSet }),
    ).rejects.toThrow(/open-meteo-previous-runs/);
  });
});

describe('forecastLead', () => {
  const now = Date.parse(AT);
  it.each([
    [0, 1],
    [24, 1],
    [25, 2],
    [48, 2],
    [49, null],
  ])('an hour %i hours ahead uses the forecast made %s day(s) before it', (hoursAhead, lead) => {
    expect(forecastLead(now + hoursAhead * HOUR, now)).toBe(lead);
  });
});
