import type { DisplaySystem, Metric, SavedLocation } from '@rowing/core';
import type { Conditions } from '../../lib/api.ts';
import { formatTime, metricName } from '../../lib/format.ts';
import type { LocationEvaluation } from './evaluateLocation.ts';
import { Meteogram } from './Meteogram.tsx';
import { type MeteogramModel, meteogramModel } from './meteogramModel.ts';

const STATUS_TEXT = {
  within: 'Within limits',
  outside: 'Outside limits',
  unknown: 'Unknown',
} as const;

function statusAt(model: MeteogramModel, i: number) {
  const span = model.status?.find((s) => i >= s.from && i < s.to);
  return span ? STATUS_TEXT[span.status] : '';
}

// Every number in the chart, as a table, for screen readers and anyone who wants the figures.
function HourTable({ model }: { model: MeteogramModel }) {
  const rows = model.rows.filter((r) => r.kind !== 'message');
  return (
    <details className="mg-table">
      <summary>Hourly values</summary>
      <div className="mg-table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Hour</th>
              {model.status && <th scope="col">Status</th>}
              {rows.map((r) => (
                <th key={r.id} scope="col">
                  {r.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.hours.map((h, i) => (
              <tr key={h.time}>
                <th scope="row">{h.label}</th>
                {model.status && <td>{statusAt(model, i)}</td>}
                {rows.map((r) => (
                  <td key={r.id}>{r.readouts[i]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

interface Props {
  conditions: Conditions;
  location: SavedLocation;
  evaluated: LocationEvaluation | null;
  units: DisplaySystem;
  now: string;
}

export function TimelineSection({ conditions, location, evaluated, units, now }: Props) {
  const model = meteogramModel({ conditions, location, units, now, evaluated });
  const timeZone = conditions.location.timezone;
  const ruleSet = evaluated?.ruleSet;
  const unavailable = (evaluated?.timeline.unavailableMetrics ?? []) as Metric[];
  const flow = conditions.forecast.find((p) => p.provenance.flow)?.provenance.flow;

  return (
    <section className="timeline" aria-labelledby="timeline-heading">
      <h2 id="timeline-heading" className="visually-hidden">
        The next 48 hours
      </h2>

      {!ruleSet && (
        <p className="hint">
          No rule set is attached to this location, so hours aren’t compared against limits.
        </p>
      )}
      {ruleSet && evaluated && !evaluated.timeline.hasLimits && (
        <p className="hint">
          {ruleSet.name} has no limits for {evaluated.boatClassName} yet, so hours aren’t compared
          against limits.
        </p>
      )}
      {ruleSet &&
        unavailable.map((m) => (
          <p key={m} className="notice">
            {ruleSet.name}’s {metricName(m)} limit can’t be checked here: no source at this location
            reports {metricName(m)}.
          </p>
        ))}

      <Meteogram key={location.id} model={model} ruleSetName={ruleSet?.name} />

      <div className="mg-notes">
        <p>
          Lines are forecasts; dots are the latest measurements. Shaded hours are twilight and
          night.
          {model.rows.some((r) => r.limits.length > 0) &&
            ' The light fill is the room left before each limit; red fill is past it.'}
        </p>
        {flow && (
          <p>
            {flow.kind === 'forecast'
              ? `Flow: National Water Prediction Service forecast, issued ${formatTime(flow.asOf, now, timeZone)}. Hours between its 6-hourly steps are interpolated.`
              : `Flow: no forecast for this gauge, so the latest observation, from ${formatTime(flow.asOf, now, timeZone)}, is shown for every hour.`}
          </p>
        )}
      </div>

      <HourTable model={model} />
    </section>
  );
}
