import type { ConditionsResponse, GaugeRef } from '@rowing/core';
import type { Conditions } from '../../lib/api.ts';
import type { LastConditions } from '../../lib/storage.ts';

// What the conditions view shows: the conditions just loaded, or the last ones loaded on this
// device when a load fails or the device is offline, always with when they were loaded.

export interface ConditionsRequest {
  lat: number;
  lon: number;
  gaugeRef?: GaugeRef | undefined;
  flowGaugeRefs: readonly GaugeRef[];
}

/** Identifies a request, so a kept copy is only shown for the same location and gauges. */
export function requestKey({ lat, lon, gaugeRef, flowGaugeRefs }: ConditionsRequest): string {
  return JSON.stringify([lat, lon, gaugeRef ?? null, [...flowGaugeRefs].sort()]);
}

export interface QueryState {
  data: Conditions | undefined;
  dataUpdatedAt: number; // ms since the epoch, as TanStack Query reports it
  error: unknown; // null unless the last load failed
  offline: boolean; // the load is paused until the device is back online
}

export type Shown =
  | { kind: 'loading' }
  | { kind: 'offline' } // offline, with nothing loaded yet
  | { kind: 'failed'; error: unknown } // the load failed, with nothing loaded yet
  | {
      kind: 'conditions';
      conditions: Conditions | ConditionsResponse;
      loadedAt: string;
      // Why these may be out of date: offline, or the latest load failed.
      problem: { kind: 'offline' } | { kind: 'failed'; error: unknown } | null;
    };

export function shownConditions(query: QueryState, kept: () => LastConditions | null): Shown {
  const problem = query.offline
    ? { kind: 'offline' as const }
    : query.error != null
      ? { kind: 'failed' as const, error: query.error }
      : null;

  if (query.data) {
    const loadedAt = new Date(query.dataUpdatedAt).toISOString();
    return { kind: 'conditions', conditions: query.data, loadedAt, problem };
  }
  if (!problem) return { kind: 'loading' };

  const copy = kept();
  if (copy) {
    return { kind: 'conditions', conditions: copy.conditions, loadedAt: copy.loadedAt, problem };
  }
  return problem;
}
