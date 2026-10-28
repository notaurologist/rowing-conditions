import type { Conditions } from '../../lib/api.ts';
import { tidyGaugeName } from '../../lib/format.ts';
import type { LocationEvaluation } from '../timeline/evaluateLocation.ts';
import { summaryModel } from './summaryModel.ts';

// The top of the main screen: the answer as the page's heading, and how sure.
export function Summary({
  conditions,
  evaluated,
  alongside,
  now,
  onEditLimits,
}: {
  conditions: Conditions;
  evaluated: LocationEvaluation | null;
  alongside?: readonly LocationEvaluation[];
  now: string;
  onEditLimits: () => void;
}) {
  const summary = summaryModel({ conditions, evaluated, alongside, now });
  // Where the answer's flow comes from: the rule set's own gauge, else the location's.
  const place =
    evaluated?.flowGauge?.name ??
    (conditions.gauge ? tidyGaugeName(conditions.gauge.name) : 'Weather only, no gauge');
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
        {summary.caveat && <p className="summary-caveat">{summary.caveat}</p>}
        {summary.others.length > 0 && (
          <ul className="summary-others" aria-label="Other rule sets">
            {summary.others.map((text, i) => (
              // Sentences can repeat when two rule sets share a name; their order doesn't change.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above
              <li key={i}>{text}</li>
            ))}
          </ul>
        )}
        {!evaluated && (
          <p>
            <button type="button" className="primary" onClick={onEditLimits}>
              Enter your club’s limits
            </button>
          </p>
        )}
      </div>
    </section>
  );
}
