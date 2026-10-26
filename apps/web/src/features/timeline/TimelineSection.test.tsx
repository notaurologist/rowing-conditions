import { type ChartMetric, type RuleSet, type SavedLocation, toInternal } from '@rowing/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import montague from '../../../test/fixtures/conditions-montague.json' with { type: 'json' };
import type { Conditions } from '../../lib/api.ts';
import { chartExplanation, TimelineSection } from './TimelineSection.tsx';

const conditions = () => structuredClone(montague) as Conditions;
const NOW = montague.forecast[0]?.time ?? '';
const location: SavedLocation = {
  id: 'loc',
  name: 'Turners Falls',
  lat: 42.6,
  lon: -72.55,
  gaugeRef: 'usgs:USGS-01170500',
  ruleSetIds: ['rs'],
};

const gustLimit = (mph: number): RuleSet => ({
  id: 'rs',
  name: 'Club A',
  boatClasses: [{ id: 'small', name: '1x and 2x' }],
  thresholds: [
    {
      id: 'gust',
      metric: 'windGust',
      comparison: 'max',
      boundary: 'inclusive',
      value: toInternal('windGust', mph, 'mph'),
      enteredUnit: 'mph',
    },
  ],
});

function render(props: { ruleSet?: RuleSet; pinned?: ChartMetric; data?: Conditions } = {}) {
  const html = renderToStaticMarkup(
    <TimelineSection
      conditions={props.data ?? conditions()}
      location={location}
      ruleSet={props.ruleSet}
      units="us"
      pinned={props.pinned}
      onPin={() => {}}
      now={NOW}
      width={343}
    />,
  );
  return {
    html,
    text: html
      .replace(/<[^>]+>/g, ' ')
      .replaceAll('&#x27;', "'")
      .replace(/\s+/g, ' '),
  };
}

const pressedChip = (html: string) =>
  html.match(/aria-pressed="true"><span aria-hidden="true">✓ <\/span>([^<]+)</)?.[1];

describe('TimelineSection', () => {
  it('offers a chip for each metric with data at this location', () => {
    const { html } = render();
    for (const label of ['Flow', 'Gauge height', 'Wind and gusts', 'Air temp', 'Rain chance']) {
      expect(html).toContain(`${label}</button>`);
    }
    expect(html).not.toContain('Water temp</button>'); // Montague doesn't report it
  });

  it('shows flow without a rule set, and says hours are not compared', () => {
    const { html, text } = render();
    expect(pressedChip(html)).toBe('Flow');
    expect(text).toContain(
      "No rule set is attached to this location, so hours aren't compared against limits.",
    );
    expect(html).not.toContain('data-status=');
  });

  it('follows the limiting factor when a rule set decides it, and says why', () => {
    const { html, text } = render({ ruleSet: gustLimit(5) });
    expect(pressedChip(html)).toBe('Wind and gusts');
    expect(text).toMatch(
      /Showing wind and gusts: it puts the most rowing hours outside Club A's limits \(\d+ hours\)\./,
    );
    expect(html).toContain('data-status="outside"');
    expect(text).toContain('Club A gusts: at most 5 mph');
  });

  it('explains the closest metric when nothing is outside the limits', () => {
    const { text } = render({ ruleSet: gustLimit(60) });
    expect(text).toContain(
      "Showing wind and gusts: no rowing hour is outside Club A's limits, and wind and gusts is closest to its limit.",
    );
  });

  it('uses the pinned metric over the limiting factor', () => {
    const { html, text } = render({ ruleSet: gustLimit(5), pinned: 'airTemp' });
    expect(pressedChip(html)).toBe('Air temp');
    expect(text).toContain('Showing air temperature, your pinned chart.');
    expect(html).toMatch(/aria-pressed="true"[^>]*>Unpin</);
  });

  it('ignores a pinned metric this location has no data for', () => {
    expect(pressedChip(render({ pinned: 'waterTemp' }).html)).toBe('Flow');
  });

  it('says when the rule set has no limits for the boat class', () => {
    const empty: RuleSet = { ...gustLimit(5), thresholds: [] };
    const { html, text } = render({ ruleSet: empty });
    expect(text).toContain(
      "Club A has no limits for 1x and 2x yet, so hours aren't compared against limits.",
    );
    expect(html).not.toContain('data-status=');
  });

  it('says once when a limit cannot be checked at this location', () => {
    const ruleSet = gustLimit(5);
    ruleSet.thresholds.push({
      id: 'water',
      metric: 'waterTemp',
      comparison: 'min',
      boundary: 'inclusive',
      value: toInternal('waterTemp', 50, 'degF'),
      enteredUnit: 'degF',
    });
    const { text } = render({ ruleSet });
    expect(text).toContain(
      "Club A's water temperature limit can't be checked here: no source at this location reports water temperature.",
    );
  });

  it('says where flow comes from', () => {
    expect(render().text).toContain(
      'Flow forecast from the National Water Prediction Service, issued Oct 25, 10:44 AM.',
    );
  });

  it('offers the hourly values as a table', () => {
    const { html } = render();
    expect(html).toContain('<summary>Hourly values</summary>');
    expect(html.match(/<th scope="row">/g)).toHaveLength(48);
  });

  it('says so when there is no forecast at all', () => {
    const data = conditions();
    data.forecast = [];
    expect(render({ data }).text).toContain('No forecast values are available for this location.');
  });

  it('never calls conditions safe or unsafe', () => {
    for (const props of [{}, { ruleSet: gustLimit(5) }, { ruleSet: gustLimit(60) }]) {
      expect(render(props).text.toLowerCase()).not.toMatch(
        /\bsafe\b|\bunsafe\b|go out|no go|good to go/,
      );
    }
  });
});

describe('chartExplanation', () => {
  it('words a single hour in the singular', () => {
    expect(
      chartExplanation({ metric: 'flow', reason: 'mostHoursOutside', hoursOutside: 1 }, 'Club A'),
    ).toBe("Showing flow: it puts the most rowing hours outside Club A's limits (1 hour).");
  });

  it('explains the fallback with and without a rule set', () => {
    expect(chartExplanation({ metric: 'flow', reason: 'fallback' }, undefined)).toBe(
      'Showing flow. Attach a rule set to chart the metric that decides things.',
    );
    expect(chartExplanation({ metric: 'wind', reason: 'fallback' }, 'Club A')).toBe(
      'Showing wind and gusts. Club A has no limit that decides the chart here.',
    );
  });
});
