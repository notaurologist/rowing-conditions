import { CHART_METRICS, Id, RuleSet, SavedLocation } from '@rowing/core';
import { z } from 'zod';

// The one module that touches localStorage. Each kind of data has its own key, so rule sets
// live apart from locations (one club's rules can be attached to several locations) and a
// corrupt value under one key never costs the others.
//
// Every value is stored as { version, data }. On read the envelope is checked, older
// versions are migrated one step at a time, and the data is validated with Zod. Anything
// that can't be read is discarded and logged; reading never throws.

export const STORAGE_VERSION = 1;

export const STORAGE_KEYS = {
  locations: 'rowing-conditions:locations',
  ruleSets: 'rowing-conditions:rule-sets',
  preferences: 'rowing-conditions:preferences',
} as const;

type StorageKey = keyof typeof STORAGE_KEYS;

export const Preferences = z.object({
  units: z.enum(['us', 'metric']),
  selectedLocationId: Id.optional(),
  pinnedChartMetric: z.enum(CHART_METRICS).optional(), // the timeline's default, when pinned
});
export type Preferences = z.infer<typeof Preferences>;

export interface StoredData {
  locations: SavedLocation[];
  ruleSets: RuleSet[];
  preferences: Preferences;
}

/** The subset of the Web Storage API this module uses. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StorageLogger {
  warn(message: string): void;
}

/** migrations[n][key] turns version n data into version n + 1. A missing key means unchanged. */
export type Migrations = Record<number, Partial<Record<StorageKey, (data: unknown) => unknown>>>;

const Envelope = z.object({ version: z.int().min(0), data: z.unknown() });

const defaults: StoredData = { locations: [], ruleSets: [], preferences: { units: 'us' } };

export function createStorage(
  store: KeyValueStore,
  logger: StorageLogger = console,
  migrations: Migrations = {},
) {
  const listeners = new Set<() => void>();
  let cached: StoredData | null = null;

  const discard = (key: StorageKey, reason: string) => {
    logger.warn(`Discarded stored ${key}: ${reason}`);
    try {
      store.removeItem(STORAGE_KEYS[key]);
    } catch {
      // Best effort: if removing fails, the next read discards it again.
    }
  };

  // Returns the current-version data for a key, or undefined when there is none to use.
  function readCurrent(key: StorageKey): unknown {
    let raw: string | null;
    try {
      raw = store.getItem(STORAGE_KEYS[key]);
    } catch (error) {
      logger.warn(`Could not read stored ${key}: ${String(error)}`);
      return undefined;
    }
    if (raw === null) return undefined;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      discard(key, 'not valid JSON');
      return undefined;
    }

    const envelope = Envelope.safeParse(parsed);
    if (!envelope.success) {
      discard(key, 'not a { version, data } envelope');
      return undefined;
    }

    let { version, data } = envelope.data;
    if (version > STORAGE_VERSION) {
      // Written by a newer app. Leave it for that app and use defaults here.
      logger.warn(`Stored ${key} is version ${version}; this app reads ${STORAGE_VERSION}`);
      return undefined;
    }
    while (version < STORAGE_VERSION) {
      const step = migrations[version];
      if (!step) {
        discard(key, `no migration from version ${version}`);
        return undefined;
      }
      data = step[key] ? step[key](data) : data;
      version += 1;
    }
    return data;
  }

  function readList<T>(key: 'locations' | 'ruleSets', schema: z.ZodType<T>): T[] {
    const data = readCurrent(key);
    if (data === undefined) return [];
    if (!Array.isArray(data)) {
      discard(key, 'not a list');
      return [];
    }
    const valid: T[] = [];
    let dropped = 0;
    for (const item of data) {
      const result = schema.safeParse(item);
      if (result.success) valid.push(result.data);
      else dropped += 1;
    }
    if (dropped > 0) logger.warn(`Dropped ${dropped} invalid stored ${key}`);
    return valid;
  }

  function loadPreferences(): Preferences {
    const data = readCurrent('preferences');
    if (data === undefined) return defaults.preferences;
    const result = Preferences.safeParse(data);
    if (!result.success) {
      discard('preferences', 'failed validation');
      return defaults.preferences;
    }
    return result.data;
  }

  // Validates before writing, so bad data never reaches storage. A failed write
  // (quota, private browsing) throws to the caller, which must show it.
  function write<T>(key: StorageKey, schema: z.ZodType<T>, data: T) {
    const valid = schema.parse(data);
    store.setItem(STORAGE_KEYS[key], JSON.stringify({ version: STORAGE_VERSION, data: valid }));
    invalidate();
  }

  function invalidate() {
    cached = null;
    for (const listener of listeners) listener();
  }

  const loadLocations = () => readList('locations', SavedLocation);
  const loadRuleSets = () => readList('ruleSets', RuleSet);

  return {
    loadLocations,
    loadRuleSets,
    loadPreferences,
    saveLocations: (locations: SavedLocation[]) =>
      write('locations', z.array(SavedLocation), locations),
    saveRuleSets: (ruleSets: RuleSet[]) => write('ruleSets', z.array(RuleSet), ruleSets),
    savePreferences: (preferences: Preferences) => write('preferences', Preferences, preferences),

    /** All stored data. The same object is returned until something changes, for useSyncExternalStore. */
    snapshot(): StoredData {
      cached ??= {
        locations: loadLocations(),
        ruleSets: loadRuleSets(),
        preferences: loadPreferences(),
      };
      return cached;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Re-read on the next snapshot, e.g. after another tab changed storage. */
    invalidate,
  };
}

export type AppStorage = ReturnType<typeof createStorage>;
