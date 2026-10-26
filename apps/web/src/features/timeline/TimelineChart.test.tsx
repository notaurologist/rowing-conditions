import type { DaylightTimes, ForecastPoint } from '@rowing/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import montague from '../../../test/fixtures/conditions-montague.json' with { type: 'json' };
import { TimelineChart } from './TimelineChart.tsx';
import { type TimelineModel, timelineModel } from './timelineModel.ts';

const PHONE = 343; // 375 px screen less the page gutters
const DESKTOP = 900;
const forecast = () => structuredClone(montague.forecast) as ForecastPoint[];

function model(overrides: Partial<Parameters<typeof timelineModel>[0]> = {}): TimelineModel {
  return timelineModel({
    forecast: forecast(),
    metric: 'wind',
    units: 'us',
    lat: 42.6,
    lon: -72.55,
    daylight: montague.daylight as DaylightTimes[],
    ...overrides,
  });
}

const render = (m: TimelineModel, width = DESKTOP) =>
  renderToStaticMarkup(
    <TimelineChart
      model={m}
      width={width}
      timeZone="America/New_York"
      title="Wind"
      summary="Summary"
    />,
  );

// The path data of each line, which visx draws with M (move) and L (line) commands.
const paths = (html: string) =>
  [...html.matchAll(/<path[^>]*class="[^"]*tl-line[^"]*"[^>]*d="([^"]*)"/g)].map((m) => m[1] ?? '');

describe('TimelineChart', () => {
  it('draws one line per series at desktop and phone widths', () => {
    for (const width of [DESKTOP, PHONE]) {
      const html = render(model(), width);
      expect(html).toContain(`width="${width}"`);
      expect(paths(html)).toHaveLength(2);
    }
  });

  it('is labeled for screen readers with a title and summary', () => {
    const html = render(model());
    expect(html).toMatch(/<svg[^>]*role="img"[^>]*aria-labelledby="[^"]+"/);
    expect(html).toContain('<title id=');
    expect(html).toContain('<desc id=');
  });

  it('breaks a line where values are missing', () => {
    const points = forecast();
    for (const i of [10, 11, 12]) {
      const p = points[i];
      if (p) p.values.windSpeed = null;
    }
    const [speed] = paths(render(model({ forecast: points })));
    // A gap starts a new subpath: two moves instead of one.
    expect(speed?.match(/M/g)).toHaveLength(2);
    expect(paths(render(model()))[0]?.match(/M/g)).toHaveLength(1);
  });

  it('marks a lone value between gaps with a dot', () => {
    const points = forecast();
    for (const i of [10, 12]) {
      const p = points[i];
      if (p) p.values.windSpeed = null;
    }
    expect(render(model({ forecast: points }))).toContain('class="tl-point"');
    expect(render(model())).not.toContain('class="tl-point"');
  });

  it('shades light levels and labels wide bands in words', () => {
    const html = render(model());
    expect(html).toContain('data-light="twilight"');
    expect(html).toContain('data-light="dark"');
    expect(html).toMatch(/class="tl-band-label"[^>]*>Dark</);
  });

  it('draws no status strip without a rule set', () => {
    expect(render(model())).not.toContain('data-status=');
  });

  it('draws each hour’s status with a pattern and a text title, not color alone', () => {
    const m = model();
    m.hours = m.hours.map((h, i) => ({
      ...h,
      status: i < 2 ? 'outside' : i < 4 ? 'unknown' : 'within',
    }));
    const html = render(m);
    expect(html.match(/data-status="outside"[^>]*fill="url\(#/g)).toHaveLength(2);
    expect(html.match(/data-status="unknown"[^>]*fill="url\(#/g)).toHaveLength(2);
    expect(html).toContain('<title>Outside limits</title>');
    expect(html).toContain('<title>Unknown</title>');
    expect(html).toContain('<title>Within limits</title>');
  });

  it('draws a labeled limit line', () => {
    const m = model();
    m.limits = [
      { thresholdId: 't', metric: 'windGust', value: 15, label: 'Club A gusts: at most 15 mph' },
    ];
    const html = render(m);
    expect(html).toContain('class="tl-limit-line"');
    expect(html).toContain('Club A gusts: at most 15 mph');
  });

  it('labels hours in the location’s time zone, with weekdays at midnight', () => {
    const html = render(model());
    expect(html).toContain('>12 PM<');
    expect(html).toContain('>Tue<');
    expect(html).toContain('>Wed<');
  });

  it('renders nothing for an empty forecast or a container too narrow to draw', () => {
    expect(render(model({ forecast: [] }))).toBe('');
    expect(render(model(), 80)).toBe('');
  });
});
