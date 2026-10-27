import type { ForecastPoint, Metric, Reading } from '@rowing/core';

const HOUR = 3_600_000;

// The current hour uses the latest measurement of each metric instead of its forecast (#75):
// what's measured now beats what was forecast for now. Later hours keep the forecast, since a
// measurement says nothing directly about them.
//
// A measurement replaces a value only when it's newer than that value's asOf, so a forecast
// issued after the reading wins, and only when it was taken in this hour or the one before, so
// an hours-old reading served from cache doesn't stand in for now. A reading with no value (a
// station reporting no gust) leaves the forecast in place, and a metric the hour doesn't have
// isn't added, so evaluation keeps treating it as having no source.
export function withLatestMeasurements(
  hour: ForecastPoint,
  readings: readonly Reading[],
): ForecastPoint {
  const latest = new Map<Metric, Reading>();
  for (const r of readings) {
    const seen = latest.get(r.metric);
    if (!seen || r.observedAt > seen.observedAt) latest.set(r.metric, r);
  }

  const values = { ...hour.values };
  const provenance = { ...hour.provenance };
  for (const [metric, reading] of latest) {
    const current = provenance[metric];
    if (reading.value === null || !current) continue;
    // A newer forecast keeps its value, but an hour with no value (withheld, #144) takes the reading.
    if (Date.parse(reading.observedAt) <= Date.parse(current.asOf) && values[metric] != null)
      continue;
    if (Date.parse(reading.observedAt) < Date.parse(hour.time) - HOUR) continue;
    values[metric] = reading.value;
    provenance[metric] = {
      kind: 'observation',
      asOf: reading.observedAt,
      source: reading.source,
      ...(reading.sourceRef ? { sourceRef: reading.sourceRef } : {}),
      ...(reading.qualifiers ? { qualifiers: reading.qualifiers } : {}),
    };
  }
  return { ...hour, values, provenance };
}
