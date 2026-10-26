import type { SavedLocation } from '@rowing/core';
import { useState } from 'react';
import { UnitToggle } from './components/UnitToggle.tsx';
import { CurrentConditions } from './features/conditions/CurrentConditions.tsx';
import { LocationSetup } from './features/location-setup/LocationSetup.tsx';
import { RuleSetEditor } from './features/rules/RuleSetEditor.tsx';
import { useAppStorage, useStoredData } from './lib/useStoredData.ts';

export function App() {
  const storage = useAppStorage();
  const { locations, ruleSets, preferences } = useStoredData();
  const [adding, setAdding] = useState(false);
  const [editingLimits, setEditingLimits] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const selected =
    locations.find((location) => location.id === preferences.selectedLocationId) ?? locations[0];
  // One rule set per location until several can be shown side by side (#30).
  const ruleSet = selected && ruleSets.find((r) => selected.ruleSetIds.includes(r.id));

  const select = (id: string) => {
    setEditingLimits(false);
    try {
      storage.savePreferences({ ...preferences, selectedLocationId: id });
    } catch (error) {
      setProblem(`Couldn't save your choice: ${String(error)}`);
    }
  };

  const setUnits = (units: 'us' | 'metric') => {
    try {
      storage.savePreferences({ ...preferences, units });
    } catch (error) {
      setProblem(`Couldn't save the unit choice: ${String(error)}`);
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
        <p className="app-title">Rowing Conditions</p>
        <UnitToggle units={preferences.units} onChange={setUnits} />
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

            <button type="button" onClick={() => setEditingLimits(true)} disabled={editingLimits}>
              {ruleSet ? 'Edit limits' : 'Enter limits'}
            </button>
            <button type="button" onClick={() => setAdding(true)}>
              Add location
            </button>
            <button type="button" onClick={() => remove(selected)}>
              Remove
            </button>
          </section>
        )}
        {!adding && selected && editingLimits && (
          <RuleSetEditor
            key={`${selected.id}:${ruleSet?.id ?? 'new'}`}
            ruleSet={ruleSet}
            location={selected}
            units={preferences.units}
            onDone={() => setEditingLimits(false)}
          />
        )}
        {!adding && selected && !editingLimits && (
          <CurrentConditions
            key={selected.id}
            location={selected}
            units={preferences.units}
            ruleSet={ruleSet}
            onEditLimits={() => setEditingLimits(true)}
          />
        )}
      </main>
    </div>
  );
}
