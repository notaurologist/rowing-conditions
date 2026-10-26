import type { RuleSet, SavedLocation } from '@rowing/core';
import { describe, expect, it, vi } from 'vitest';
import { createStorage, type KeyValueStore, STORAGE_KEYS, STORAGE_VERSION } from './storage.ts';

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & {
  items: Map<string, string>;
} {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
}

const silentLogger = () => ({ warn: vi.fn() });

const location: SavedLocation = {
  id: 'loc-1',
  name: 'Turners Falls',
  lat: 42.6,
  lon: -72.55,
  gaugeRef: 'usgs:USGS-01170500',
  ruleSetIds: ['rs-club-a'],
};

const ruleSet: RuleSet = {
  id: 'rs-club-a',
  name: 'Club A rules',
  boatClasses: [{ id: 'bc-1', name: 'All boats' }],
  thresholds: [],
};

const envelope = (data: unknown, version = STORAGE_VERSION) => JSON.stringify({ version, data });

describe('createStorage', () => {
  it('returns defaults when nothing is stored', () => {
    const storage = createStorage(memoryStore(), silentLogger());
    expect(storage.loadLocations()).toEqual([]);
    expect(storage.loadRuleSets()).toEqual([]);
    expect(storage.loadPreferences()).toEqual({ units: 'us' });
  });

  it('round-trips locations, rule sets and preferences', () => {
    const storage = createStorage(memoryStore(), silentLogger());
    storage.saveLocations([location]);
    storage.saveRuleSets([ruleSet]);
    storage.savePreferences({ units: 'metric', selectedLocationId: 'loc-1' });

    expect(storage.loadLocations()).toEqual([location]);
    expect(storage.loadRuleSets()).toEqual([ruleSet]);
    expect(storage.loadPreferences()).toEqual({ units: 'metric', selectedLocationId: 'loc-1' });
  });

  it('stores rule sets under their own key, apart from locations', () => {
    const store = memoryStore();
    const storage = createStorage(store, silentLogger());
    storage.saveRuleSets([ruleSet]);
    storage.saveLocations([location]);

    expect(JSON.parse(store.items.get(STORAGE_KEYS.ruleSets) ?? '')).toEqual({
      version: STORAGE_VERSION,
      data: [ruleSet],
    });
    expect(JSON.parse(store.items.get(STORAGE_KEYS.locations) ?? '')).toEqual({
      version: STORAGE_VERSION,
      data: [location],
    });
  });

  it('keeps rule sets when locations are corrupt, and the reverse', () => {
    const logger = silentLogger();
    const storage = createStorage(
      memoryStore({
        [STORAGE_KEYS.locations]: '{not json',
        [STORAGE_KEYS.ruleSets]: envelope([ruleSet]),
      }),
      logger,
    );
    expect(storage.loadLocations()).toEqual([]);
    expect(storage.loadRuleSets()).toEqual([ruleSet]);
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it.each([
    ['text that is not JSON', '{not json'],
    ['JSON without an envelope', JSON.stringify([location])],
    ['an envelope with a non-integer version', JSON.stringify({ version: 'one', data: [] })],
    ['an envelope whose data is not a list', envelope({ id: 'loc-1' })],
    ['an older version with no migration', envelope([location], 0)],
  ])('discards %s, removes it, and does not throw', (_, raw) => {
    const store = memoryStore({ [STORAGE_KEYS.locations]: raw });
    const logger = silentLogger();
    const storage = createStorage(store, logger);

    expect(storage.loadLocations()).toEqual([]);
    expect(store.items.has(STORAGE_KEYS.locations)).toBe(false);
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('drops only the invalid items in a list', () => {
    const logger = silentLogger();
    const bad = { ...location, id: 'loc-2', lat: 123 };
    const storage = createStorage(
      memoryStore({ [STORAGE_KEYS.locations]: envelope([location, bad]) }),
      logger,
    );
    expect(storage.loadLocations()).toEqual([location]);
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('drops an invalid rule set without losing the valid ones', () => {
    const broken = { ...ruleSet, id: 'rs-2', boatClasses: [] };
    const storage = createStorage(
      memoryStore({ [STORAGE_KEYS.ruleSets]: envelope([broken, ruleSet]) }),
      silentLogger(),
    );
    expect(storage.loadRuleSets()).toEqual([ruleSet]);
  });

  it('falls back to default preferences when they are invalid', () => {
    const store = memoryStore({ [STORAGE_KEYS.preferences]: envelope({ units: 'imperial' }) });
    const storage = createStorage(store, silentLogger());
    expect(storage.loadPreferences()).toEqual({ units: 'us' });
    expect(store.items.has(STORAGE_KEYS.preferences)).toBe(false);
  });

  it('leaves data from a newer version in place and reads defaults', () => {
    const raw = envelope([location], STORAGE_VERSION + 1);
    const store = memoryStore({ [STORAGE_KEYS.locations]: raw });
    const logger = silentLogger();
    const storage = createStorage(store, logger);

    expect(storage.loadLocations()).toEqual([]);
    expect(store.items.get(STORAGE_KEYS.locations)).toBe(raw);
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('migrates older versions step by step', () => {
    // Version 0 stored a bare list of locations named `title`.
    const store = memoryStore({
      [STORAGE_KEYS.locations]: envelope([{ ...location, name: undefined, title: 'Old' }], 0),
    });
    const storage = createStorage(store, silentLogger(), {
      0: {
        locations: (data) =>
          (data as Record<string, unknown>[]).map(({ title, ...rest }) => ({
            ...rest,
            name: title,
          })),
      },
    });
    expect(storage.loadLocations()).toEqual([{ ...location, name: 'Old' }]);
  });

  it('returns defaults when the store itself throws on read', () => {
    const logger = silentLogger();
    const store = memoryStore();
    store.getItem = () => {
      throw new Error('SecurityError');
    };
    const storage = createStorage(store, logger);
    expect(storage.loadLocations()).toEqual([]);
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('refuses to save data that fails its schema', () => {
    const store = memoryStore();
    const storage = createStorage(store, silentLogger());
    expect(() => storage.saveLocations([{ ...location, lat: 123 }])).toThrow();
    expect(store.items.size).toBe(0);
  });

  it('lets a failed write throw, so the caller can show it', () => {
    const store = memoryStore();
    store.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    const storage = createStorage(store, silentLogger());
    expect(() => storage.saveLocations([location])).toThrow('QuotaExceededError');
  });

  it('notifies subscribers after a save, until they unsubscribe', () => {
    const storage = createStorage(memoryStore(), silentLogger());
    const listener = vi.fn();
    const unsubscribe = storage.subscribe(listener);
    storage.saveLocations([location]);
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    storage.savePreferences({ units: 'metric' });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('returns the same snapshot until something is saved', () => {
    const storage = createStorage(memoryStore(), silentLogger());
    const first = storage.snapshot();
    expect(storage.snapshot()).toBe(first);
    storage.saveLocations([location]);
    const second = storage.snapshot();
    expect(second).not.toBe(first);
    expect(second.locations).toEqual([location]);
  });
});
