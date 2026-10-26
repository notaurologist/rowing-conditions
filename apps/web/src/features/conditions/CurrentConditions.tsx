import type { DisplaySystem, GaugeRef, SavedLocation } from '@rowing/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, apiErrorMessage, fetchConditions } from '../../lib/api.ts';
import { formatAge, formatTime } from '../../lib/format.ts';
import { useAppStorage } from '../../lib/useStoredData.ts';
import { flowGaugeRefs, type RuleSetChoice } from '../rules/ruleSetChoice.ts';
import { Summary } from '../summary/Summary.tsx';
import { evaluateLocation } from '../timeline/evaluateLocation.ts';
import { TimelineSection } from '../timeline/TimelineSection.tsx';
import { ConditionsPanel } from './ConditionsPanel.tsx';
import { requestKey, type Shown, shownConditions } from './lastLoaded.ts';

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
// answer and each day in words), the meteogram, then the current readings. Each load is kept
// on the device, so offline or after a failed load the last one is shown with its age.
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
  const storage = useAppStorage();
  // The gauges rule sets name for their flow limits, when they differ from the location's.
  const flowGauges = flowGaugeRefs(choices);
  const gaugeRef = location.gaugeRef as GaugeRef | undefined;
  const request = requestKey({ ...location, gaugeRef, flowGaugeRefs: flowGauges });
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

  useEffect(() => {
    if (!query.data) return;
    const loadedAt = new Date(query.dataUpdatedAt).toISOString();
    try {
      storage.saveLastConditions(location.id, { request, loadedAt, conditions: query.data });
    } catch (error) {
      // Only the offline copy is lost, and these conditions are on screen, so log it.
      console.warn(`Couldn't keep conditions for offline use: ${String(error)}`);
    }
  }, [storage, location.id, request, query.data, query.dataUpdatedAt]);

  const shown = shownConditions(
    {
      data: query.data,
      dataUpdatedAt: query.dataUpdatedAt,
      error: query.error,
      offline: query.fetchStatus === 'paused',
    },
    () => storage.loadLastConditions(location.id, request),
  );
  const retry = () => void query.refetch();

  if (shown.kind === 'loading') return <p aria-live="polite">Loading conditions…</p>;
  if (shown.kind !== 'conditions') return <LoadProblem shown={shown} onRetry={retry} />;

  const { conditions, loadedAt } = shown;
  const alongside = choices.flatMap(
    (c) => evaluateLocation(conditions, location, c.ruleSet, now, c.boatClassId) ?? [],
  );
  const selectedId = choices.find((c) => c.selected)?.ruleSet.id;
  const evaluated = alongside.find((e) => e.ruleSet.id === selectedId) ?? null;
  return (
    <>
      {shown.problem && (
        <LoadProblem
          shown={shown}
          when={`${formatAge(loadedAt, now)}, at ${formatTime(loadedAt, now, conditions.location.timezone)}`}
          onRetry={retry}
        />
      )}
      <Summary
        conditions={conditions}
        evaluated={evaluated}
        alongside={alongside}
        now={now}
        onEditLimits={onEditLimits}
      />
      <TimelineSection
        conditions={conditions}
        location={location}
        evaluated={evaluated}
        alongside={alongside}
        units={units}
        now={now}
      />
      <ConditionsPanel conditions={conditions} units={units} now={now} />
      <p className="reading-meta refresh-row">
        Loaded {formatAge(loadedAt, now)}.{' '}
        <button type="button" onClick={retry} disabled={query.isFetching}>
          {query.isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </p>
    </>
  );
}

// Error messages come from the API or the browser, with or without a full stop.
const sentence = (message: string) => (/[.!?]$/.test(message) ? message : `${message}.`);

/** Why conditions couldn't load, and when those shown, if any, were loaded. Words, not color. */
export function LoadProblem({
  shown,
  when,
  onRetry,
}: {
  shown: Exclude<Shown, { kind: 'loading' }>;
  when?: string; // "3 h ago, at 9:00 AM" when older conditions are shown
  onRetry: () => void;
}) {
  const problem = shown.kind === 'conditions' ? shown.problem : shown;
  if (!problem) return null;
  if (problem.kind === 'offline') {
    return (
      <div role="status" className="notice">
        <p>
          <strong>Offline.</strong>{' '}
          {when
            ? `Showing conditions loaded ${when}. They update when you're back online.`
            : "No conditions have been loaded for this location on this device yet. They load when you're back online."}
        </p>
      </div>
    );
  }
  return (
    <div role="alert" className="notice notice-error">
      <p>
        <strong>Couldn't load {when ? 'new ' : ''}conditions.</strong>{' '}
        {sentence(apiErrorMessage(problem.error))}
        {when && ` Showing conditions loaded ${when}.`}
      </p>
      <button type="button" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
