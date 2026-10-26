import {
  availableChartMetrics,
  type ChartChoice,
  type ChartMetric,
  type DisplaySystem,
  defaultChartMetric,
  type Metric,
  type SavedLocation,
} from '@rowing/core';
import { ParentSize } from '@visx/responsive';
import { useState } from 'react';
import type { Conditions } from '../../lib/api.ts';
import { formatTime, metricName } from '../../lib/format.ts';
import type { LocationEvaluation } from './evaluateLocation.ts';
import { CHART_HEIGHT, STATUS_LABELS, TimelineChart } from './TimelineChart.tsx';
import { type TimelineModel, timelineModel } from './timelineModel.ts';

export const CHIP_LABELS: Record<ChartMetric, string> = {
  flow: 'Flow',
  gaugeHeight: 'Gauge height',
  wind: 'Wind and gusts',
  waterTemp: 'Water temp',
  airTemp: 'Air temp',
  combinedTempF: 'Air + water',
  precipChance: 'Rain chance',
};

const CHART_NAMES: Record<ChartMetric, string> = {
  flow: 'flow',
  gaugeHeight: 'gauge height',
  wind: 'wind and gusts',
  waterTemp: 'water temperature',
  airTemp: 'air temperature',
  combinedTempF: 'combined air and water temperature',
  precipChance: 'rain chance',
};

/** The label saying which metric is shown and why. Neutral wording only. */
export function chartExplanation(choice: ChartChoice, ruleSetName: string | undefined): string {
  const name = CHART_NAMES[choice.metric];
  switch (choice.reason) {
    case 'pinned':
      return `Showing ${name}, your pinned chart.`;
    case 'mostHoursOutside': {
      const hours = choice.hoursOutside === 1 ? '1 hour' : `${choice.hoursOutside} hours`;
      return `Showing ${name}: it puts the most rowing hours outside ${ruleSetName}'s limits (${hours}).`;
    }
    case 'leastHeadroom':
      return `Showing ${name}: no rowing hour is outside ${ruleSetName}'s limits, and ${name} is closest to its limit.`;
    case 'fallback':
      return ruleSetName
        ? `Showing ${name}. ${ruleSetName} has no limit that decides the chart here.`
        : `Showing ${name}. Attach a rule set to chart the metric that decides things.`;
  }
}

function summarize(model: TimelineModel, title: string): string {
  const values = model.series
    .flatMap((s) => s.points.map((p) => p.value))
    .filter((v) => v !== null);
  const parts = [title];
  if (values.length > 0) {
    parts.push(`Ranges from ${Math.min(...values)} to ${Math.max(...values)} ${model.unit}.`);
  }
  const missing = model.series[0]?.points.filter((p) => p.value === null).length ?? 0;
  if (missing > 0) parts.push(`${missing} hours have no value.`);
  for (const limit of model.limits) parts.push(`${limit.label}.`);
  const counts = { within: 0, outside: 0, unknown: 0 };
  for (const h of model.hours) if (h.status) counts[h.status] += 1;
  if (model.hours.some((h) => h.status)) {
    parts.push(
      `${counts.within} hours within limits, ${counts.outside} outside, ${counts.unknown} unknown.`,
    );
  }
  return parts.join(' ');
}

function Legend({ model }: { model: TimelineModel }) {
  return (
    <ul className="tl-legend" aria-label="Chart key">
      {model.series.map((s, i) => (
        <li key={s.metric}>
          <span className={`tl-key-line tl-key-series-${i}`} aria-hidden="true" />
          {s.label}
        </li>
      ))}
      {model.limits.length > 0 && (
        <li>
          <span className="tl-key-line tl-key-limit" aria-hidden="true" />
          Limit
        </li>
      )}
      <li>
        <span className="tl-key-swatch tl-band-daylight" aria-hidden="true" />
        Daylight
      </li>
      <li>
        <span className="tl-key-swatch tl-band-twilight" aria-hidden="true" />
        Twilight
      </li>
      <li>
        <span className="tl-key-swatch tl-band-dark" aria-hidden="true" />
        Dark
      </li>
      {model.hours.some((h) => h.status) && (
        <>
          <li>
            <span className="tl-key-swatch tl-key-within" aria-hidden="true" />
            {STATUS_LABELS.within}
          </li>
          <li>
            <span className="tl-key-swatch tl-key-outside" aria-hidden="true" />
            {STATUS_LABELS.outside}
          </li>
          <li>
            <span className="tl-key-swatch tl-key-unknown" aria-hidden="true" />
            {STATUS_LABELS.unknown}
          </li>
        </>
      )}
    </ul>
  );
}

const LIGHT_WORDS = { daylight: 'Daylight', twilight: 'Twilight', dark: 'Dark' } as const;

function HourTable({
  model,
  timeZone,
  now,
}: {
  model: TimelineModel;
  timeZone: string | null;
  now: string;
}) {
  const hasStatus = model.hours.some((h) => h.status);
  return (
    <details className="tl-table">
      <summary>Hourly values</summary>
      <table>
        <thead>
          <tr>
            <th scope="col">Hour</th>
            {model.series.map((s) => (
              <th key={s.metric} scope="col">
                {s.label} ({model.unit})
              </th>
            ))}
            <th scope="col">Light</th>
            {hasStatus && <th scope="col">Status</th>}
          </tr>
        </thead>
        <tbody>
          {model.hours.map((hour, i) => (
            <tr key={hour.time}>
              <th scope="row">{formatTime(hour.time, now, timeZone)}</th>
              {model.series.map((s) => (
                <td key={s.metric}>{s.points[i]?.value ?? 'No value'}</td>
              ))}
              <td>{LIGHT_WORDS[hour.light]}</td>
              {hasStatus && <td>{hour.status ? STATUS_LABELS[hour.status] : ''}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

interface Props {
  conditions: Conditions;
  location: SavedLocation;
  evaluated: LocationEvaluation | null;
  units: DisplaySystem;
  pinned: ChartMetric | undefined;
  onPin: (metric: ChartMetric | undefined) => void;
  now: string;
  /** Fixed width for tests; the page measures its container. */
  width?: number;
}

export function TimelineSection({
  conditions,
  location,
  evaluated,
  units,
  pinned,
  onPin,
  now,
  width,
}: Props) {
  const [chosen, setChosen] = useState<ChartMetric | undefined>(undefined);
  const timeZone = conditions.location.timezone;
  const available = availableChartMetrics(conditions.forecast);
  const ruleSet = evaluated?.ruleSet;
  const choice = defaultChartMetric({ available, pinned, limiting: evaluated?.limiting ?? null });

  if (!choice) {
    return (
      <section className="timeline" aria-labelledby="timeline-heading">
        <h2 id="timeline-heading">Next 48 hours</h2>
        <p>No forecast values are available for this location.</p>
      </section>
    );
  }

  const metric = chosen && available.includes(chosen) ? chosen : choice.metric;
  const model = timelineModel({
    forecast: conditions.forecast,
    metric,
    units,
    lat: location.lat,
    lon: location.lon,
    // Without limits, evaluation returns no hours, so the chart has no status strip.
    evaluation: evaluated?.evaluation,
    daylight: conditions.daylight,
  });
  const title = `${CHIP_LABELS[metric]}, next 48 hours`;
  const unavailable = (evaluated?.timeline.unavailableMetrics ?? []) as Metric[];

  return (
    <section className="timeline" aria-labelledby="timeline-heading">
      <h2 id="timeline-heading">Next 48 hours</h2>

      <fieldset className="chips">
        <legend className="visually-hidden">Chart metric</legend>
        {available.map((m) => (
          <button key={m} type="button" aria-pressed={m === metric} onClick={() => setChosen(m)}>
            {m === metric && <span aria-hidden="true">✓ </span>}
            {CHIP_LABELS[m]}
          </button>
        ))}
      </fieldset>

      <p className="tl-explanation">
        {metric === choice.metric
          ? chartExplanation(choice, ruleSet?.name)
          : `Showing ${CHART_NAMES[metric]}, chosen above.`}{' '}
        <button
          type="button"
          className="link-button"
          aria-pressed={pinned === metric}
          onClick={() => onPin(pinned === metric ? undefined : metric)}
        >
          {pinned === metric ? 'Unpin' : 'Pin as default'}
        </button>
      </p>

      {ruleSet && evaluated ? (
        evaluated.timeline.hasLimits ? (
          <p className="hint">
            The strip under the chart shows each hour's status for {ruleSet.name},{' '}
            {evaluated.boatClassName}, across all its limits.
          </p>
        ) : (
          <p className="hint">
            {ruleSet.name} has no limits for {evaluated.boatClassName} yet, so hours aren't compared
            against limits.
          </p>
        )
      ) : (
        <p className="hint">
          No rule set is attached to this location, so hours aren't compared against limits.
        </p>
      )}

      {ruleSet &&
        unavailable.map((m) => (
          <p key={m} className="notice">
            {ruleSet.name}'s {metricName(m)} limit can't be checked here: no source at this location
            reports {metricName(m)}.
          </p>
        ))}

      <div className="tl-chart" style={{ height: CHART_HEIGHT }}>
        {width !== undefined ? (
          <TimelineChart
            model={model}
            width={width}
            timeZone={timeZone}
            title={title}
            summary={summarize(model, title)}
          />
        ) : (
          <ParentSize debounceTime={50}>
            {({ width: measured }) => (
              <TimelineChart
                model={model}
                width={measured}
                timeZone={timeZone}
                title={title}
                summary={summarize(model, title)}
              />
            )}
          </ParentSize>
        )}
      </div>

      <Legend model={model} />

      {model.flowSource && (
        <p className="hint">
          {model.flowSource.kind === 'forecast'
            ? `Flow forecast from the National Water Prediction Service, issued ${formatTime(model.flowSource.asOf, now, timeZone)}. Hours between its 6-hourly steps are interpolated.`
            : `No flow forecast for this gauge. The latest observation, from ${formatTime(model.flowSource.asOf, now, timeZone)}, is shown for every hour.`}
        </p>
      )}

      <HourTable model={model} timeZone={timeZone} now={now} />
    </section>
  );
}
