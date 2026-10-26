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
  it('renders the heading', () => {
    expect(render()).toContain('Rowing Conditions</p>');
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
    storage.savePreferences({ units: 'us', selectedLocationId: 'loc-2' });
    const html = render(storage);
    expect(html).toMatch(/<option value="loc-2" selected="">Lake Wyola/);
    expect(html).not.toContain('Add a location</h2>');
  });

  it('falls back to the first location when the selected one is gone', () => {
    const storage = newStorage();
    storage.saveLocations([turnersFalls]);
    storage.savePreferences({ units: 'us', selectedLocationId: 'deleted' });
    const html = render(storage);
    expect(html).toMatch(/<option value="loc-1" selected="">Turners Falls/);
  });
});
