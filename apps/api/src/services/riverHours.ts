import type { ForecastPoint, Metric, Reading, ValueProvenance } from '@rowing/core';

export type RiverHour = Pick<ForecastPoint, 'values' | 'provenance'>;

type ForecastedMetric = 'flow' | 'gaugeHeight';

function latestByMetric(readings: readonly Reading[]): Map<Metric, Reading> {
  const latest = new Map<Metric, Reading>();
  for (const r of readings) {
    const current = latest.get(r.metric);
    if (current === undefined || r.observedAt > current.observedAt) latest.set(r.metric, r);
  }
  return latest;
}

function fromObservation(r: Reading): { value: number | null; provenance: ValueProvenance } {
  return {
    value: r.value,
    provenance: {
      kind: 'observation',
      asOf: r.observedAt,
      source: r.source,
      ...(r.sourceRef ? { sourceRef: r.sourceRef } : {}),
      ...(r.qualifiers ? { qualifiers: r.qualifiers } : {}),
    },
  };
}

// River values for each hour (ARCHITECTURE.md, "Maximum ages"):
// - Flow and gauge height come from the forecast where it has them. Hours after the last
//   forecast step are missing; hours before the first step use the latest observation.
// - Without a forecast for a metric, its latest observation applies to every hour.
// - Water temperature is always the latest observation.
// A metric with neither is left out, so evaluation treats it as having no source.
export function riverHours(
  times: readonly string[],
  forecast: readonly ForecastPoint[],
  latestReadings: readonly Reading[],
): RiverHour[] {
  const latest = latestByMetric(latestReadings);
  const forecastByTime = new Map(forecast.map((p) => [Date.parse(p.time), p]));
  const spans = new Map<ForecastedMetric, { first: number; last: number; asOf: ValueProvenance }>();
  for (const metric of ['flow', 'gaugeHeight'] as const) {
    const covered = forecast.filter((p) => p.provenance[metric] !== undefined);
    const first = covered[0];
    const last = covered.at(-1);
    const provenance = first?.provenance[metric];
    if (first && last && provenance) {
      spans.set(metric, {
        first: Date.parse(first.time),
        last: Date.parse(last.time),
        asOf: provenance,
      });
    }
  }

  return times.map((time) => {
    const hour: RiverHour = { values: {}, provenance: {} };
    const ms = Date.parse(time);
    const set = (metric: Metric, value: number | null, provenance: ValueProvenance) => {
      hour.values[metric] = value;
      hour.provenance[metric] = provenance;
    };

    for (const metric of ['flow', 'gaugeHeight'] as const) {
      const span = spans.get(metric);
      const observation = latest.get(metric);
      if (span && ms >= span.first) {
        const point = forecastByTime.get(ms);
        const provenance = point?.provenance[metric];
        if (point && provenance && ms <= span.last) {
          set(metric, point.values[metric] ?? null, provenance);
        } else {
          // After the forecast ends, or a gap in it: missing, never the observation.
          const { interpolated: _, ...base } = span.asOf;
          set(metric, null, base);
        }
      } else if (observation) {
        const { value, provenance } = fromObservation(observation);
        set(metric, value, provenance);
      }
    }

    const water = latest.get('waterTemp');
    if (water) {
      const { value, provenance } = fromObservation(water);
      set('waterTemp', value, provenance);
    }
    return hour;
  });
}
