import { STATUS_SYMBOLS } from './AnswerCard.tsx';
import type { LocationEvaluation } from './evaluateLocation.ts';
import { dayLabel, formatClock, reasonText, statusText } from './periodCopy.ts';

// Plain-language periods from civil dawn to dusk (or the rule set's daylight window), by day.
export function PeriodList({
  evaluated,
  now,
  timeZone,
}: {
  evaluated: LocationEvaluation | null;
  now: string;
  timeZone: string | null;
}) {
  // Without limits, evaluation returns no hours, so there are no periods.
  if (!evaluated || evaluated.periods.length === 0) return null;
  const { ruleSet, periods } = evaluated;
  const days = new Map<string, typeof periods>();
  for (const period of periods) {
    const day = dayLabel(period.start, now, timeZone);
    days.set(day, [...(days.get(day) ?? []), period]);
  }
  const span = ruleSet.daylight
    ? `within ${ruleSet.name}'s daylight window`
    : 'from civil dawn to dusk';

  return (
    <section className="periods" aria-labelledby="periods-heading">
      <h2 id="periods-heading">Hour by hour</h2>
      <p className="hint">
        Periods {span}, for {evaluated.boatClassName}.
      </p>
      {[...days.entries()].map(([day, list]) => (
        <div key={day} className="period-day">
          <h3>{day}</h3>
          <ul className="period-list">
            {list.map((period) => (
              <li key={period.start} className={`period period-${period.status}`}>
                <span className="period-time">
                  {formatClock(period.start, timeZone)} – {formatClock(period.end, timeZone)}
                </span>
                <span className="period-status">
                  <span className="status-symbol" aria-hidden="true">
                    {STATUS_SYMBOLS[period.status]}
                  </span>
                  {statusText(period.status, ruleSet.name)}
                </span>
                {period.reasons.length > 0 && (
                  <ul className="reasons">
                    {period.reasons.map((r) => (
                      <li key={r.kind === 'limit' ? r.thresholdId : `${r.metric}:${r.reason}`}>
                        {reasonText(r)}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
