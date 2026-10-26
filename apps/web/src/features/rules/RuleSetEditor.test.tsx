import { type RuleSet, toInternal } from '@rowing/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createStorage, type KeyValueStore } from '../../lib/storage.ts';
import { StorageContext } from '../../lib/useStoredData.ts';
import { RuleSetEditor } from './RuleSetEditor.tsx';

function memoryStore(): KeyValueStore {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

const location = {
  id: 'loc-1',
  name: 'Turners Falls',
  lat: 42.6,
  lon: -72.55,
  gaugeRef: 'usgs:USGS-01170500' as const,
  ruleSetIds: [],
};

function render(ruleSet: RuleSet | undefined) {
  return renderToString(
    <StorageContext value={createStorage(memoryStore(), { warn: () => {} })}>
      <QueryClientProvider client={new QueryClient()}>
        <RuleSetEditor ruleSet={ruleSet} location={location} units="us" onDone={() => {}} />
      </QueryClientProvider>
    </StorageContext>,
  );
}

const clubA: RuleSet = {
  id: 'rs-a',
  name: 'Club A',
  boatClasses: [
    { id: 'small', name: '1x and 2x' },
    { id: 'big', name: 'Eights' },
  ],
  thresholds: [
    {
      id: 'flow',
      metric: 'flow',
      comparison: 'max',
      boundary: 'exclusive',
      value: toInternal('flow', 3.1, 'kcfs'),
      enteredUnit: 'kcfs',
    },
    {
      id: 'water',
      metric: 'waterTemp',
      comparison: 'min',
      boundary: 'inclusive',
      value: toInternal('waterTemp', 39, 'degF'),
      enteredUnit: 'degF',
      boatClassIds: ['small'],
    },
  ],
};

describe('RuleSetEditor', () => {
  it('starts a new rule set with no limits and asks for the user’s or club’s own', () => {
    const html = render(undefined);
    expect(html).toContain('New rule set');
    expect(html).toContain('No limits yet. Add each limit from your club’s rules, or your own');
    expect(html).toContain('The app has no limits of its own');
    expect(html).not.toContain('class="limit-row"');
    expect(html).toContain('value="All boats"');
    expect(html).not.toContain('Delete rule set');
  });

  it('describes the daylight window as only for clubs with a hard rule, and leaves it off', () => {
    const html = render(undefined);
    expect(html).toContain('Only if your club forbids rowing outside these hours');
    expect(html).not.toMatch(/type="checkbox" checked=""/);
    expect(html).not.toContain('Minutes before sunrise');
  });

  it('shows each limit in words, with the number and unit it was entered in', () => {
    const html = render(clubA);
    expect(html).toContain('Edit Club A');
    expect(html).toMatch(/<option value="below" selected="">below<\/option>/);
    expect(html).toMatch(/<option value="atLeast" selected="">at least<\/option>/);
    expect(html).toContain('value="3.1"');
    expect(html).toMatch(/<option value="kcfs" selected="">kcfs<\/option>/);
    expect(html).toContain('value="39"');
    expect(html).toMatch(/<option value="degF" selected="">°F<\/option>/);
    expect(html).toContain('Delete rule set');
  });

  it('offers the flow gauge only when there is a flow limit', () => {
    expect(render(clubA)).toContain('Gauge for the flow limit');
    expect(render({ ...clubA, thresholds: clubA.thresholds.slice(1) })).not.toContain(
      'Gauge for the flow limit',
    );
  });

  it('lets a limit be scoped to boat classes when there is more than one', () => {
    const html = render(clubA);
    expect(html).toContain('Applies to (none ticked: every boat class)');
    expect(
      render({ ...clubA, boatClasses: [{ id: 'small', name: 'All boats' }], thresholds: [] }),
    ).not.toContain('Applies to');
  });

  it('shows how some clubs word their limits, collapsed, cited, and with nothing to apply', () => {
    const html = render(undefined);
    const examples = /<details class="limit-examples">([\s\S]*?)<\/details>/.exec(html)?.[1] ?? '';
    expect(examples).toContain('<summary>How some clubs word their limits</summary>');
    expect(examples).toContain('Des Moines Rowing Club');
    expect(examples).toContain('href="https://desmoinesrowing.org/?p=116"');
    expect(examples).toContain(
      'Measured at Ohio River at Sewickley, PA (USGS 03086000), so it applies to that gauge on that river only.',
    );
    expect(examples).not.toMatch(/<(button|input|select)\b/);
    expect(examples).not.toMatch(/\b(safe|recommended|typical|suggested)\b/i);
    // Nothing is prefilled: a new rule set still starts empty.
    expect(html).toContain('No limits yet.');
  });
});
