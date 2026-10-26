import type { SavedLocation } from '@rowing/core';
import { useState } from 'react';
import { UnitToggle } from './components/UnitToggle.tsx';
import { CurrentConditions } from './features/conditions/CurrentConditions.tsx';
import { LocationSetup } from './features/location-setup/LocationSetup.tsx';
import { RuleSetBar } from './features/rules/RuleSetBar.tsx';
import { RuleSetEditor } from './features/rules/RuleSetEditor.tsx';
import {
  attachedRuleSets,
  chooseBoatClass,
  selectRuleSet,
} from './features/rules/ruleSetChoice.ts';
import { attachRuleSet } from './features/rules/ruleSetDraft.ts';
import type { Preferences } from './lib/storage.ts';
import { useAppStorage, useStoredData } from './lib/useStoredData.ts';

export function App() {
  const storage = useAppStorage();
  const { locations, ruleSets, preferences } = useStoredData();
  const [adding, setAdding] = useState(false);
  // The rule set being edited: an id, 'new', or null when not editing.
  const [editing, setEditing] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const selected =
    locations.find((location) => location.id === preferences.selectedLocationId) ?? locations[0];
  const choices = selected ? attachedRuleSets(selected, ruleSets, preferences) : [];

  const savePreferences = (next: Preferences) => {
    try {
      storage.savePreferences(next);
    } catch (error) {
      setProblem(`Couldn't save your choice: ${String(error)}`);
    }
  };

  const attach = (ruleSetId: string) => {
    if (!selected) return;
    try {
      storage.saveLocations(attachRuleSet(locations, selected.id, ruleSetId));
      storage.savePreferences(selectRuleSet(preferences, selected.id, ruleSetId));
    } catch (error) {
      setProblem(`Couldn't add the rule set: ${String(error)}`);
    }
  };

  const select = (id: string) => {
    setEditing(null);
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

            <button type="button" onClick={() => setAdding(true)}>
              Add location
            </button>
            <button type="button" onClick={() => remove(selected)}>
              Remove
            </button>
          </section>
        )}
        {!adding && selected && editing !== null && (
          <RuleSetEditor
            key={`${selected.id}:${editing}`}
            ruleSet={ruleSets.find((r) => r.id === editing)}
            location={selected}
            units={preferences.units}
            onDone={() => setEditing(null)}
          />
        )}
        {!adding && selected && editing === null && (
          <>
            <RuleSetBar
              choices={choices}
              ruleSets={ruleSets}
              onSelect={(id) => savePreferences(selectRuleSet(preferences, selected.id, id))}
              onBoatClass={(id, boatClassId) =>
                savePreferences(chooseBoatClass(preferences, id, boatClassId))
              }
              onAttach={attach}
              onEdit={(id) => setEditing(id ?? 'new')}
            />
            <CurrentConditions
              key={selected.id}
              location={selected}
              units={preferences.units}
              choices={choices}
              onEditLimits={() => setEditing('new')}
            />
          </>
        )}
      </main>
    </div>
  );
}
