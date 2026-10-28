import { ConditionsResponse, Id, RuleSet, SavedLocation, UtcTime } from '@rowing/core';
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
  lastConditions: 'rowing-conditions:last-conditions',
} as const;

type StorageKey = keyof typeof STORAGE_KEYS;

export const Preferences = z.object({
  units: z.enum(['us', 'metric']),
  selectedLocationId: Id.optional(),
  // The rule set the answer and chart follow, per location. Omitted: the location's first.
  selectedRuleSetIds: z.record(Id, Id).optional(),
  // The boat class chosen in each rule set, wherever it is used. Omitted: the rule set's first.
  boatClassIds: z.record(Id, Id).optional(),
});
export type Preferences = z.infer<typeof Preferences>;

// The last conditions loaded for a location, shown with their age when a new load fails or
// the device is offline. request identifies what was asked for (gauges included), so a copy
// is only used for the same request.
export const LastConditions = z.object({
  request: z.string(),
  loadedAt: UtcTime,
  conditions: ConditionsResponse,
});
export type LastConditions = z.infer<typeof LastConditions>;

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

  // Last loaded conditions per location id. Invalid entries are dropped one by one.
  function readLastConditions(): Record<string, LastConditions> {
    const data = readCurrent('lastConditions');
    if (data === undefined) return {};
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      discard('lastConditions', 'not a record');
      return {};
    }
    const valid: Record<string, LastConditions> = {};
    let dropped = 0;
    for (const [id, entry] of Object.entries(data)) {
      const result = LastConditions.safeParse(entry);
      if (result.success) valid[id] = result.data;
      else dropped += 1;
    }
    if (dropped > 0) logger.warn(`Dropped ${dropped} invalid stored lastConditions`);
    return valid;
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

    /** The last conditions loaded for this location and request, or null when there are none. */
    loadLastConditions(locationId: string, request: string): LastConditions | null {
      const entry = readLastConditions()[locationId];
      return entry?.request === request ? entry : null;
    },
    /**
     * Keeps one copy per saved location, dropping copies for removed locations. Not part of
     * the snapshot, so nothing re-renders. A failed write throws to the caller, like the others.
     */
    saveLastConditions(locationId: string, entry: LastConditions) {
      const saved = new Set(loadLocations().map((location) => location.id));
      const kept = Object.fromEntries(
        Object.entries(readLastConditions()).filter(([id]) => saved.has(id) && id !== locationId),
      );
      const data = z.record(z.string(), LastConditions).parse({ ...kept, [locationId]: entry });
      store.setItem(
        STORAGE_KEYS.lastConditions,
        JSON.stringify({ version: STORAGE_VERSION, data }),
      );
    },

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
