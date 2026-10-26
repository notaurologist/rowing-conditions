import type { Place } from '@rowing/core';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, apiErrorMessage, fetchPlaces } from '../../lib/api.ts';

export type PlaceResultsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; query: string; places: Place[] };

export function PlaceResults({
  state,
  onPick,
}: {
  state: PlaceResultsState;
  onPick: (place: Place) => void;
}) {
  switch (state.status) {
    case 'idle':
      return null;
    case 'loading':
      return <p aria-live="polite">Searching…</p>;
    case 'error':
      return (
        <p role="alert" className="notice notice-error">
          <strong>Search failed.</strong> {state.message}
        </p>
      );
    case 'ready':
      return (
        <div aria-live="polite">
          {state.places.length === 0 ? (
            <p>
              No places found for “{state.query}”. Try another name, or pick the spot on the map.
            </p>
          ) : (
            <ul className="place-results">
              {state.places.map((place) => (
                <li key={`${place.lat},${place.lon}`}>
                  <button type="button" onClick={() => onPick(place)}>
                    <span className="gauge-name">{place.name}</span>
                    <span className="gauge-detail">{place.displayName}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="attribution">
            Search by Nominatim. Data ©{' '}
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
              OpenStreetMap contributors
            </a>
          </p>
        </div>
      );
  }
}

// Searches when the user submits, never as they type: Nominatim's usage policy forbids
// autocomplete. Results are cached, so searching the same name again sends no request.
export function PlaceSearch({ onPick }: { onPick: (place: Place) => void }) {
  const [text, setText] = useState('');
  const [submitted, setSubmitted] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['places', submitted],
    queryFn: () => fetchPlaces(api, submitted ?? ''),
    enabled: submitted !== null,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false, // the user can search again; automatic retries would add load on Nominatim
  });

  const search = (event: FormEvent) => {
    event.preventDefault();
    const q = text.trim().replace(/\s+/g, ' ');
    if (q.length >= 2) setSubmitted(q);
  };

  const state: PlaceResultsState =
    submitted === null
      ? { status: 'idle' }
      : query.isError
        ? { status: 'error', message: apiErrorMessage(query.error) }
        : query.isSuccess
          ? { status: 'ready', query: submitted, places: query.data }
          : { status: 'loading' };

  return (
    <div className="place-search">
      <form aria-label="Place search" onSubmit={search} className="search-row">
        <label className="visually-hidden" htmlFor="place-search">
          Search for a place
        </label>
        <input
          id="place-search"
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Town, lake or river"
          minLength={2}
          maxLength={200}
        />
        <button type="submit" disabled={text.trim().length < 2}>
          Search
        </button>
      </form>
      <PlaceResults state={state} onPick={onPick} />
    </div>
  );
}
