import type { RuleSet, SavedLocation } from '@rowing/core';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import montague from '../../../test/fixtures/conditions-montague.json' with { type: 'json' };
import { NAMED_GAUGE, withNamedGauge } from '../../../test/namedGauge.ts';
import type { Conditions } from '../../lib/api.ts';
import { evaluateLocation } from '../timeline/evaluateLocation.ts';
import { Summary } from './Summary.tsx';

const conditions = {
  location: { lat: 42.5, lon: -72.43, timezone: 'America/New_York' },
  current: null,
  forecast: [],
  flowSeries: [],
  daylight: [],
  alerts: [],
  sources: [],
} as unknown as Conditions; // only the fields the summary reads without a rule set

describe('Summary', () => {
  it('asks for the club’s limits when there are none to compare against', () => {
    const html = renderToString(
      <Summary
        conditions={conditions}
        evaluated={null}
        now="2026-10-26T14:00:00.000Z"
        onEditLimits={() => {}}
      />,
    );
    expect(html).toContain('No limits to compare against yet');
    expect(html).toContain('Enter your club’s limits</button>');
  });

  it('names the gauge the rule set’s flow comes from, even at a weather-only location', () => {
    const lake: SavedLocation = {
      id: 'l',
      name: 'Lake Wyola',
      lat: 42.5,
      lon: -72.43,
      ruleSetIds: ['rs'],
    };
    const ruleSet: RuleSet = {
      id: 'rs',
      name: 'Club A',
      boatClasses: [{ id: 'all', name: 'All boats' }],
      thresholds: [],
      flowGaugeRef: NAMED_GAUGE,
    };
    const named = withNamedGauge(structuredClone(montague) as Conditions, { weatherOnly: true });
    const now = '2026-10-26T12:35:00.000Z';
    const html = renderToString(
      <Summary
        conditions={named}
        evaluated={evaluateLocation(named, lake, ruleSet, now)}
        now={now}
        onEditLimits={() => {}}
      />,
    );
    expect(html).toContain('North River at Shattuckville, MA');
    expect(html).not.toContain('Weather only');
  });
});
