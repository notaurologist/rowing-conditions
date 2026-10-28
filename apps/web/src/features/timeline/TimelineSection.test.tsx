import { type RuleSet, type SavedLocation, toInternal } from '@rowing/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import montague from '../../../test/fixtures/conditions-montague.json' with { type: 'json' };
import type { Conditions } from '../../lib/api.ts';
import { evaluateLocation } from './evaluateLocation.ts';
import { TimelineSection } from './TimelineSection.tsx';

const NOW = '2026-10-26T12:35:00.000Z';
const location: SavedLocation = {
  id: 'l',
  name: 'Turners Falls',
  lat: 42.6,
  lon: -72.55,
  gaugeRef: 'usgs:USGS-01170500',
  ruleSetIds: ['rs'],
};
const clubA: RuleSet = {
  id: 'rs',
  name: 'Club A',
  boatClasses: [{ id: 'small', name: '1x and 2x' }],
  thresholds: [
    {
      id: 'flow',
      metric: 'flow',
      comparison: 'max',
      boundary: 'inclusive',
      value: toInternal('flow', 3100, 'cfs'),
      enteredUnit: 'cfs',
    },
    {
      id: 'gust',
      metric: 'windGust',
      comparison: 'max',
      boundary: 'inclusive',
      value: toInternal('windGust', 15, 'mph'),
      enteredUnit: 'mph',
    },
    {
      id: 'air',
      metric: 'airTemp',
      comparison: 'min',
      boundary: 'inclusive',
      value: toInternal('airTemp', 35, 'degF'),
      enteredUnit: 'degF',
    },
  ],
};

function render(
  ruleSet: RuleSet | null = clubA,
  conditions = structuredClone(montague) as Conditions,
  at: SavedLocation = location,
) {
  const html = renderToStaticMarkup(
    <TimelineSection
      conditions={conditions}
      location={at}
      evaluated={evaluateLocation(conditions, at, ruleSet ?? undefined, NOW)}
      units="us"
      now={NOW}
    />,
  );
  return {
    html,
    text: html
      .replace(/<[^>]+>/g, ' ')
      .replaceAll('&#x27;', "'")
      .replaceAll('’', "'")
      .replace(/\s+/g, ' '),
  };
}

// The path data of a data line.
const paths = (html: string, cls: string) =>
  [...html.matchAll(new RegExp(`<path[^>]*class="[^"]*${cls}[^"]*"[^>]*d="([^"]*)"`, 'g'))].map(
    (m) => m[1] ?? '',
  );

describe('TimelineSection', () => {
  it('stacks a labelled row for each element on one time axis', () => {
    const { html, text } = render();
    for (const row of ['flow', 'wind', 'airTemp', 'rain'])
      expect(html).toContain(`data-row="${row}"`);
    expect(html).not.toContain('data-row="waterTemp"'); // Montague doesn't measure it
    expect(text).toContain('River flow cfs, limit 3,100');
    expect(text).toContain('Wind mph, sustained to gusts; gust limit 15');
    expect(text).toContain('Air temperature °F, limit 35°');
    expect(text).toMatch(/Mon 26 .*Tue 27 .*Wed 28/);
  });

  it('draws each limit as a labelled line with the room and the excess filled', () => {
    const { html } = render();
    expect(html.match(/class="mg-limit"/g)).toHaveLength(3);
    expect(html).toContain('>limit 3,100<');
    expect(html).toContain('>gust limit 15<');
    expect(html).toMatch(/class="[^"]*mg-room/);
    expect(html).toMatch(/class="[^"]*mg-over/);
  });

  it('shows the latest measurements as dots with their time', () => {
    const { text } = render();
    expect(text).toContain('3,750 measured 8:15 AM');
    expect(text).toContain('30° measured 8:30 AM');
    expect(text).toContain('calm');
  });

  it('shows each status span by color alone, and in words for screen readers', () => {
    const { html, text } = render();
    expect(html).toContain('class="mg-status-outside"');
    expect(html).toContain('class="mg-status-within"');
    expect(text).not.toMatch(/Outside|Within/);
    expect(html).toMatch(
      /role="img" aria-label="Club A status: outside Today 8 AM to 2 PM; within Today 2 PM to 6:20 PM; within Tomorrow 6:49 AM to 6:18 PM;/,
    );
  });

  it('marks the windows within the limits with edges, without words', () => {
    const { html, text } = render();
    expect(html).toContain('class="mg-window-edge"');
    expect(text).not.toContain('window');
  });

  it('reads out every row at the next window, with a slider for the hour', () => {
    const { html, text } = render();
    expect(text).toContain('3,090 cfs · 10 under');
    expect(text).toContain('6, gusts 12 mph · 3 under · from W');
    expect(text).toContain('65 °F · 30 above');
    expect(html).toMatch(/<input type="range" min="0" max="47" step="1" value="6"/);
  });

  it('draws direction arrows on the wind row', () => {
    expect(render().html.match(/class="mg-arrow"/g)).toHaveLength(16);
  });

  it('breaks a line where the forecast has no value', () => {
    const conditions = structuredClone(montague) as Conditions;
    for (const i of [20, 21, 22]) {
      const p = conditions.forecast[i];
      if (p) p.values.airTemp = null;
    }
    const [air] = paths(render(clubA, conditions).html, 'mg-line-airTemp');
    expect(air?.match(/M/g)).toHaveLength(2);
    expect(paths(render().html, 'mg-line-airTemp')[0]?.match(/M/g)).toHaveLength(1);
  });

  it('starts the line at the forecast after a measured current hour', () => {
    const conditions = structuredClone(montague) as Conditions;
    const first = conditions.forecast[0];
    if (first) {
      first.values.flow = toInternal('flow', 1860, 'cfs');
      first.provenance.flow = {
        kind: 'observation',
        asOf: '2026-10-26T12:15:00.000Z',
        source: 'usgs',
      };
    }
    const { html } = render(clubA, conditions);
    // x of the second hour: (1 + 0.5) / 48 of the width.
    expect(paths(html, 'mg-line-flow')[0]).toMatch(/^M3\.125,/);
    expect(paths(render().html, 'mg-line-flow')[0]).toMatch(/^M1\.042,/);
  });

  it('shades twilight and night', () => {
    const { html } = render();
    expect(html).toContain('mg-light mg-twilight');
    expect(html).toContain('mg-light mg-night');
  });

  it('has no status, limits or windows without a rule set, and says so', () => {
    const { html, text } = render(null);
    expect(text).toContain(
      "No rule set is attached to this location, so hours aren't compared against limits.",
    );
    expect(html).not.toContain('mg-status');
    expect(html).not.toContain('class="mg-limit"');
    expect(html).not.toContain('mg-window-edge');
  });

  it('says once when a limit cannot be checked here', () => {
    const ruleSet = structuredClone(clubA);
    ruleSet.thresholds.push({
      id: 'water',
      metric: 'waterTemp',
      comparison: 'min',
      boundary: 'inclusive',
      value: toInternal('waterTemp', 50, 'degF'),
      enteredUnit: 'degF',
    });
    expect(render(ruleSet).text).toContain(
      "Club A's water temperature limit can't be checked here: no source at this location reports water temperature.",
    );
  });

  it('shows each attached rule set’s status and notices, by name', () => {
    const conditions = structuredClone(montague) as Conditions;
    const water: RuleSet = {
      id: 'rs-w',
      name: 'Club W',
      boatClasses: [{ id: 'all', name: 'All boats' }],
      thresholds: [
        {
          id: 'water',
          metric: 'waterTemp',
          comparison: 'min',
          boundary: 'inclusive',
          value: toInternal('waterTemp', 50, 'degF'),
          enteredUnit: 'degF',
        },
      ],
    };
    const empty: RuleSet = { ...water, id: 'rs-e', name: 'Club E', thresholds: [] };
    const a = evaluateLocation(conditions, location, clubA, NOW);
    const all = [clubA, water, empty].flatMap(
      (r) => evaluateLocation(conditions, location, r, NOW) ?? [],
    );
    const html = renderToStaticMarkup(
      <TimelineSection
        conditions={conditions}
        location={location}
        evaluated={a}
        alongside={all}
        units="us"
        now={NOW}
      />,
    );
    const text = html
      .replace(/<[^>]+>/g, ' ')
      .replaceAll('’', "'")
      .replace(/\s+/g, ' ');
    expect(html).toMatch(/aria-label="Club A status: outside Today 8 AM/);
    // No source here measures water temperature, so Club W's every hour is unknown.
    expect(html).toMatch(/aria-label="Club W status: unknown Today 8 AM/);
    expect(text).toContain("Club W's water temperature limit can't be checked here");
    expect(text).not.toContain("Club A's water temperature limit");
    expect(text).toContain('Club E has no limits for All boats yet');
    expect(text).toContain('Club A all limits · drawn below');
  });

  it('never gives a verdict', () => {
    for (const ruleSet of [clubA, null]) {
      expect(render(ruleSet).text.toLowerCase()).not.toMatch(
        /\bsafe\b|\bunsafe\b|go out|no go|good to go/,
      );
    }
  });
});

describe('TimelineSection set-aside flow forecast (#144)', () => {
  // The forecast set aside: the 8:15 AM reading holds 3 hours, then flow is withheld, and the
  // forecast itself comes along to be shown dashed.
  const setAside = () => {
    const conditions = structuredClone(montague) as Conditions;
    const asOf = '2026-10-26T12:15:00.000Z';
    for (const [i, p] of conditions.forecast.entries()) {
      const provenance = { kind: 'observation' as const, asOf, source: 'usgs' as const };
      p.values.flow = i < 3 ? 106 : null;
      p.provenance.flow = i < 3 ? provenance : { ...provenance, withheld: 'forecastDisagrees' };
    }
    conditions.flowSetAside = [
      {
        gaugeRef: 'usgs:USGS-01170500',
        issuedAt: '2026-10-25T14:44:00.000Z',
        measured: toInternal('flow', 3750, 'cfs'),
        measuredAt: asOf,
        forecastForMeasurement: toInternal('flow', 2650, 'cfs'),
        points: conditions.forecast.map((p) => ({
          time: p.time,
          flow: toInternal('flow', 5750, 'cfs'),
        })),
      },
    ];
    return conditions;
  };

  it('draws the forecast dashed and names it in the row', () => {
    const { html, text } = render(clubA, setAside());
    expect(html).toContain('mg-line-set-aside');
    expect(text).toContain("dashed: NWPS forecast, doesn't match the gauge");
  });

  it('marks hours that meet every limit on the doubted forecast as probably within (0020)', () => {
    const conditions = setAside();
    for (const p of conditions.forecast) {
      const prov = p.provenance.flow;
      if (prov?.withheld === 'forecastDisagrees')
        prov.setAside = {
          value: toInternal('flow', 2000, 'cfs'),
          asOf: '2026-10-25T14:44:00.000Z',
        };
    }
    const { html } = render(clubA, conditions);
    expect(html).toContain('mg-status-probablyWithin');
    expect(html).toContain('mg-window-edge mg-window-edge-probable');
  });

  it('draws nothing dashed without a set-aside forecast', () => {
    const { html } = render();
    expect(html).not.toContain('mg-line-set-aside');
  });
});
