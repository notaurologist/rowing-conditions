import { type EvaluationStatus, nextWindow } from '@rowing/core';
import type { LocationEvaluation } from './evaluateLocation.ts';
import {
  dayLabel,
  formatClock,
  formatRange,
  mergeReasons,
  reasonText,
  statusPhrase,
  statusText,
} from './periodCopy.ts';

// The top of the main screen: the next window within the rule set's limits and what follows.
// Status is shown by a symbol and words, not color alone.

export const STATUS_SYMBOLS: Record<EvaluationStatus, string> = {
  within: '✓',
  outside: '✕',
  unknown: '?',
};

function Reasons({ reasons }: { reasons: ReturnType<typeof mergeReasons> }) {
  if (reasons.length === 0) return null;
  return (
    <ul className="reasons">
      {reasons.map((r) => (
        <li key={r.kind === 'limit' ? r.thresholdId : `${r.metric}:${r.reason}`}>
          {reasonText(r)}
        </li>
      ))}
    </ul>
  );
}

const when = (time: string, now: string, timeZone: string | null) =>
  `${dayLabel(time, now, timeZone)} ${formatClock(time, timeZone)}`;

export function AnswerCard({
  evaluated,
  now,
  timeZone,
}: {
  evaluated: LocationEvaluation | null;
  now: string;
  timeZone: string | null;
}) {
  if (!evaluated) {
    return (
      <section className="answer" aria-label="Next window">
        <p>No rule set is attached to this location, so there's no window to show yet.</p>
      </section>
    );
  }
  const { ruleSet, boatClassName, timeline, periods } = evaluated;
  if (!timeline.hasLimits) {
    return (
      <section className="answer" aria-label="Next window">
        <p>
          {ruleSet.name} has no limits for {boatClassName} yet. Enter your or your club's limits to
          see when conditions are within them.
        </p>
      </section>
    );
  }

  const next = nextWindow(periods, now);
  if (!next) {
    const reasons = mergeReasons(
      periods.filter((p) => p.status !== 'within' && Date.parse(p.end) > Date.parse(now)),
    );
    return (
      <section className="answer answer-none" aria-label="Next window">
        <p className="answer-kicker">Next 48 hours</p>
        <p className="answer-headline">
          <span className="status-symbol" aria-hidden="true">
            {STATUS_SYMBOLS.outside}
          </span>
          No hours within {ruleSet.name}'s limits between civil dawn and dusk
        </p>
        <Reasons reasons={reasons} />
      </section>
    );
  }

  const { window, before, following } = next;
  const underway = Date.parse(window.start) <= Date.parse(now);
  return (
    <section className={`answer${underway ? ' answer-now' : ''}`} aria-label="Next window">
      <p className="answer-kicker">{underway ? 'Now' : 'Next window'}</p>
      <p className="answer-headline">
        <span className="status-symbol" aria-hidden="true">
          {STATUS_SYMBOLS.within}
        </span>
        {underway
          ? `${statusText('within', ruleSet.name)} until ${when(window.end, now, timeZone)}`
          : formatRange(window.start, window.end, now, timeZone)}
      </p>
      {!underway && (
        <p className="answer-sub">
          {statusText('within', ruleSet.name)}, {boatClassName}
        </p>
      )}
      {before && (
        <div className="answer-context">
          <p>
            Now: {statusPhrase(before.status, ruleSet.name)}
            {before.reasons.length > 0 ? ':' : '.'}
          </p>
          <Reasons reasons={before.reasons} />
        </div>
      )}
      {following && (
        <div className="answer-context">
          <p>
            Then {statusPhrase(following.status, ruleSet.name)} from{' '}
            {when(following.start, now, timeZone)}
            {following.reasons.length > 0 ? ':' : '.'}
          </p>
          <Reasons reasons={following.reasons} />
        </div>
      )}
    </section>
  );
}
