import { type RuleSet, type SavedLocation, toInternal } from '@rowing/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import montague from '../../../test/fixtures/conditions-montague.json' with { type: 'json' };
import type { Conditions } from '../../lib/api.ts';
import { AnswerCard } from './AnswerCard.tsx';
import { evaluateLocation } from './evaluateLocation.ts';
import { PeriodList } from './PeriodList.tsx';

// Montague's forecast starts 12:00Z on Oct 26 (8 AM local). Recorded flow: about 3,230 cfs
// falling to 3,090 by 3 PM and flat after; gusts peak at 12 mph.
const NOW = '2026-10-26T12:00:00.000Z';
const TZ = 'America/New_York';
const location: SavedLocation = {
  id: 'l',
  name: 'Turners Falls',
  lat: 42.6,
  lon: -72.55,
  ruleSetIds: ['rs'],
};

const flowLimit = (cfs: number): RuleSet => ({
  id: 'rs',
  name: 'Club A',
  boatClasses: [{ id: 'small', name: '1x and 2x' }],
  thresholds: [
    {
      id: 'flow',
      metric: 'flow',
      comparison: 'max',
      boundary: 'inclusive',
      value: toInternal('flow', cfs, 'cfs'),
      enteredUnit: 'cfs',
    },
  ],
});

function render(ruleSet: RuleSet | undefined, now = NOW, parts: 'answer' | 'both' = 'both') {
  const evaluated = evaluateLocation(
    structuredClone(montague) as Conditions,
    location,
    ruleSet,
    now,
  );
  const html = renderToStaticMarkup(
    <>
      <AnswerCard evaluated={evaluated} now={now} timeZone={TZ} />
      {parts === 'both' && <PeriodList evaluated={evaluated} now={now} timeZone={TZ} />}
    </>,
  );
  return html
    .replace(/<[^>]+>/g, ' ')
    .replaceAll('&#x27;', "'")
    .replace(/\s+/g, ' ');
}

describe('AnswerCard', () => {
  it('leads with the next window and what is happening before it', () => {
    const text = render(flowLimit(3100));
    expect(text).toMatch(
      /Next window ✓ Today \d+(:\d\d)? (AM|PM) – \d+:\d\d PM Within Club A's limits, 1x and 2x/,
    );
    expect(text).toMatch(
      /Now: outside Club A's limits: flow up to 3,2\d\d cfs \(limit: at most 3,100 cfs\)/,
    );
  });

  it('says the window is under way when it has started', () => {
    expect(render(flowLimit(5000))).toMatch(/Now ✓ Within Club A's limits until Today \d+:\d\d PM/);
  });

  it('says so when no hour is within the limits, with the reasons', () => {
    const text = render(flowLimit(2000), NOW, 'answer');
    expect(text).toContain("No hours within Club A's limits between civil dawn and dusk");
    expect(text).toMatch(/flow up to 3,2\d\d cfs \(limit: at most 2,000 cfs\)/);
  });

  it('explains a missing rule set and a rule set with no limits', () => {
    expect(render(undefined)).toContain(
      "No rule set is attached to this location, so there's no window to show yet.",
    );
    expect(render({ ...flowLimit(3100), thresholds: [] })).toContain(
      "Club A has no limits for 1x and 2x yet. Enter your or your club's limits to see when conditions are within them.",
    );
  });

  it('never gives a verdict', () => {
    for (const cfs of [2000, 3100, 5000]) {
      expect(render(flowLimit(cfs)).toLowerCase()).not.toMatch(
        /\bsafe\b|\bunsafe\b|go out|no go|good to go|row now/,
      );
    }
  });
});

describe('PeriodList', () => {
  it('lists periods by day from civil dawn to dusk, with reasons', () => {
    const text = render(flowLimit(3100));
    expect(text).toContain('Hour by hour');
    expect(text).toContain('Periods from civil dawn to dusk, for 1x and 2x.');
    expect(text).toMatch(/Today 8 AM – \d+ (AM|PM) ✕ Outside Club A's limits flow up to/);
    expect(text).toContain('Tomorrow');
    // Periods end at civil dusk (6:18 PM on Oct 27), never at a whole hour after dark.
    expect(text).toMatch(/– 6:1\d PM/);
  });

  it('is absent without limits', () => {
    expect(render(undefined)).not.toContain('Hour by hour');
  });
});
