import type { DisplaySystem, Metric, SavedLocation } from '@rowing/core';
import type { Conditions } from '../../lib/api.ts';
import { metricName } from '../../lib/format.ts';
import type { LocationEvaluation } from './evaluateLocation.ts';
import { Meteogram } from './Meteogram.tsx';
import { meteogramModel } from './meteogramModel.ts';

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
    </section>
  );
}
