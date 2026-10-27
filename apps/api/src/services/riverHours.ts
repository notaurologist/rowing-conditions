import {
  disqualifyingQualifiers,
  type ForecastPoint,
  type Metric,
  maxAgeHours,
  type Reading,
  type ValueProvenance,
} from '@rowing/core';

const HOUR = 3_600_000;

// Above this difference from the latest flow measurement, relative to the measurement, the
// flow forecast for that hour is set aside (#82). Flow moves less than 20% within an hour
// 90% of the time at Montague, and the forecast there was found about 50% low.
export const FORECAST_DISAGREEMENT = 0.25;

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

// Whether the flow forecast for the hour of the latest flow measurement is more than
// FORECAST_DISAGREEMENT away from it. Only a usable measurement from the first hour or the one
// before counts, as for the current hour (#75); an older one says nothing about the forecast now.
function forecastDisagrees(
  firstHour: number,
  forecastByTime: ReadonlyMap<number, ForecastPoint>,
  measured: Reading | undefined,
): boolean {
  if (!measured || measured.value === null) return false;
  if (measured.qualifiers?.some((q) => disqualifyingQualifiers.includes(q))) return false;
  const at = Date.parse(measured.observedAt);
  if (at < firstHour - HOUR) return false;
  const forecast = forecastByTime.get(Math.floor(at / HOUR) * HOUR)?.values.flow;
  if (forecast === undefined || forecast === null) return false;
  return Math.abs(forecast - measured.value) > FORECAST_DISAGREEMENT * measured.value;
}

// River values for each hour (ARCHITECTURE.md, "Maximum ages"):
// - Flow and gauge height come from the forecast where it has them. Hours after the last
//   forecast step are missing.
// - Otherwise the latest observation stands in for hours that start within its maximum age
//   (3 hours) of it. Later hours have no value, withheld as 'noForecast' (#117).
// - A flow forecast more than 25% from the latest measurement is set aside, and flow works as
//   if there were no forecast, withheld as 'forecastDisagrees' after the reading's 3 hours (#82).
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

  const firstHour = Date.parse(times[0] ?? '');
  if (forecastDisagrees(firstHour, forecastByTime, latest.get('flow'))) spans.delete('flow');
  const setAside = !spans.has('flow') && forecast.some((p) => p.provenance.flow !== undefined);

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
        const heldUntil =
          Date.parse(observation.observedAt) + maxAgeHours[metric].observation * HOUR;
        if (ms < heldUntil) {
          set(metric, value, provenance);
        } else {
          const withheld = metric === 'flow' && setAside ? 'forecastDisagrees' : 'noForecast';
          set(metric, null, { ...provenance, withheld });
        }
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
