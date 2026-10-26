import {
  type DaylightTimes,
  type DisplaySystem,
  displayUnits,
  displayValue,
  disqualifyingQualifiers,
  type Freshness,
  freshness,
  type Qualifier,
  type Reading,
  type SourceId,
} from '@rowing/core';
import type { Conditions } from '../../lib/api.ts';
import {
  compassPoint,
  formatDistanceKm,
  formatNumber,
  metricName,
  unitSymbol,
} from '../../lib/format.ts';

// Turns a /conditions response into what the current conditions panel shows. Every value
// carries its source and observation time, and every gap says why it's a gap.

const RIVER_METRICS = ['waterTemp', 'flow', 'gaugeHeight'] as const;
const WEATHER_METRICS = ['airTemp', 'windSpeed', 'windGust', 'windDirection'] as const;
// Water temperature first: cold water is the most significant temperature risk.
const ROW_ORDER = [...RIVER_METRICS, ...WEATHER_METRICS];

export type RowMetric = (typeof ROW_ORDER)[number];

export interface QualifierLabel {
  qualifier: Qualifier;
  label: string;
  disqualifying: boolean; // shown, but never compared against a limit
}

export interface ConditionRow {
  metric: RowMetric;
  label: string;
  // value: a reading. noValue: the source reported none. notReported: the gauge or station
  // doesn't measure it. noGauge: weather-only location. sourceError: the source failed.
  state: 'value' | 'noValue' | 'notReported' | 'noGauge' | 'sourceError';
  value?: string;
  unit?: string;
  message?: string;
  source?: string;
  observedAt?: string;
  kind?: 'observation' | 'forecast';
  freshness?: Freshness;
  qualifiers: QualifierLabel[];
}

const LABELS: Record<RowMetric, string> = {
  waterTemp: 'Water temperature',
  flow: 'Flow',
  gaugeHeight: 'Gauge height',
  airTemp: 'Air temperature',
  windSpeed: 'Wind',
  windGust: 'Gusts',
  windDirection: 'Wind from',
};

const NO_VALUE: Record<RowMetric, string> = {
  waterTemp: 'No value reported',
  flow: 'No value reported',
  gaugeHeight: 'No value reported',
  airTemp: 'No value reported',
  windSpeed: 'No value reported',
  windGust: 'No gusts reported',
  windDirection: 'No direction reported',
};

const QUALIFIER_LABELS: Record<Qualifier, string> = {
  provisional: 'Provisional',
  estimated: 'Estimated',
  iceAffected: 'Ice affected',
  equipmentMalfunction: 'Equipment malfunction',
  unreliable: 'Flagged as possibly wrong',
};

const SOURCE_NAMES: Record<SourceId, string> = {
  usgs: 'USGS',
  nwps: 'the National Water Prediction Service',
  nws: 'the National Weather Service',
};

const isRiver = (metric: RowMetric) => (RIVER_METRICS as readonly string[]).includes(metric);

function sourceText(conditions: Conditions, reading: Reading, units: DisplaySystem): string {
  if (reading.source === 'usgs') {
    return `USGS gauge: ${conditions.gauge?.name ?? reading.sourceRef ?? 'unknown'}`;
  }
  if (conditions.currentBasis === 'station' && conditions.station) {
    const { name, distanceKm } = conditions.station;
    return `NWS station: ${name}, ${formatDistanceKm(distanceKm, units)} away`;
  }
  return 'NWS forecast for this hour';
}

function formatReading(metric: RowMetric, value: number, units: DisplaySystem) {
  if (metric === 'windDirection')
    return { value: compassPoint(value), unit: `${Math.round(value)}°` };
  const unit = displayUnits[units][metric];
  return { value: formatNumber(displayValue(metric, value, unit), unit), unit: unitSymbol(unit) };
}

export function conditionRows(
  conditions: Conditions,
  { units, now }: { units: DisplaySystem; now: string },
): ConditionRow[] {
  return ROW_ORDER.map((metric): ConditionRow => {
    const label = LABELS[metric];
    const reading = conditions.current.find((r) => r.metric === metric);
    const source: SourceId = isRiver(metric) ? 'usgs' : 'nws';

    if (!reading) {
      if (isRiver(metric) && !conditions.gauge) {
        return {
          metric,
          label,
          state: 'noGauge',
          message: 'No gauge for this location (weather only)',
          qualifiers: [],
        };
      }
      if (conditions.sources.find((s) => s.id === source)?.status === 'error') {
        return {
          metric,
          label,
          state: 'sourceError',
          message: `Couldn't load from ${SOURCE_NAMES[source]}`,
          qualifiers: [],
        };
      }
      return {
        metric,
        label,
        state: 'notReported',
        message: isRiver(metric)
          ? `This gauge doesn't report ${metricName(metric)}`
          : `Not reported for this location`,
        qualifiers: [],
      };
    }

    const kind =
      reading.source === 'nws' && conditions.currentBasis === 'forecast'
        ? 'forecast'
        : 'observation';
    const shared = {
      metric,
      label,
      source: sourceText(conditions, reading, units),
      observedAt: reading.observedAt,
      kind,
      freshness: freshness(metric, kind, reading.observedAt, now),
      qualifiers: (reading.qualifiers ?? []).map((qualifier) => ({
        qualifier,
        label: QUALIFIER_LABELS[qualifier],
        disqualifying: disqualifyingQualifiers.includes(qualifier),
      })),
    } as const;

    if (reading.value === null) return { ...shared, state: 'noValue', message: NO_VALUE[metric] };
    // NWS reports calm air as 0 m/s from 0°, which would otherwise read as "from N".
    const windSpeed = conditions.current.find((r) => r.metric === 'windSpeed')?.value;
    if (metric === 'windDirection' && windSpeed === 0) {
      return { ...shared, state: 'noValue', message: 'Calm, no direction' };
    }
    return { ...shared, state: 'value', ...formatReading(metric, reading.value, units) };
  });
}

export interface SourceNotice {
  source: SourceId;
  status: 'stale' | 'error';
  name: string;
  fetchedAt?: string;
  message?: string;
}

/** Sources that failed (no data) or were served from an old cached copy. */
export function sourceNotices(conditions: Conditions): SourceNotice[] {
  return conditions.sources.flatMap((s): SourceNotice[] =>
    s.status === 'ok'
      ? []
      : [
          {
            source: s.id,
            status: s.status,
            name: s.id === 'usgs' ? 'USGS' : SOURCE_NAMES[s.id],
            ...(s.fetchedAt ? { fetchedAt: s.fetchedAt } : {}),
            ...(s.message ? { message: s.message } : {}),
          },
        ],
  );
}

/** Today's sunrise and sunset, by the location's local date. */
export function todaysDaylight(conditions: Conditions, now: string): DaylightTimes | undefined {
  // en-CA formats dates as YYYY-MM-DD.
  const localDate = new Date(now).toLocaleDateString('en-CA', {
    timeZone: conditions.location.timezone ?? undefined,
  });
  return conditions.daylight.find((d) => d.date === localDate);
}
