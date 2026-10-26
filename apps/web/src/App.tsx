import type { SavedLocation } from '@rowing/core';
import { useState } from 'react';
import { LocationSetup } from './features/location-setup/LocationSetup.tsx';
import { useAppStorage, useStoredData } from './lib/useStoredData.ts';

export function App() {
  const storage = useAppStorage();
  const { locations, preferences } = useStoredData();
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const selected =
    locations.find((location) => location.id === preferences.selectedLocationId) ?? locations[0];

  const select = (id: string) => {
    try {
      storage.savePreferences({ ...preferences, selectedLocationId: id });
    } catch (error) {
      setProblem(`Couldn't save your choice: ${String(error)}`);
    }
  };

  const remove = (location: SavedLocation) => {
    if (!window.confirm(`Remove ${location.name}?`)) return;
    try {
      storage.saveLocations(locations.filter((l) => l.id !== location.id));
    } catch (error) {
      setProblem(`Couldn't remove the location: ${String(error)}`);
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Rowing Conditions</h1>
      </header>
      <main className="page">
        {problem && (
          <p role="alert" className="notice notice-error">
            {problem}
          </p>
        )}
        {adding || !selected ? (
          <>
            {!selected && <p>No saved locations yet.</p>}
            <LocationSetup
              onSaved={() => setAdding(false)}
              {...(selected ? { onCancel: () => setAdding(false) } : {})}
            />
          </>
        ) : (
          <section aria-labelledby="location-heading" className="location-bar">
            <h2 id="location-heading" className="visually-hidden">
              Location
            </h2>
            <label className="field inline">
              <span>Location</span>
              <select value={selected.id} onChange={(event) => select(event.target.value)}>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
            <span className="gauge-summary">
              {selected.gaugeRef ? `Gauge ${selected.gaugeRef}` : 'Weather only (no gauge)'}
            </span>
            <button type="button" onClick={() => setAdding(true)}>
              Add location
            </button>
            <button type="button" onClick={() => remove(selected)}>
              Remove
            </button>
          </section>
        )}
      </main>
    </div>
  );
}
