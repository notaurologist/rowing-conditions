import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Conditions } from '../../lib/api.ts';
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
});
