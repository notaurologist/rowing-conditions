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

function render(storage = createStorage(memoryStore(), { warn: () => {} })) {
  return renderToString(
    <StorageContext value={storage}>
      <App />
    </StorageContext>,
  );
}

describe('App', () => {
  it('renders the heading', () => {
    expect(render()).toContain('Rowing Conditions</h1>');
  });

  it('says there are no saved locations yet', () => {
    expect(render()).toContain('No saved locations yet');
  });

  it('lists saved locations from storage', () => {
    const storage = createStorage(memoryStore(), { warn: () => {} });
    storage.saveLocations([
      { id: 'loc-1', name: 'Turners Falls', lat: 42.6, lon: -72.55, ruleSetIds: [] },
    ]);
    const html = render(storage);
    expect(html).toContain('Turners Falls');
    expect(html).not.toContain('No saved locations yet');
  });
});
