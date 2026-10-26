import type { DisplaySystem, GaugeRef, SavedLocation } from '@rowing/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, apiErrorMessage, fetchConditions } from '../../lib/api.ts';
import { formatAge } from '../../lib/format.ts';
import { flowGaugeRefs, type RuleSetChoice } from '../rules/ruleSetChoice.ts';
import { Summary } from '../summary/Summary.tsx';
import { evaluateLocation } from '../timeline/evaluateLocation.ts';
import { TimelineSection } from '../timeline/TimelineSection.tsx';
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

// Fetches /conditions once for the location, evaluates it once, and shows the summary (the
// answer and each day in words), the meteogram, then the current readings.
export function CurrentConditions({
  location,
  units,
  choices,
  onEditLimits,
}: {
  location: SavedLocation;
  units: DisplaySystem;
  choices: readonly RuleSetChoice[]; // the location's rule sets, one of them selected
  onEditLimits: () => void;
}) {
  const now = useNow();
  // The gauges rule sets name for their flow limits, when they differ from the location's.
  const flowGauges = flowGaugeRefs(choices);
  const query = useQuery({
    queryKey: ['conditions', location.lat, location.lon, location.gaugeRef ?? null, flowGauges],
    queryFn: () =>
      fetchConditions(api, {
        lat: location.lat,
        lon: location.lon,
        ...(location.gaugeRef ? { gaugeRef: location.gaugeRef as GaugeRef } : {}),
        ...(flowGauges.length ? { flowGaugeRefs: flowGauges } : {}),
      }),
  });

  if (query.isPending) return <p aria-live="polite">Loading conditions…</p>;
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
  const alongside = choices.flatMap(
    (c) => evaluateLocation(query.data, location, c.ruleSet, now, c.boatClassId) ?? [],
  );
  const selectedId = choices.find((c) => c.selected)?.ruleSet.id;
  const evaluated = alongside.find((e) => e.ruleSet.id === selectedId) ?? null;
  return (
    <>
      <Summary
        conditions={query.data}
        evaluated={evaluated}
        alongside={alongside}
        now={now}
        onEditLimits={onEditLimits}
      />
      <TimelineSection
        conditions={query.data}
        location={location}
        evaluated={evaluated}
        alongside={alongside}
        units={units}
        now={now}
      />
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
