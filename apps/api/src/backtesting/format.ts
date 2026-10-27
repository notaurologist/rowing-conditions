// A replay as plain text, for reading next to a crew's notes about the day. Status is spelled
// out in words, never shown by color alone, and never as a verdict on rowing.

import {
  type DisplaySystem,
  displayUnits,
  displayValue,
  type Failure,
  type HourResult,
  type Metric,
  type Unit,
  type UnknownReason,
  unitDecimals,
} from '@rowing/core';
import type { WeatherValues } from '../adapters/historical/parse.ts';
import type { Replay } from './replay.ts';

const unitSymbols: Record<Unit, string> = {
  'm3/s': 'm³/s',
  cfs: 'cfs',
  kcfs: 'kcfs',
  m: 'm',
  ft: 'ft',
  degC: '°C',
  degF: '°F',
  'm/s': 'm/s',
  'km/h': 'km/h',
  mph: 'mph',
  percent: '%',
};

const metricLabels: Record<Metric, string> = {
  flow: 'flow',
  gaugeHeight: 'gauge height',
  waterTemp: 'water temp',
  airTemp: 'air temp',
  windSpeed: 'wind',
  windGust: 'gust',
  windDirection: 'wind direction',
  precipChance: 'rain chance',
  combinedTempF: 'air + water',
};

const reasonLabels: Record<UnknownReason, string> = {
  missing: 'missing',
  stale: 'too old',
  qualified: 'qualified by the source',
  noSource: 'no source',
};

function formatValue(
  metric: Exclude<Metric, 'windDirection'>,
  value: number | null | undefined,
  units: DisplaySystem,
): string {
  if (value === null || value === undefined) return '–';
  const unit = displayUnits[units][metric];
  return `${displayValue(metric, value, unit).toFixed(unitDecimals[unit])} ${unitSymbols[unit]}`;
}

function formatTime(iso: string, timeZone: string, withDate: boolean): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    ...(withDate ? { month: 'short', day: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...(withDate ? { timeZoneName: 'short' } : {}),
  }).format(new Date(iso));
}

function describeFailure(failure: Failure, replay: Replay): string {
  if (failure.kind === 'daylight') return 'outside the daylight window';
  const threshold = replay.ruleSet.thresholds.find((t) => t.id === failure.thresholdId);
  const bound = threshold?.comparison === 'min' ? 'min' : 'max';
  const unit = unitSymbols[failure.unit];
  return `${metricLabels[failure.metric]} ${failure.value} ${unit} (${bound} ${failure.limit} ${unit})`;
}

function describeHour(hour: HourResult, replay: Replay): string {
  return [
    ...hour.failures.map((f) => describeFailure(f, replay)),
    ...hour.unknowns.map((u) => `${metricLabels[u.metric]} unknown: ${reasonLabels[u.reason]}`),
  ].join('; ');
}

function table(rows: string[][]): string {
  const widths = rows[0]?.map((_, col) => Math.max(...rows.map((r) => (r[col] ?? '').length)));
  return rows
    .map((row) =>
      row
        .map((cell, col) => (col === row.length - 1 ? cell : cell.padEnd(widths?.[col] ?? 0)))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

export interface FormatOptions {
  caseName: string;
  timeZone: string;
  units: DisplaySystem;
}

export function formatReplay(replay: Replay, options: FormatOptions): string {
  const { timeZone, units } = options;
  const { conditions, timeline, ruleSet } = replay;
  const boatClass = ruleSet.boatClasses.find((c) => c.id === replay.boatClassId);
  const lines: string[] = [];

  lines.push(
    `Replay of ${options.caseName} at ${formatTime(replay.at, timeZone, true)} (${replay.at})`,
  );
  lines.push(`Rule set: ${ruleSet.name}, boat class ${boatClass?.name ?? replay.boatClassId}`);
  if (conditions.gauge) lines.push(`Gauge: ${conditions.gauge.name}`);
  if (ruleSet.flowGaugeRef) lines.push(`Flow limits measured at: ${ruleSet.flowGaugeRef}`);
  lines.push(
    conditions.currentBasis === 'station' && conditions.station
      ? `Current weather: station ${conditions.station.id}, ${conditions.station.distanceKm.toFixed(1)} km away`
      : 'Current weather: the forecast, since no station report was within 30 km and 2 hours',
  );
  lines.push('');
  lines.push('Notes:');
  lines.push(
    '- Weather forecast: NBM via Open-Meteo, made a day ahead for the first 24 hours and two days ahead after that (Lead column). Not the NWS forecast as issued.',
  );
  lines.push(
    '- Flow forecast: none, since NWPS keeps no past forecasts. Later hours repeat the last measured flow, as the app does for a gauge without a forecast.',
  );
  lines.push('- Alerts: not recorded.');
  for (const warning of replay.warnings) lines.push(`- Warning: ${warning}`);
  lines.push('');

  if (!timeline.hasLimits) {
    lines.push(`${ruleSet.name} has no limits for this boat class, so nothing was compared.`);
    return `${lines.join('\n')}\n`;
  }

  const observedLabel = (values: WeatherValues, basis: string | undefined) =>
    basis === undefined
      ? ['–', '–', '–']
      : [
          formatValue('airTemp', values.airTemp, units),
          formatValue('windSpeed', values.windSpeed, units),
          formatValue('windGust', values.windGust, units),
        ];

  const rows: string[][] = [
    [
      'Time',
      `${ruleSet.name}'s limits`,
      'Light',
      'Air',
      'Wind',
      'Gust',
      'Rain',
      'Water',
      'Flow',
      'Lead',
      'Observed air',
      'Observed wind',
      'Observed gust',
      'Outside or unknown',
    ],
  ];
  replay.forecast.forEach((point, i) => {
    const hour = timeline.hours[i];
    const observed = replay.observed[i];
    const lead = replay.forecastLeads[i];
    const v = point.values;
    rows.push([
      formatTime(point.time, timeZone, false),
      hour?.status ?? '–',
      hour?.light ?? '–',
      formatValue('airTemp', v.airTemp, units),
      formatValue('windSpeed', v.windSpeed, units),
      formatValue('windGust', v.windGust, units),
      formatValue('precipChance', v.precipChance, units),
      formatValue('waterTemp', v.waterTemp, units),
      formatValue('flow', v.flow, units),
      lead === null || lead === undefined ? '–' : `${lead} day`,
      ...observedLabel(observed?.values ?? {}, observed?.basis),
      hour ? describeHour(hour, replay) : '',
    ]);
  });
  lines.push(table(rows));
  const basis = replay.observed.find((o) => o.basis)?.basis;
  lines.push('');
  lines.push(
    basis === 'modeled'
      ? 'Observed columns: Open-Meteo modeled history, not measured.'
      : 'Observed columns: the station report filed in each hour.',
  );
  return `${lines.join('\n')}\n`;
}
