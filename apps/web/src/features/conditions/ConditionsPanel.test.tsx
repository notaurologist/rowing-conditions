import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import recorded from '../../../test/fixtures/conditions-northfield.json' with { type: 'json' };
import type { Conditions } from '../../lib/api.ts';
import { ConditionsPanel } from './ConditionsPanel.tsx';

const NOW = '2026-10-26T02:20:00.000Z';
const base = () => structuredClone(recorded) as Conditions;
const render = (conditions = base(), units: 'us' | 'metric' = 'us', now = NOW) =>
  renderToStaticMarkup(<ConditionsPanel conditions={conditions} units={units} now={now} />);
const text = (html: string) => html.replace(/<[^>]+>/g, '').replaceAll('&#x27;', "'");

describe('ConditionsPanel', () => {
  it('shows each value with its source and local observation time', () => {
    const t = text(render());
    expect(t).toContain('Water temperature53 °F');
    expect(t).toContain(
      'USGS gauge: CONNECTICUT RIVER NEAR NORTHFIELD, MA · Observed 9:45 PM (35 min ago)',
    );
    expect(t).toContain(
      'NWS station: Orange Municipal Airport, 13.5 mi away · Observed 9:55 PM (25 min ago)',
    );
    expect(t).toContain('Times are local to the location (America/New_York)');
  });

  it('switches units when the preference changes', () => {
    expect(text(render(base(), 'metric'))).toContain('Water temperature11.7 °C');
    expect(text(render(base(), 'metric'))).toContain('Flow58.6 m³/s');
    expect(text(render(base(), 'us'))).toContain('Flow2,070 cfs');
  });

  it('shows qualifiers in words', () => {
    expect(text(render())).toContain('Provisional');
    const conditions = base();
    const flow = conditions.current.find((r) => r.metric === 'flow');
    if (flow) flow.qualifiers = ['estimated'];
    expect(text(render(conditions))).toContain('Estimated: not compared against limits');
  });

  it('flags a stale reading in words, not only by style', () => {
    const t = text(render(base(), 'us', '2026-10-26T07:30:00.000Z'));
    expect(t).toContain("Stale: older than 3 h, so it isn't compared against limits.");
  });

  it('never calls conditions safe or unsafe', () => {
    expect(text(render()).toLowerCase()).not.toMatch(/\bsafe\b|\bunsafe\b|go out|no go/);
  });

  it('says when a source failed, and which values it affects', () => {
    const conditions = base();
    conditions.current = conditions.current.filter((r) => r.source !== 'nws');
    conditions.alerts = [];
    conditions.sources = conditions.sources.map((s) =>
      s.id === 'nws' ? { id: 'nws', status: 'error', message: 'nws timed out' } : s,
    );
    const html = render(conditions);
    expect(html).toContain('role="alert"');
    const t = text(html);
    expect(t).toContain(
      "Couldn't reach the National Weather Service. Its values are missing below. (nws timed out)",
    );
    expect(t).toContain("Couldn't load from the National Weather Service");
    expect(t).toContain("Weather alerts couldn't be loaded.");
  });

  it('shows sunrise and sunset for the local date', () => {
    const t = text(render());
    expect(t).toContain('Sunrise7:15 AM');
    expect(t).toContain('Sunset5:52 PM');
  });

  it('lists active alerts with severity in words', () => {
    const conditions = base();
    conditions.alerts = [
      {
        id: 'a1',
        event: 'Wind Advisory',
        headline: 'Wind Advisory until 6 PM',
        severity: 'Moderate',
        onset: '2026-10-26T01:00:00.000Z',
        ends: '2026-10-26T22:00:00.000Z',
      },
    ];
    const t = text(render(conditions));
    expect(t).toContain('Wind Advisory Severity: Moderate');
    expect(t).toContain('Until Oct 26, 6:00 PM');
  });

  it('says there are no alerts when NWS answered with none', () => {
    expect(text(render())).toContain('No active weather alerts.');
  });
});
