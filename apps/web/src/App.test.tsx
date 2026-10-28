import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './App.tsx';
import { createStorage, type KeyValueStore } from './lib/storage.ts';
import { StorageContext } from './lib/useStoredData.ts';

function memoryStore(): KeyValueStore {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
}

const newStorage = () => createStorage(memoryStore(), { warn: () => {} });

function render(storage = newStorage()) {
  return renderToString(
    <StorageContext value={storage}>
      <QueryClientProvider client={new QueryClient()}>
        <App />
      </QueryClientProvider>
    </StorageContext>,
  );
}

const turnersFalls = {
  id: 'loc-1',
  name: 'Turners Falls',
  lat: 42.6,
  lon: -72.55,
  gaugeRef: 'usgs:USGS-01170500' as const,
  ruleSetIds: [],
};

describe('App', () => {
  it('renders the heading, with no About link', () => {
    const html = render();
    expect(html).toContain('Launch Window</p>');
    expect(html).not.toContain('About');
  });

  it('opens location setup when there are no saved locations', () => {
    const html = render();
    expect(html).toContain('No saved locations yet');
    expect(html).toContain('Add a location');
  });

  it('shows the selected saved location and its gauge', () => {
    const storage = newStorage();
    storage.saveLocations([
      turnersFalls,
      { id: 'loc-2', name: 'Lake Wyola', lat: 42.5, lon: -72.43, ruleSetIds: [] },
    ]);
    storage.savePreferences({
      units: 'us',
      selectedLocationId: 'loc-2',
    });
    const html = render(storage);
    expect(html).toMatch(/<option value="loc-2" selected="">Lake Wyola/);
    expect(html).not.toContain('Add a location</h2>');
  });

  it('falls back to the first location when the selected one is gone', () => {
    const storage = newStorage();
    storage.saveLocations([turnersFalls]);
    storage.savePreferences({
      units: 'us',
      selectedLocationId: 'deleted',
    });
    const html = render(storage);
    expect(html).toMatch(/<option value="loc-1" selected="">Turners Falls/);
  });
});

describe('App limits', () => {
  it('offers to enter limits for a location without a rule set', () => {
    const storage = newStorage();
    storage.saveLocations([turnersFalls]);
    expect(render(storage)).toContain('Enter limits</button>');
  });

  const ruleSet = (id: string, name: string) => ({
    id,
    name,
    boatClasses: [{ id: `${id}-all`, name: 'All boats' }],
    thresholds: [],
  });

  it('offers to edit the location’s rule set when it has one', () => {
    const storage = newStorage();
    storage.saveRuleSets([ruleSet('rs-a', 'Club A')]);
    storage.saveLocations([{ ...turnersFalls, ruleSetIds: ['rs-a'] }]);
    const html = render(storage);
    expect(html).toContain('Edit <!-- -->Club A</button>');
    expect(html).toContain('New rule set</button>');
    // One rule set needs no choice between rule sets.
    expect(html).not.toContain('aria-pressed="true"><span aria-hidden="true">✓ </span>Club A');
  });

  it('lets one of several attached rule sets be chosen, the stored choice pressed', () => {
    const storage = newStorage();
    storage.saveRuleSets([
      ruleSet('rs-a', 'Club A'),
      ruleSet('rs-b', 'Club B'),
      ruleSet('rs-c', 'Club C'),
    ]);
    storage.saveLocations([{ ...turnersFalls, ruleSetIds: ['rs-a', 'rs-b'] }]);
    storage.savePreferences({
      units: 'us',
      selectedRuleSetIds: { 'loc-1': 'rs-b' },
    });
    const html = render(storage);
    expect(html).toContain('aria-pressed="false">Club A</button>');
    expect(html).toContain('aria-pressed="true"><span aria-hidden="true">✓ </span>Club B</button>');
    expect(html).toContain('Edit <!-- -->Club B</button>');
    // Club C is stored but not attached here, so it can be added.
    expect(html).toMatch(/<option value="rs-c">Club C<\/option>/);
    expect(html).not.toMatch(/<option value="rs-a">Club A<\/option>/);
  });
});
