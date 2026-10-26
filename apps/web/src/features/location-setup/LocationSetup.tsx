import { defaultGauge, type GaugeRef } from '@rowing/core';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, lazy, Suspense, useState } from 'react';
import { api, apiErrorMessage, type Coordinates, fetchNearbyGauges } from '../../lib/api.ts';
import { useAppStorage, useStoredData } from '../../lib/useStoredData.ts';
import { GaugeChoice, type NearbyState } from './GaugeChoice.tsx';
import { newLocation } from './newLocation.ts';
import { PlaceSearch } from './PlaceSearch.tsx';

// Leaflet touches `window` when imported, so the map loads only in the browser.
const LocationMap = lazy(() => import('./LocationMap.tsx'));

// The API's default search radius for /gauges/nearby.
const NEARBY_RADIUS_KM = 25;

interface Props {
  onSaved: (id: string) => void;
  onCancel?: () => void;
}

export function LocationSetup({ onSaved, onCancel }: Props) {
  const storage = useAppStorage();
  const { locations, preferences } = useStoredData();
  const [point, setPoint] = useState<Coordinates | null>(null);
  const [name, setName] = useState('');
  // undefined: use the suggested gauge. null: weather only.
  const [override, setOverride] = useState<GaugeRef | null | undefined>(undefined);
  const [locating, setLocating] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const nearbyQuery = useQuery({
    queryKey: ['gauges', 'nearby', point?.lat, point?.lon],
    queryFn: () => fetchNearbyGauges(api, point as Coordinates),
    enabled: point !== null,
  });

  const gauges = nearbyQuery.data ?? [];
  const suggested = (defaultGauge(gauges)?.ref ?? null) as GaugeRef | null;
  const selected = override === undefined ? suggested : override;

  const nearby: NearbyState = nearbyQuery.isError
    ? {
        status: 'error',
        message: apiErrorMessage(nearbyQuery.error),
        retry: () => void nearbyQuery.refetch(),
      }
    : nearbyQuery.isSuccess
      ? { status: 'ready', gauges, radiusKm: NEARBY_RADIUS_KM }
      : { status: 'loading' };

  const pick = (next: Coordinates) => {
    setPoint(next);
    setOverride(undefined);
    setProblem(null);
  };

  const locateMe = () => {
    if (!('geolocation' in navigator)) {
      setProblem('This browser does not share its location. Pick the spot on the map instead.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        pick({ lat: position.coords.latitude, lon: position.coords.longitude });
      },
      (error) => {
        setLocating(false);
        setProblem(`Couldn't get your location (${error.message}). Pick the spot on the map.`);
      },
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 300_000 },
    );
  };

  // Saving waits for the gauge list, so the saved gauge is the one the user saw.
  const canSave = point !== null && name.trim() !== '' && nearby.status === 'ready';

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!canSave || !point) return;
    const location = newLocation({ name, ...point, gaugeRef: selected });
    try {
      storage.saveLocations([...locations, location]);
      storage.savePreferences({ ...preferences, selectedLocationId: location.id });
    } catch (error) {
      setProblem(`Couldn't save the location: ${apiErrorMessage(error)}`);
      return;
    }
    onSaved(location.id);
  };

  return (
    <section className="location-setup" aria-labelledby="setup-heading">
      <h2 id="setup-heading">Add a location</h2>
      <p className="hint">Search for a place, tap the map where you row, or use your location.</p>

      <PlaceSearch
        onPick={(place) => {
          pick({ lat: place.lat, lon: place.lon });
          if (name.trim() === '') setName(place.name);
        }}
      />

      <div className="setup-actions">
        <button type="button" onClick={locateMe} disabled={locating}>
          {locating ? 'Finding you…' : 'Use my location'}
        </button>
      </div>

      <Suspense fallback={<div className="location-map map-loading">Loading map…</div>}>
        <LocationMap point={point} onPick={pick} />
      </Suspense>

      {point && (
        <p className="coordinates">
          Selected point: {point.lat.toFixed(4)}, {point.lon.toFixed(4)}
        </p>
      )}

      {problem && (
        <p role="alert" className="notice notice-error">
          {problem}
        </p>
      )}

      {/* Its own form, so Enter in the search box searches rather than saving. */}
      <form className="location-setup" onSubmit={save}>
        {point && (
          <>
            <GaugeChoice
              nearby={nearby}
              selected={selected}
              suggested={suggested}
              units={preferences.units}
              onSelect={setOverride}
            />

            <label className="field">
              <span>Name</span>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Home boathouse"
                required
                maxLength={80}
              />
            </label>
          </>
        )}

        <div className="setup-actions">
          <button type="submit" className="primary" disabled={!canSave}>
            Save location
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
