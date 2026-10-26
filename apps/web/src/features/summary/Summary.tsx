import type { Conditions } from '../../lib/api.ts';
import type { LocationEvaluation } from '../timeline/evaluateLocation.ts';
import { summaryModel, tidyGaugeName } from './summaryModel.ts';

// The top of the main screen: the answer as the page's heading, why and how sure, and each day
// from dawn to dusk. Beside each other on wide screens, stacked on phones.
export function Summary({
  conditions,
  evaluated,
  now,
  onEditLimits,
}: {
  conditions: Conditions;
  evaluated: LocationEvaluation | null;
  now: string;
  onEditLimits: () => void;
}) {
  const summary = summaryModel({ conditions, evaluated, now });
  const place = conditions.gauge ? tidyGaugeName(conditions.gauge.name) : 'Weather only, no gauge';
  const rules = evaluated ? `${evaluated.ruleSet.name}, ${evaluated.boatClassName}` : null;

  return (
    <section className="summary" aria-labelledby="summary-heading">
      <div className="summary-answer">
        <p className="summary-context">
          {place}
          {rules && ` · ${rules}`}
        </p>
        <h1 id="summary-heading">{summary.headline}</h1>
        {summary.detail.length > 0 && <p className="summary-detail">{summary.detail.join(' ')}</p>}
        {!evaluated && (
          <p>
            <button type="button" className="primary" onClick={onEditLimits}>
              Enter your club’s limits
            </button>
          </p>
        )}
      </div>
      {summary.days.length > 0 && (
        <div className="summary-days">
          <h2 className="summary-kicker">Dawn to dusk</h2>
          {summary.days.map((d) => (
            <p key={d.name}>
              <strong>{d.name}.</strong> {d.text}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
