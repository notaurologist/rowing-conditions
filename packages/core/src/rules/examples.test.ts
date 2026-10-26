import { describe, expect, it } from 'vitest';
import { GaugeRef } from '../types/measurement.ts';
import { limitExamples, limitExampleTopics } from './examples.ts';

describe('limitExamples', () => {
  it('covers wind, water temperature, combined temperature, flow and daylight', () => {
    const topics = new Set(limitExamples.map((e) => e.topic));
    expect([...topics].sort()).toEqual(Object.keys(limitExampleTopics).sort());
  });

  it('names one gauge on one river for every flow example', () => {
    const flow = limitExamples.filter((e) => e.topic === 'flow');
    expect(flow.length).toBeGreaterThan(1);
    for (const e of flow) {
      expect(GaugeRef.safeParse(e.gauge.ref).success).toBe(true);
      expect(e.gauge.name).toMatch(/River/);
    }
  });

  it('names its club and links its source', () => {
    for (const e of limitExamples) {
      expect(e.club).not.toBe('');
      expect(e.source.url).toMatch(/^https:\/\//);
      expect(e.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('never calls an example safe, recommended, typical or a default', () => {
    const banned =
      /\b(safe|unsafe|recommend\w*|typical\w*|default|standard|suggest\w*|good to go)\b/i;
    for (const e of limitExamples) expect(e.text).not.toMatch(banned);
  });
});
