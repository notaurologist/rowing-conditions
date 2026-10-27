import type { DisplaySystem, Metric, SavedLocation } from '@rowing/core';
import type { Conditions } from '../../lib/api.ts';
import { formatTime, metricName } from '../../lib/format.ts';
import type { LocationEvaluation } from './evaluateLocation.ts';
import { Meteogram } from './Meteogram.tsx';
import { type MeteogramModel, meteogramModel, type StatusStrip } from './meteogramModel.ts';

const STATUS_TEXT = {
  within: 'Within limits',
  outside: 'Outside limits',
  unknown: 'Unknown',
} as const;

function statusAt(strip: StatusStrip, i: number) {
  const span = strip.spans.find((s) => i >= s.from && i < s.to);
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
              <th scope="col">Light</th>
              <th scope="col">Fog (NWS)</th>
              {model.statuses.map((strip) => (
                <th key={strip.ruleSetId} scope="col">
                  {strip.name}
                </th>
              ))}
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
                <td>{h.light}</td>
                <td>{h.fog.text}</td>
                {model.statuses.map((strip) => (
                  <td key={strip.ruleSetId}>{statusAt(strip, i)}</td>
                ))}
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
  evaluated: LocationEvaluation | null; // the selected rule set: its limits are drawn
  alongside?: readonly LocationEvaluation[]; // every attached rule set, for status and notices
  units: DisplaySystem;
  now: string;
}

export function TimelineSection({ conditions, location, evaluated, alongside, units, now }: Props) {
  const all = alongside ?? (evaluated ? [evaluated] : []);
  const model = meteogramModel({ conditions, location, units, now, evaluated, alongside: all });
  const timeZone = conditions.location.timezone;
  // The first hour holds the latest measurement (#75), so a forecast anywhere in the series is
  // what says whether the gauge has one.
  const flows = (evaluated?.forecast ?? conditions.forecast).flatMap((p) =>
    p.provenance.flow ? [p.provenance.flow] : [],
  );
  const flow = flows.find((f) => f.kind === 'forecast') ?? flows[0];
  const flowAt = evaluated?.flowGauge ? `Flow at ${evaluated.flowGauge.name}` : 'Flow';

  return (
    <section className="timeline" aria-labelledby="timeline-heading">
      <h2 id="timeline-heading" className="visually-hidden">
        The next 48 hours
      </h2>

      {all.length === 0 && (
        <p className="hint">
          No rule set is attached to this location, so hours aren’t compared against limits.
        </p>
      )}
      {all
        .filter((e) => !e.timeline.hasLimits)
        .map((e) => (
          <p key={e.ruleSet.id} className="hint">
            {e.ruleSet.name} has no limits for {e.boatClassName} yet, so hours aren’t compared
            against its limits.
          </p>
        ))}
      {all.flatMap((e) =>
        (e.timeline.unavailableMetrics as Metric[]).map((m) => (
          <p key={`${e.ruleSet.id}:${m}`} className="notice">
            {e.ruleSet.name}’s {metricName(m)} limit can’t be checked here: no source at this
            location reports {metricName(m)}.
          </p>
        )),
      )}

      <Meteogram key={location.id} model={model} />

      <div className="mg-notes">
        <p>
          Lines are forecasts; dots are the latest measurements. Shaded hours are twilight and
          night.
          {model.rows.some((r) => r.limits.length > 0) &&
            ' The light fill is the room left before each limit; red fill is past it.'}
          {model.hours.some((h) => h.fog.state === 'fog') &&
            ' Fog is the National Weather Service forecast, shown as context; it never changes whether an hour is within limits.'}
          {model.statuses.some((st) => st.spans.length > 0) &&
            ' In the status strip, outside hours are striped and unknown hours dotted.'}
        </p>
        {flow && (
          <p>
            {flow.kind === 'forecast'
              ? `${flowAt}: National Water Prediction Service forecast, issued ${formatTime(flow.asOf, now, timeZone)}. Hours between its 6-hourly steps are interpolated.`
              : `${flowAt}: no forecast for this gauge, so the latest observation, from ${formatTime(flow.asOf, now, timeZone)}, is shown for every hour.`}
          </p>
        )}
      </div>

      <HourTable model={model} />
    </section>
  );
}
