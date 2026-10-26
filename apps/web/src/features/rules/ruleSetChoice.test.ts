import type { RuleSet, SavedLocation } from '@rowing/core';
import { describe, expect, it } from 'vitest';
import type { Preferences } from '../../lib/storage.ts';
import {
  attachedRuleSets,
  chooseBoatClass,
  flowGaugeRefs,
  selectRuleSet,
} from './ruleSetChoice.ts';

const ruleSet = (
  id: string,
  classes: string[],
  flowGaugeRef?: RuleSet['flowGaugeRef'],
): RuleSet => ({
  id,
  name: id,
  boatClasses: classes.map((c) => ({ id: c, name: c })),
  thresholds: [],
  ...(flowGaugeRef ? { flowGaugeRef } : {}),
});

const a = ruleSet('a', ['small', 'big']);
const b = ruleSet('b', ['all']);
const c = ruleSet('c', ['all']);
const home: SavedLocation = { id: 'home', name: 'Home', lat: 42, lon: -72, ruleSetIds: ['b', 'a'] };
const prefs: Preferences = { units: 'us' };

const summary = (choices: ReturnType<typeof attachedRuleSets>) =>
  choices.map((x) => [x.ruleSet.id, x.boatClassId, x.selected]);

describe('attachedRuleSets', () => {
  it('lists the location’s rule sets in its order, selecting the first by default', () => {
    expect(summary(attachedRuleSets(home, [a, b, c], prefs))).toEqual([
      ['b', 'all', true],
      ['a', 'small', false],
    ]);
  });

  it('follows the stored selection and boat classes', () => {
    const chosen = { ...prefs, selectedRuleSetIds: { home: 'a' }, boatClassIds: { a: 'big' } };
    expect(summary(attachedRuleSets(home, [a, b], chosen))).toEqual([
      ['b', 'all', false],
      ['a', 'big', true],
    ]);
  });

  it('falls back when the stored choice is gone', () => {
    const stale = { ...prefs, selectedRuleSetIds: { home: 'c' }, boatClassIds: { a: 'deleted' } };
    expect(summary(attachedRuleSets(home, [a, b, c], stale))).toEqual([
      ['b', 'all', true],
      ['a', 'small', false],
    ]);
  });

  it('skips ids with no stored rule set, and returns nothing without rule sets', () => {
    expect(summary(attachedRuleSets(home, [a], prefs))).toEqual([['a', 'small', true]]);
    expect(attachedRuleSets({ ...home, ruleSetIds: [] }, [a, b], prefs)).toEqual([]);
  });
});

describe('selectRuleSet and chooseBoatClass', () => {
  it('store the choice without touching other locations or rule sets', () => {
    const before = { ...prefs, selectedRuleSetIds: { away: 'c' }, boatClassIds: { b: 'all' } };
    expect(selectRuleSet(before, 'home', 'a').selectedRuleSetIds).toEqual({ away: 'c', home: 'a' });
    expect(chooseBoatClass(before, 'a', 'big').boatClassIds).toEqual({ b: 'all', a: 'big' });
  });
});

describe('flowGaugeRefs', () => {
  it('lists each named flow gauge once', () => {
    const named = [
      ruleSet('x', ['all'], 'nwps:MNTM3'),
      ruleSet('y', ['all'], 'nwps:MNTM3'),
      ruleSet('z', ['all'], 'usgs:USGS-01170500'),
      ruleSet('w', ['all']),
    ];
    const location = { ...home, ruleSetIds: ['x', 'y', 'z', 'w'] };
    expect(flowGaugeRefs(attachedRuleSets(location, named, prefs))).toEqual([
      'nwps:MNTM3',
      'usgs:USGS-01170500',
    ]);
  });

  it('asks for no more gauges than the API accepts', () => {
    const many = ['01', '02', '03', '04', '05', '06'].map((n) =>
      ruleSet(n, ['all'], `usgs:USGS-011700${n}` as RuleSet['flowGaugeRef']),
    );
    const location = { ...home, ruleSetIds: many.map((r) => r.id) };
    expect(flowGaugeRefs(attachedRuleSets(location, many, prefs))).toHaveLength(5);
  });
});
