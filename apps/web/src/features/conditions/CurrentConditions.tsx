import type { DisplaySystem, GaugeRef, SavedLocation } from '@rowing/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, apiErrorMessage, fetchConditions } from '../../lib/api.ts';
import { formatAge } from '../../lib/format.ts';
import { ConditionsPanel } from './ConditionsPanel.tsx';

// Re-render each minute so ages ("25 min ago") and stale flags stay current.
function useNow(intervalMs = 60_000): string {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date().toISOString()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function CurrentConditions({
  location,
  units,
}: {
  location: SavedLocation;
  units: DisplaySystem;
}) {
  const now = useNow();
  const query = useQuery({
    queryKey: ['conditions', location.lat, location.lon, location.gaugeRef ?? null],
    queryFn: () =>
      fetchConditions(api, {
        lat: location.lat,
        lon: location.lon,
        ...(location.gaugeRef ? { gaugeRef: location.gaugeRef as GaugeRef } : {}),
      }),
  });

  if (query.isPending) return <p aria-live="polite">Loading current conditions…</p>;
  if (query.isError) {
    return (
      <div role="alert" className="notice notice-error">
        <p>
          <strong>Couldn't load conditions.</strong> {apiErrorMessage(query.error)}
        </p>
        <button type="button" onClick={() => void query.refetch()}>
          Try again
        </button>
      </div>
    );
  }

  const loadedAt = new Date(query.dataUpdatedAt).toISOString();
  return (
    <>
      <ConditionsPanel conditions={query.data} units={units} now={now} />
      <p className="reading-meta refresh-row">
        Loaded {formatAge(loadedAt, now)}.{' '}
        <button type="button" onClick={() => void query.refetch()} disabled={query.isFetching}>
          {query.isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </p>
    </>
  );
}
