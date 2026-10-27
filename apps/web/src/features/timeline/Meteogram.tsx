import { scaleLinear } from '@visx/scale';
import { Area, LinePath } from '@visx/shape';
import { type PointerEvent, useState } from 'react';
import type {
  MeteogramLimit,
  MeteogramModel,
  MeteogramPoint,
  MeteogramRow,
  StatusStrip,
} from './meteogramModel.ts';
import { readoutSide } from './readoutPlacement.ts';

// Draws the meteogram from its model. Each row shares the time axis; percentages place
// everything horizontally, so the chart fits any width without measuring. Status is always
// in words with a symbol, and every value can be read out with the slider or the pointer.

const ROW_HEIGHT: Record<MeteogramRow['kind'], number> = {
  line: 104,
  band: 112,
  bars: 36,
  message: 32,
};
const FLOW_HEIGHT = 132;

const pct = (n: number, total: number) => `${(n / total) * 100}%`;

function rowHeight(row: MeteogramRow) {
  return row.id === 'flow' && row.kind === 'line' ? FLOW_HEIGHT : ROW_HEIGHT[row.kind];
}

// A measurement far off the forecast's scale sits just inside the row's top or bottom edge.
function observedTop(row: MeteogramRow, y: (v: number) => number) {
  if (row.observed?.offScale === 'above') return 4;
  if (row.observed?.offScale === 'below') return 96;
  return row.observed ? y(row.observed.value) : 0;
}

function Fills({
  row,
  x,
  y,
  defined,
}: {
  row: MeteogramRow;
  x: (i: number) => number;
  y: (v: number) => number;
  defined: (p: MeteogramPoint) => boolean;
}) {
  const main = row.series.find((s) => s.role === 'main');
  const gust = row.series.find((s) => s.role === 'gust');
  const pairs: { points: MeteogramPoint[]; limit: MeteogramLimit; room: boolean }[] = [];
  for (const limit of row.limits) {
    const series = limit.metric === 'windGust' ? gust : main;
    if (!series) continue;
    // The band already shows gusts against sustained wind, so wind rows only fill past the limit.
    pairs.push({ points: series.points, limit, room: row.kind !== 'band' });
  }
  return (
    <>
      {pairs.flatMap(({ points, limit, room }) => {
        const toward = (v: number) =>
          limit.comparison === 'max' ? Math.min(v, limit.value) : Math.max(v, limit.value);
        const past = (v: number) =>
          limit.comparison === 'max' ? Math.max(v, limit.value) : Math.min(v, limit.value);
        const shapes = [
          <Area<MeteogramPoint>
            key={`${limit.thresholdId}-past`}
            data={points}
            defined={defined}
            x={(_, i) => x(i)}
            y0={() => y(limit.value)}
            y1={(p) => y(past(p.value ?? limit.value))}
            className="mg-over"
          />,
        ];
        if (room) {
          shapes.unshift(
            <Area<MeteogramPoint>
              key={`${limit.thresholdId}-room`}
              data={points}
              defined={defined}
              x={(_, i) => x(i)}
              y0={() => y(limit.value)}
              y1={(p) => y(toward(p.value ?? limit.value))}
              className="mg-room"
            />,
          );
        }
        return shapes;
      })}
    </>
  );
}

function Plot({ row, n, sel }: { row: MeteogramRow; n: number; sel: number }) {
  const y = scaleLinear<number>({ domain: row.domain, range: [100, 0] });
  const x = (i: number) => ((i + 0.5) / n) * 100;
  const main = row.series.find((s) => s.role === 'main');
  const gust = row.series.find((s) => s.role === 'gust');
  const selValue = (gust ?? main)?.points[sel]?.value ?? null;
  const flip = x(sel) > 50;
  // A measured current hour is the dot; the lines start at the forecast that follows it.
  const defined = (p: MeteogramPoint) => p.value !== null && !(p.measured && row.observed);
  // Above or below the point, whichever leaves the row's limit labels readable
  // (readoutPlacement.ts); bars sit in a short row, so centre it.
  const readoutTop =
    row.kind === 'bars' ? 50 : Math.max(0, Math.min(100, y(selValue ?? row.domain[0])));
  const px = (percent: number) => (percent / 100) * rowHeight(row);
  const place =
    row.kind === 'bars'
      ? ' mg-readout-middle'
      : readoutSide({
            pointPx: px(readoutTop),
            rowPx: rowHeight(row),
            limitsPx: row.limits.map((l) => px(y(l.value))),
            arrows: (row.arrows?.length ?? 0) > 0,
            left: flip,
          }) === 'below'
        ? ' mg-readout-below'
        : '';

  return (
    <>
      <svg className="mg-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {row.kind === 'band' && main && gust && (
          <Area<MeteogramPoint>
            data={main.points}
            defined={(p, i) => defined(p) && gust.points[i]?.value !== null}
            x={(_, i) => x(i)}
            y0={(p) => y(p.value ?? 0)}
            y1={(_, i) => y(gust.points[i]?.value ?? 0)}
            className="mg-gust-band"
          />
        )}
        {row.kind === 'bars' &&
          main?.points.map((p, i) =>
            p.value ? (
              <rect
                key={p.time}
                className="mg-bar"
                x={(i / n) * 100 + 0.15}
                width={100 / n - 0.3}
                y={y(p.value)}
                height={100 - y(p.value)}
              />
            ) : null,
          )}
        <Fills row={row} x={x} y={y} defined={defined} />
        {row.kind === 'band' && gust && (
          <LinePath<MeteogramPoint>
            data={gust.points}
            defined={defined}
            x={(_, i) => x(i)}
            y={(p) => y(p.value ?? 0)}
            className="mg-line mg-line-gust"
          />
        )}
        {row.kind !== 'bars' && main && (
          <LinePath<MeteogramPoint>
            data={main.points}
            defined={defined}
            x={(_, i) => x(i)}
            y={(p) => y(p.value ?? 0)}
            className={`mg-line mg-line-${row.id}`}
          />
        )}
      </svg>
      {row.limits.map((l) => (
        <div key={l.thresholdId} className="mg-limit" style={{ top: `${y(l.value)}%` }}>
          <span className="mg-limit-label">{l.label}</span>
        </div>
      ))}
      {row.kind !== 'bars' && (
        <>
          <span className="mg-scale" style={{ top: 0 }}>
            {Math.round(row.domain[1]).toLocaleString('en-US')}
          </span>
          <span className="mg-scale mg-scale-bottom" style={{ top: '100%' }}>
            {Math.round(row.domain[0]).toLocaleString('en-US')}
          </span>
        </>
      )}
      {row.arrows?.map((a) => (
        <svg
          key={a.index}
          className="mg-arrow"
          viewBox="0 0 12 12"
          aria-hidden="true"
          style={{ left: `${x(a.index)}%`, transform: `rotate(${(a.degrees + 180) % 360}deg)` }}
        >
          <path d="M6 10.5 L6 1.8 M2.8 5 L6 1.8 L9.2 5" />
        </svg>
      ))}
      {row.observed && (
        <>
          <span
            className="mg-dot"
            style={{ left: pct(row.observed.at, n), top: `${observedTop(row, y)}%` }}
          />
          {/* Near the readout line the two labels would collide; the readout wins. */}
          {Math.abs(x(sel) - (row.observed.at / n) * 100) > 12 && (
            <span
              className="mg-dot-label"
              style={{ left: pct(row.observed.at, n), top: `${observedTop(row, y)}%` }}
            >
              {row.observed.label}
            </span>
          )}
        </>
      )}
      <span className="mg-sel" style={{ left: `${x(sel)}%` }} />
      <span
        className={`mg-readout${flip ? ' mg-readout-left' : ''}${place}`}
        style={{ left: `${x(sel)}%`, top: `${readoutTop}%` }}
      >
        {row.readouts[sel]}
      </span>
    </>
  );
}

// Symbols that only describe position against the limits: a check mark would read as approval,
// which the app never gives (#91).
const STATUS_WORDS = {
  within: { symbol: '●', long: (name: string) => `Within ${name}’s limits`, short: 'Within' },
  outside: { symbol: '○', long: () => 'Outside', short: 'Outside' },
  unknown: { symbol: '?', long: () => 'Unknown', short: 'Unknown' },
} as const;

// One rule set's status across the hours, in words and symbols as well as color. With several
// rule sets, the selected one's label says its limits are the lines drawn in the rows.
function StatusRow({
  strip,
  hours,
  several,
}: {
  strip: StatusStrip;
  hours: MeteogramModel['hours'];
  several: boolean;
}) {
  const n = hours.length;
  const summary = strip.spans
    .map(
      (s) =>
        `${STATUS_WORDS[s.status].short.toLowerCase()} ${hours[s.from]?.label} to ${hours[s.to - 1]?.label}`,
    )
    .join('; ');
  return (
    <div className={`mg-row mg-status-row`}>
      <div className="mg-label">
        <span className="mg-name">{strip.name}</span>
        <span className="mg-sub">
          {strip.sub}
          {strip.selected && several && ' · drawn below'}
        </span>
      </div>
      {strip.spans.length === 0 ? (
        <div className="mg-status-empty">No limits for this boat class yet.</div>
      ) : (
        <div className="mg-status" role="img" aria-label={`${strip.name} status: ${summary}.`}>
          {strip.spans.map((s) => {
            const words = STATUS_WORDS[s.status];
            const share = (s.to - s.from) / n;
            // Placed by its hours, like the rows below, so it lines up with them at any width.
            // The texture (outside hatched, unknown dotted) is the cue that isn't color and
            // fits any span. The symbol appears only with its word, where both fit (#91).
            return (
              <div
                key={s.from}
                className={`mg-status-${s.status}`}
                style={{ left: pct(s.from, n), width: pct(s.to - s.from, n) }}
              >
                <span className="mg-long">
                  {share > 0.12
                    ? `${words.symbol} ${words.long(strip.name)}`
                    : share > 0.06
                      ? `${words.symbol} ${words.short}`
                      : ''}
                </span>
                <span className="mg-short">
                  {share > 0.22 ? `${words.symbol} ${words.short}` : ''}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Meteogram({ model }: { model: MeteogramModel }) {
  const n = model.hours.length;
  const [sel, setSel] = useState(model.defaultHour);
  if (n === 0) return <p>No forecast values are available for this location.</p>;
  const hour = Math.min(sel, n - 1);
  const track = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    setSel(Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - box.left) / box.width) * n))));
  };

  return (
    <div className="meteogram">
      <div className="mg-chart">
        <div className="mg-row mg-axis-row">
          <div className="mg-label mg-empty" />
          <div className="mg-axis">
            {model.days.map((d) => (
              <span
                key={d.at}
                // The hour chip covers a day label it sits on; phones hide the chip, so they keep it.
                className={`mg-day${Math.abs(((hour + 0.5) / n) * 100 - (d.at / n) * 100 - 3) < 7 ? ' mg-day-near' : ''}`}
                style={{ left: pct(d.at, n) }}
              >
                {d.label}
              </span>
            ))}
            <span className="mg-sel-time" style={{ left: `${((hour + 0.5) / n) * 100}%` }}>
              {model.hours[hour]?.label}
            </span>
          </div>
        </div>

        {model.windows.length > 0 && (
          <div className="mg-row mg-windows-row">
            <div className="mg-label mg-empty" />
            <div className="mg-windows">
              {model.windows.map((w, i) => (
                <div
                  key={w.from}
                  className="mg-window"
                  style={{ left: pct(w.from, n), width: pct(w.to - w.from, n) }}
                >
                  <span
                    className={`mg-window-label${i > 0 ? ' mg-hide-sm' : ''}${w.from / n > 0.7 ? ' mg-window-label-end' : ''}`}
                  >
                    {w.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {model.statuses.map((strip) => (
          <StatusRow
            key={strip.ruleSetId}
            strip={strip}
            hours={model.hours}
            several={model.statuses.length > 1}
          />
        ))}

        {model.rows.map((row) => (
          <div key={row.id} className="mg-row mg-data-row" data-row={row.id}>
            <div className="mg-label">
              <span className="mg-name">{row.label}</span>
              {row.sub && <span className="mg-sub">{row.sub}</span>}
            </div>
            <div className="mg-plot" style={{ height: rowHeight(row) }}>
              {model.light.map((b) => (
                <span
                  key={b.from}
                  className={`mg-light mg-${b.light}`}
                  style={{ left: pct(b.from, n), width: pct(b.to - b.from, n) }}
                />
              ))}
              {model.days.slice(1).map((d) => (
                <span key={d.at} className="mg-midnight" style={{ left: pct(d.at, n) }} />
              ))}
              {model.windows.flatMap((w) => [
                <span
                  key={`${w.from}a`}
                  className="mg-window-edge"
                  style={{ left: pct(w.from, n) }}
                />,
                <span
                  key={`${w.from}b`}
                  className="mg-window-edge"
                  style={{ left: pct(w.to, n) }}
                />,
              ])}
              {row.kind === 'message' ? (
                <p className="mg-message">{row.message}</p>
              ) : (
                <Plot row={row} n={n} sel={hour} />
              )}
            </div>
          </div>
        ))}

        <div className="mg-row mg-ticks-row">
          <div className="mg-label mg-empty" />
          <div className="mg-axis">
            {model.ticks.map((t) => (
              <span key={t.at} className="mg-tick" style={{ left: pct(t.at, n) }}>
                {t.label}
              </span>
            ))}
          </div>
        </div>

        <div
          className="mg-pointer"
          onPointerMove={track}
          onPointerDown={track}
          aria-hidden="true"
        />
      </div>

      <div className="mg-row mg-scrub-row">
        <div className="mg-label mg-empty" />
        <label className="mg-scrub">
          <span>Read out</span>
          <input
            type="range"
            min={0}
            max={n - 1}
            step={1}
            value={hour}
            onChange={(e) => setSel(Number(e.target.value))}
          />
          <span className="mg-scrub-time">
            {model.hours[hour]?.label} · {model.hours[hour]?.light.toLowerCase()}
          </span>
        </label>
        {model.course && <p className="mg-course">Course: {model.course.words[hour]}</p>}
      </div>
    </div>
  );
}
