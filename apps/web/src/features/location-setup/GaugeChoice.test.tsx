import type { NearbyGauge } from '@rowing/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GaugeChoice, type NearbyState } from './GaugeChoice.tsx';

const montague: NearbyGauge = {
  ref: 'usgs:USGS-01170500',
  source: 'usgs',
  name: 'Connecticut River at Montague City, MA',
  lat: 42.58,
  lon: -72.57,
  metrics: ['flow', 'gaugeHeight', 'waterTemp'],
  distanceKm: 3.2,
  hasFlowForecast: true,
};

const deerfield: NearbyGauge = {
  ref: 'usgs:USGS-01170000',
  source: 'usgs',
  name: 'Deerfield River near West Deerfield, MA',
  lat: 42.56,
  lon: -72.65,
  metrics: ['gaugeHeight'],
  distanceKm: 8,
};

// The value of each checked radio button.
const checkedValues = (html: string) =>
  [...html.matchAll(/<input[^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => tag.includes('checked=""'))
    .map((tag) => tag.match(/value="([^"]*)"/)?.[1]);

function render(nearby: NearbyState, selected: string | null = null, suggested = selected) {
  return renderToStaticMarkup(
    <GaugeChoice
      nearby={nearby}
      selected={selected}
      suggested={suggested}
      units="metric"
      onSelect={() => {}}
    />,
  );
}

describe('GaugeChoice', () => {
  it('shows a loading state', () => {
    expect(render({ status: 'loading' })).toContain('Looking for gauges nearby');
  });

  it('shows an error with a retry button, not an empty list', () => {
    const html = render({ status: 'error', message: 'USGS timed out', retry: vi.fn() });
    expect(html).toContain('role="alert"');
    expect(html).toContain('USGS timed out');
    expect(html).toContain('Try again');
    expect(html).not.toContain('No gauges within');
  });

  it('lists each gauge with its distance and what it reports', () => {
    const html = render(
      { status: 'ready', gauges: [montague, deerfield], radiusKm: 25 },
      montague.ref,
    );
    expect(html).toContain('Connecticut River at Montague City, MA');
    expect(html).toContain('3.2 km away');
    expect(html).toContain('Reports flow, gauge height and water temperature');
    expect(html).toContain('Flow forecast');
    expect(html).toContain('Reports gauge height');
  });

  it('marks the suggested gauge in words, not only by selection', () => {
    const html = render(
      { status: 'ready', gauges: [montague, deerfield], radiusKm: 25 },
      deerfield.ref,
      montague.ref,
    );
    const montagueOption = html.slice(html.indexOf(montague.ref), html.indexOf(deerfield.ref));
    expect(montagueOption).toContain('Suggested');
    expect(html.match(/Suggested/g)).toHaveLength(1);
  });

  it('checks the chosen gauge, which can differ from the suggestion', () => {
    const html = render(
      { status: 'ready', gauges: [montague, deerfield], radiusKm: 25 },
      deerfield.ref,
      montague.ref,
    );
    expect(checkedValues(html)).toEqual([deerfield.ref]);
  });

  it('offers weather-only, checked when chosen', () => {
    const html = render({ status: 'ready', gauges: [montague], radiusKm: 25 }, null, montague.ref);
    expect(html).toContain('No gauge (weather only)');
    expect(checkedValues(html)).toEqual(['']);
  });

  it('explains weather-only mode when there are no gauges nearby', () => {
    const html = render({ status: 'ready', gauges: [], radiusKm: 25 });
    expect(html).toContain('No gauges within 25.0 km');
    expect(html).toContain('weather only');
    expect(checkedValues(html)).toEqual(['']);
  });
});
