import { type DisplaySystem, maxAgeHours } from '@rowing/core';
import type { Conditions } from '../../lib/api.ts';
import { formatAge, formatTime } from '../../lib/format.ts';
import {
  type ConditionRow,
  conditionRows,
  sourceNotices,
  todaysDaylight,
} from './conditionRows.ts';

interface Props {
  conditions: Conditions;
  units: DisplaySystem;
  now: string;
  waterTempNeeded?: boolean; // a rule set has a water or combined temperature limit
}

function Freshness({
  row,
  now,
  timeZone,
}: {
  row: ConditionRow;
  now: string;
  timeZone: string | null;
}) {
  if (!row.observedAt) return null;
  const verb = row.kind === 'forecast' ? 'Forecast for' : 'Observed';
  const when = `${verb} ${formatTime(row.observedAt, now, timeZone)} (${formatAge(row.observedAt, now)})`;
  return <span>{when}</span>;
}

function FreshnessFlag({ row }: { row: ConditionRow }) {
  if (row.freshness === 'stale' && row.kind) {
    const limit = maxAgeHours[row.metric][row.kind];
    return (
      <p className="flag">
        <span aria-hidden="true">⚠ </span>
        Stale: older than {limit} h, so it isn't compared against limits.
      </p>
    );
  }
  if (row.freshness === 'future') {
    return (
      <p className="flag">
        <span aria-hidden="true">⚠ </span>
        Dated in the future, which points to a clock or source error. It isn't compared against
        limits.
      </p>
    );
  }
  return null;
}

// Beside the words, never instead of them.
const TREND_SYMBOLS = { rising: '↑', falling: '↓', stable: '→', unknown: '?' } as const;

function Row({ row, now, timeZone }: { row: ConditionRow; now: string; timeZone: string | null }) {
  const flagged = row.freshness !== undefined && row.freshness !== 'fresh';
  return (
    <li
      className={`reading${row.metric === 'waterTemp' ? ' reading-prominent' : ''}${flagged ? ' reading-flagged' : ''}`}
    >
      <span className="reading-label">{row.label}</span>
      {row.state === 'value' ? (
        <span className="reading-value">
          <span className="reading-number">{row.value}</span> {row.unit}
        </span>
      ) : (
        <span className="reading-missing">{row.message}</span>
      )}
      {row.trend && (
        <span className={`reading-trend reading-trend-${row.trend.direction}`}>
          <span aria-hidden="true">{TREND_SYMBOLS[row.trend.direction]} </span>
          {row.trend.text}
        </span>
      )}
      {(row.source || row.observedAt) && (
        <span className="reading-meta">
          {row.source}
          {row.source && row.observedAt && ' · '}
          <Freshness row={row} now={now} timeZone={timeZone} />
        </span>
      )}
      {row.qualifiers.length > 0 && (
        <span className="qualifiers">
          {row.qualifiers.map((q) => (
            <span key={q.qualifier} className={`tag${q.disqualifying ? ' tag-warning' : ''}`}>
              {q.label}
              {q.disqualifying && ': not compared against limits'}
            </span>
          ))}
        </span>
      )}
      <FreshnessFlag row={row} />
    </li>
  );
}

function Daylight({ conditions, now }: { conditions: Conditions; now: string }) {
  const today = todaysDaylight(conditions, now);
  const zone = conditions.location.timezone;
  if (!today) return <p>Sunrise and sunset aren't available for today.</p>;
  if (today.sun === 'alwaysUp') return <p>The sun doesn't set today.</p>;
  if (today.sun === 'alwaysDown') return <p>The sun doesn't rise today.</p>;
  const time = (t: string | null) => (t ? formatTime(t, now, zone) : 'none');
  return (
    <dl className="daylight">
      <div>
        <dt>Civil dawn</dt>
        <dd>{time(today.civilDawn)}</dd>
      </div>
      <div>
        <dt>Sunrise</dt>
        <dd>{time(today.sunrise)}</dd>
      </div>
      <div>
        <dt>Sunset</dt>
        <dd>{time(today.sunset)}</dd>
      </div>
      <div>
        <dt>Civil dusk</dt>
        <dd>{time(today.civilDusk)}</dd>
      </div>
    </dl>
  );
}

function Alerts({ conditions, now }: { conditions: Conditions; now: string }) {
  const nws = conditions.sources.find((s) => s.id === 'nws');
  if (nws?.status === 'error') return <p>Weather alerts couldn't be loaded.</p>;
  if (conditions.alerts.length === 0) return <p>No active weather alerts.</p>;
  const zone = conditions.location.timezone;
  return (
    <ul className="alerts">
      {conditions.alerts.map((alert) => (
        <li key={alert.id} className="notice">
          <strong>{alert.event}</strong> <span className="tag">Severity: {alert.severity}</span>
          {alert.headline && <p>{alert.headline}</p>}
          {alert.ends && <p className="reading-meta">Until {formatTime(alert.ends, now, zone)}</p>}
        </li>
      ))}
    </ul>
  );
}

export function ConditionsPanel({ conditions, units, now, waterTempNeeded = false }: Props) {
  const zone = conditions.location.timezone;
  const notices = sourceNotices(conditions);
  return (
    <section className="conditions" aria-labelledby="conditions-heading">
      <h2 id="conditions-heading">Current conditions</h2>
      <p className="hint">
        {conditions.location.place ? `Near ${conditions.location.place}. ` : ''}
        Times are local to the location{zone ? ` (${zone})` : ''}.
      </p>

      {notices.map((n) => (
        <p key={n.source} role="alert" className="notice notice-error">
          {n.status === 'error' ? (
            <>
              <strong>Couldn't reach {n.name}.</strong> Its values are missing below.
            </>
          ) : (
            <>
              <strong>Couldn't reach {n.name}.</strong> Showing its last data
              {n.fetchedAt ? `, fetched ${formatAge(n.fetchedAt, now)}` : ''}.
            </>
          )}
          {n.message ? ` (${n.message})` : ''}
        </p>
      ))}

      <ul className="readings">
        {conditionRows(conditions, { units, now, waterTempNeeded }).map((row) => (
          <Row key={row.metric} row={row} now={now} timeZone={zone} />
        ))}
      </ul>

      <h3>Daylight today</h3>
      <Daylight conditions={conditions} now={now} />

      <h3>Weather alerts</h3>
      <Alerts conditions={conditions} now={now} />
    </section>
  );
}
