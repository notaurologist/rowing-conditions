import { RuleSet, type SavedLocation, toInternal } from '@rowing/core';
import { describe, expect, it } from 'vitest';
import {
  addLimit,
  attachRuleSet,
  checkDraft,
  detachRuleSet,
  draftFromRuleSet,
  emptyDraft,
  type RuleSetDraft,
  removeRuleSet,
  upsertRuleSet,
} from './ruleSetDraft.ts';

const named = (draft: RuleSetDraft): RuleSetDraft => ({ ...draft, name: 'Club A' });

function withLimit(
  draft: RuleSetDraft,
  value: string,
  change: Partial<RuleSetDraft['limits'][0]> = {},
) {
  const added = addLimit(draft, 'windGust', 'us');
  const limit = added.limits.at(-1);
  if (!limit) throw new Error('no limit added');
  return { ...added, limits: [...draft.limits, { ...limit, value, ...change }] };
}

function errorsOf(draft: RuleSetDraft) {
  const result = checkDraft(draft);
  if (result.ok) throw new Error('expected errors');
  return result.errors;
}

function ruleSetOf(draft: RuleSetDraft) {
  const result = checkDraft(draft);
  if (!result.ok) throw new Error(`unexpected errors: ${JSON.stringify(result.errors)}`);
  return result.ruleSet;
}

describe('emptyDraft', () => {
  it('starts with no name, no limits and one boat class for every boat', () => {
    const draft = emptyDraft();
    expect(draft.name).toBe('');
    expect(draft.limits).toEqual([]);
    expect(draft.boatClasses.map((c) => c.name)).toEqual(['All boats']);
    expect(draft.daylight.enabled).toBe(false);
    expect(draft.flowGaugeRef).toBe('');
  });
});

describe('addLimit', () => {
  it('adds an empty limit in the display unit, worded "at most"', () => {
    const limit = addLimit(emptyDraft(), 'flow', 'us').limits[0];
    expect(limit).toMatchObject({
      metric: 'flow',
      wording: 'atMost',
      value: '',
      unit: 'cfs',
      boatClassIds: [],
    });
    expect(addLimit(emptyDraft(), 'flow', 'metric').limits[0]?.unit).toBe('m3/s');
  });

  it('gives each limit its own id', () => {
    const draft = addLimit(addLimit(emptyDraft(), 'flow', 'us'), 'flow', 'us');
    expect(draft.limits[0]?.id).not.toBe(draft.limits[1]?.id);
  });
});

describe('checkDraft', () => {
  it('builds a valid rule set from what was typed', () => {
    const ruleSet = ruleSetOf(withLimit(named(emptyDraft()), ' 15 ', { wording: 'below' }));
    expect(RuleSet.safeParse(ruleSet).success).toBe(true);
    expect(ruleSet.name).toBe('Club A');
    expect(ruleSet.thresholds[0]).toMatchObject({
      metric: 'windGust',
      comparison: 'max',
      boundary: 'exclusive',
      value: toInternal('windGust', 15, 'mph'),
      enteredUnit: 'mph',
    });
    expect(ruleSet.thresholds[0]).not.toHaveProperty('boatClassIds');
    expect(ruleSet).not.toHaveProperty('daylight');
    expect(ruleSet).not.toHaveProperty('flowGaugeRef');
  });

  it('accepts thousands separators', () => {
    const draft = withLimit(named(emptyDraft()), '3,100', { metric: 'flow', unit: 'cfs' });
    expect(ruleSetOf(draft).thresholds[0]?.value).toBeCloseTo(toInternal('flow', 3100, 'cfs'));
  });

  it('asks for a name', () => {
    expect(errorsOf(emptyDraft()).name).toBe('Give the rule set a name, such as your club’s.');
    expect(errorsOf({ ...emptyDraft(), name: '   ' }).name).toBeDefined();
  });

  it('asks for a name for each boat class', () => {
    const draft = named(emptyDraft());
    const id = draft.boatClasses[0]?.id as string;
    expect(errorsOf({ ...draft, boatClasses: [{ id, name: ' ' }] })[`class:${id}`]).toBe(
      'Name this boat class.',
    );
  });

  it('needs at least one boat class', () => {
    expect(errorsOf({ ...named(emptyDraft()), boatClasses: [] }).classes).toBe(
      'Add at least one boat class.',
    );
  });

  it('asks for a number', () => {
    for (const typed of ['', '  ', 'fifteen', '15 mph', '1e400']) {
      const draft = withLimit(named(emptyDraft()), typed);
      const id = draft.limits[0]?.id;
      expect(errorsOf(draft)[`limit:${id}`]).toBe('Enter a number.');
    }
  });

  it('rejects more precision than the unit shows', () => {
    const mph = withLimit(named(emptyDraft()), '15.5');
    expect(errorsOf(mph)[`limit:${mph.limits[0]?.id}`]).toBe('mph limits are whole numbers.');
    const kcfs = withLimit(named(emptyDraft()), '20.25', { metric: 'flow', unit: 'kcfs' });
    expect(errorsOf(kcfs)[`limit:${kcfs.limits[0]?.id}`]).toBe(
      'kcfs limits have at most 1 decimal place.',
    );
    const ft = withLimit(named(emptyDraft()), '4.25', { metric: 'gaugeHeight', unit: 'ft' });
    expect(checkDraft(ft).ok).toBe(true);
  });

  it('rejects limits of zero or less for flow, wind and rain chance', () => {
    for (const [metric, unit] of [
      ['flow', 'cfs'],
      ['windSpeed', 'mph'],
      ['windGust', 'km/h'],
      ['precipChance', 'percent'],
    ] as const) {
      for (const typed of ['0', '-5']) {
        const draft = withLimit(named(emptyDraft()), typed, { metric, unit });
        expect(errorsOf(draft)[`limit:${draft.limits[0]?.id}`]).toBe('Must be more than zero.');
      }
    }
  });

  it('allows zero and below for temperatures and gauge height', () => {
    for (const [metric, unit] of [
      ['airTemp', 'degF'],
      ['waterTemp', 'degC'],
      ['gaugeHeight', 'ft'],
    ] as const) {
      expect(checkDraft(withLimit(named(emptyDraft()), '-1', { metric, unit })).ok).toBe(true);
    }
  });

  it('rejects a rain chance over 100%', () => {
    const draft = withLimit(named(emptyDraft()), '101', {
      metric: 'precipChance',
      unit: 'percent',
    });
    expect(errorsOf(draft)[`limit:${draft.limits[0]?.id}`]).toBe(
      'Rain chance can’t be more than 100%.',
    );
    expect(
      checkDraft({
        ...draft,
        limits: [{ ...(draft.limits[0] as RuleSetDraft['limits'][0]), value: '100' }],
      }).ok,
    ).toBe(true);
  });

  it('scopes a limit to the boat classes picked, ignoring classes since removed', () => {
    const base = named(emptyDraft());
    const draft: RuleSetDraft = {
      ...base,
      boatClasses: [
        { id: 'small', name: '1x and 2x' },
        { id: 'big', name: '4+ and 8+' },
      ],
    };
    const scoped = withLimit(draft, '15', { boatClassIds: ['small', 'gone'] });
    expect(ruleSetOf(scoped).thresholds[0]?.boatClassIds).toEqual(['small']);
    const onlyGone = withLimit(draft, '15', { boatClassIds: ['gone'] });
    expect(ruleSetOf(onlyGone).thresholds[0]).not.toHaveProperty('boatClassIds');
  });

  it('saves a daylight window only when turned on, in whole minutes', () => {
    const draft = named(emptyDraft());
    const off = { ...draft, daylight: { enabled: false, before: 'x', after: '' } };
    expect(ruleSetOf(off)).not.toHaveProperty('daylight');

    const on = { ...draft, daylight: { enabled: true, before: '60', after: '30' } };
    expect(ruleSetOf(on).daylight).toEqual({ minutesBeforeSunrise: 60, minutesAfterSunset: 30 });

    const bad = { ...draft, daylight: { enabled: true, before: '', after: '7.5' } };
    expect(errorsOf(bad)).toMatchObject({
      'daylight.before': 'Enter whole minutes.',
      'daylight.after': 'Enter whole minutes.',
    });
  });

  it('keeps the flow gauge only when there is a flow limit', () => {
    const draft = { ...named(emptyDraft()), flowGaugeRef: 'usgs:USGS-01170500' as const };
    expect(ruleSetOf(withLimit(draft, '15'))).not.toHaveProperty('flowGaugeRef');
    const flow = withLimit(draft, '3100', { metric: 'flow', unit: 'cfs' });
    expect(ruleSetOf(flow).flowGaugeRef).toBe('usgs:USGS-01170500');
  });

  it('allows a rule set with no limits yet', () => {
    expect(ruleSetOf(named(emptyDraft())).thresholds).toEqual([]);
  });
});

describe('draftFromRuleSet', () => {
  it('gives back what was entered, so saving unchanged changes nothing', () => {
    const draft: RuleSetDraft = {
      ...named(emptyDraft()),
      boatClasses: [
        { id: 'small', name: '1x and 2x' },
        { id: 'big', name: 'Eights' },
      ],
      daylight: { enabled: true, before: '60', after: '30' },
      flowGaugeRef: 'nwps:MNTM3',
    };
    const filled = withLimit(
      withLimit(draft, '3.1', { metric: 'flow', unit: 'kcfs', wording: 'below' }),
      '39',
      {
        metric: 'waterTemp',
        unit: 'degF',
        wording: 'atLeast',
        boatClassIds: ['small'],
      },
    );
    const ruleSet = ruleSetOf(filled);
    const again = draftFromRuleSet(ruleSet);
    expect(again.limits.map((l) => [l.metric, l.wording, l.value, l.unit, l.boatClassIds])).toEqual(
      [
        ['flow', 'below', '3.1', 'kcfs', []],
        ['waterTemp', 'atLeast', '39', 'degF', ['small']],
      ],
    );
    expect(again.daylight).toEqual({ enabled: true, before: '60', after: '30' });
    expect(ruleSetOf(again)).toEqual(ruleSet);
  });

  it('shows the daylight window off, with empty minutes, when there is none', () => {
    expect(draftFromRuleSet(ruleSetOf(named(emptyDraft()))).daylight).toEqual({
      enabled: false,
      before: '',
      after: '',
    });
  });
});

const location = (id: string, ruleSetIds: string[]): SavedLocation => ({
  id,
  name: id,
  lat: 42,
  lon: -72,
  ruleSetIds,
});

describe('saving and removing rule sets', () => {
  const a = ruleSetOf(named(emptyDraft()));

  it('adds a new rule set, or replaces the one with the same id', () => {
    expect(upsertRuleSet([], a)).toEqual([a]);
    const renamed = { ...a, name: 'Club B' };
    expect(upsertRuleSet([a], renamed)).toEqual([renamed]);
  });

  it('attaches a rule set to one location, once', () => {
    const locations = [location('home', []), location('away', [])];
    const attached = attachRuleSet(locations, 'home', a.id);
    expect(attached.map((l) => l.ruleSetIds)).toEqual([[a.id], []]);
    expect(attachRuleSet(attached, 'home', a.id)).toEqual(attached);
  });

  it('detaches a rule set from one location and keeps it for the others', () => {
    const locations = [location('home', [a.id, 'other']), location('away', [a.id])];
    expect(detachRuleSet(locations, 'home', a.id).map((l) => l.ruleSetIds)).toEqual([
      ['other'],
      [a.id],
    ]);
  });

  it('removes a rule set and detaches it from every location', () => {
    const other = { ...a, id: 'other' };
    const { ruleSets, locations } = removeRuleSet(
      [a, other],
      [location('home', [a.id, 'other']), location('away', [a.id])],
      a.id,
    );
    expect(ruleSets).toEqual([other]);
    expect(locations.map((l) => l.ruleSetIds)).toEqual([['other'], []]);
  });
});
