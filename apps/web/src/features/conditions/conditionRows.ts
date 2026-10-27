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
  type Trend,
  type TrendMetric,
  unitDecimals,
} from '@rowing/core';
import type { Conditions } from '../../lib/api.ts';
import {
  compassPoint,
  formatDistanceKm,
  formatNumber,
  formatTime,
  metricName,
  unitSymbol,
} from '../../lib/format.ts';

// Turns a /conditions response into what the current conditions panel shows. Every value
// carries its source and observation time, and every gap says why it's a gap.

// Metrics a gauge supplies, on a river or a lake. Weather metrics come from NWS.
const GAUGE_METRICS = ['waterTemp', 'flow', 'gaugeHeight'] as const;
const WEATHER_METRICS = ['airTemp', 'windSpeed', 'windGust', 'windDirection'] as const;
// Water temperature first: cold water is the most significant temperature risk.
const ROW_ORDER = [...GAUGE_METRICS, ...WEATHER_METRICS];

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
  trend?: TrendLabel; // flow and gauge height, when there's a value
}

export interface TrendLabel {
  direction: Trend['direction'];
  text: string;
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

const isGaugeMetric = (metric: RowMetric) => (GAUGE_METRICS as readonly string[]).includes(metric);

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

const UNKNOWN_TREND: Record<Extract<Trend, { direction: 'unknown' }>['reason'], string> = {
  noReadings: 'no recent readings',
  shortHistory: 'less than 2 hours of recent readings',
  historyError: "couldn't load recent readings",
};

// "Rising 120 cfs per hour since 9:15 AM". Unknown is said as unknown, with why, and is never
// shown as stable (#73).
function trendLabel(
  conditions: Conditions,
  metric: TrendMetric,
  freshness: Freshness,
  { units, now }: { units: DisplaySystem; now: string },
): TrendLabel {
  const trend = conditions.trends.find((t) => t.metric === metric);
  const unknown = (why: string): TrendLabel => ({
    direction: 'unknown',
    text: `Trend unknown: ${why}`,
  });
  if (freshness === 'stale') return unknown('the latest reading is stale');
  if (freshness === 'future') return unknown('the latest reading is dated in the future');
  if (!trend) return unknown(UNKNOWN_TREND.noReadings);
  if (trend.direction === 'unknown') return unknown(UNKNOWN_TREND[trend.reason]);

  const unit = displayUnits[units][metric];
  const size = displayValue(metric, Math.abs(trend.ratePerHour), unit);
  const perHour = (amount: number) => `${formatNumber(amount, unit)} ${unitSymbol(unit)} per hour`;
  // A rate too small to show at display precision still isn't zero.
  const tiny = size === 0 && trend.ratePerHour !== 0;
  const rate = tiny ? `less than ${perHour(10 ** -unitDecimals[unit])}` : perHour(size);
  const since = `since ${formatTime(trend.from, now, conditions.location.timezone)}`;
  if (trend.direction === 'stable') {
    const sign = tiny || size === 0 ? '' : trend.ratePerHour > 0 ? '+' : '−';
    return { direction: 'stable', text: `Stable ${since} (${sign}${rate})` };
  }
  const verb = trend.direction === 'rising' ? 'Rising' : 'Falling';
  return { direction: trend.direction, text: `${verb} ${rate} ${since}` };
}

export function conditionRows(
  conditions: Conditions,
  { units, now }: { units: DisplaySystem; now: string },
): ConditionRow[] {
  return ROW_ORDER.map((metric): ConditionRow => {
    const label = LABELS[metric];
    const reading = conditions.current.find((r) => r.metric === metric);
    // Assumes USGS is the only gauge source. A second one (UK EA, tide stations) should take
    // the source from the location's gauge ref instead.
    const source: SourceId = isGaugeMetric(metric) ? 'usgs' : 'nws';

    if (!reading) {
      if (isGaugeMetric(metric) && !conditions.gauge) {
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
        message: isGaugeMetric(metric)
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
    const value = {
      ...shared,
      state: 'value',
      ...formatReading(metric, reading.value, units),
    } as const;
    return metric === 'flow' || metric === 'gaugeHeight'
      ? { ...value, trend: trendLabel(conditions, metric, shared.freshness, { units, now }) }
      : value;
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
