import { createContext, useContext, useEffect, useSyncExternalStore } from 'react';
import type { AppStorage, StoredData } from './storage.ts';

export const StorageContext = createContext<AppStorage | null>(null);

export function useAppStorage(): AppStorage {
  const storage = useContext(StorageContext);
  if (!storage) throw new Error('useAppStorage needs a StorageContext provider');
  return storage;
}

/** Saved locations, rule sets and preferences. Re-renders on save, here or in another tab. */
export function useStoredData(): StoredData {
  const storage = useAppStorage();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = () => storage.invalidate();
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [storage]);

  return useSyncExternalStore(storage.subscribe, storage.snapshot, storage.snapshot);
}
