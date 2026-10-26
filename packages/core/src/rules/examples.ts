import type { GaugeRef } from '../types/measurement.ts';

// How some clubs word their limits, from their published policies, for the rule set editor.
// They show the shape of real rules and how much clubs differ. They are never defaults: no
// client prefills or applies them, and they are never stored in a rule set (decision 0001).
// Each was checked against its source on the date given; see DOMAIN.md, Example policies.

export type LimitExampleTopic = 'wind' | 'waterTemp' | 'combinedTemp' | 'flow' | 'daylight';

interface Example {
  club: string;
  place: string;
  text: string; // the club's rule, summarized
  source: { title: string; url: string };
  checked: string; // YYYY-MM-DD
}

// A flow limit is measured at one gauge on one river, so a flow example always names it.
export type LimitExample =
  | (Example & { topic: Exclude<LimitExampleTopic, 'flow'> })
  | (Example & { topic: 'flow'; gauge: { ref: GaugeRef; name: string } });

export const limitExampleTopics: Record<LimitExampleTopic, string> = {
  wind: 'Wind',
  waterTemp: 'Water temperature',
  combinedTemp: 'Air plus water temperature',
  flow: 'Flow',
  daylight: 'Daylight',
};

const albany = {
  club: 'Albany Rowing Center',
  place: 'Albany, NY',
  source: {
    title: 'Cold Weather Rowing Policy (2024)',
    url: 'https://www.albanyrowingcenter.org/assets/docs/cold-weather-policy2024.pdf',
  },
  checked: '2026-10-26',
};

const desMoines = {
  club: 'Des Moines Rowing Club',
  place: 'Des Moines, IA',
  source: { title: 'Safety Guidelines', url: 'https://desmoinesrowing.org/?p=116' },
  checked: '2026-10-26',
};

const pittsburgh = {
  club: 'Pittsburgh Rowing Club',
  place: 'Pittsburgh, PA',
  source: { title: 'Weather Safety', url: 'https://www.pittsburghrowingclub.com/weather-safety' },
  checked: '2026-10-26',
};

export const limitExamples: readonly LimitExample[] = [
  {
    ...desMoines,
    topic: 'wind',
    text: 'Club singles may not be rowed once wind reaches 15 mph. Scullers who are not highly experienced may not take club boats out above 10 mph.',
  },
  {
    ...pittsburgh,
    topic: 'wind',
    text: 'In its highest flow zone, no more than 8 mph of sustained wind against the current.',
  },
  {
    ...albany,
    topic: 'waterTemp',
    text: 'Water at least 39 °F to launch any boat. At 50 °F or below, only doubles, quads, fours and eights.',
  },
  {
    ...albany,
    topic: 'combinedTemp',
    text: 'Singles and pairs need water above 50 °F and air plus water of at least 90 °F.',
  },
  {
    ...desMoines,
    topic: 'combinedTemp',
    text: 'No rowing on club equipment when air plus water is below 100 °F.',
  },
  {
    ...desMoines,
    topic: 'flow',
    gauge: { ref: 'usgs:USGS-05482000', name: 'Des Moines River at 2nd Avenue at Des Moines, IA' },
    text: 'Dock closed to club boats above 13,000 cfs. From 10,000 to 12,999 cfs, experienced crews only.',
  },
  {
    ...pittsburgh,
    topic: 'flow',
    gauge: { ref: 'usgs:USGS-03086000', name: 'Ohio River at Sewickley, PA' },
    text: 'Six flow zones, from under 28,000 cfs to 50,000–60,000 cfs, set launch and coaching requirements.',
  },
  {
    ...desMoines,
    topic: 'daylight',
    text: 'Club boats from 60 minutes before sunrise to 30 minutes after sunset, with a bow light in low light.',
  },
];
