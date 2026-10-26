import { AxisBottom, AxisLeft } from '@visx/axis';
import { Group } from '@visx/group';
import { scaleLinear, scaleTime } from '@visx/scale';
import { LinePath } from '@visx/shape';
import { useId } from 'react';
import type { SeriesPoint, TimelineModel } from './timelineModel.ts';

// The 48-hour chart. It draws only from the model, so it renders the same from fixtures as
// from live data. Light levels and statuses are shown with patterns and words, not color alone.

const HOUR = 3_600_000;
const MARGIN = { top: 22, right: 12, bottom: 44, left: 48 };
const PLOT_HEIGHT = 200;
const STRIP_HEIGHT = 14;
const STRIP_GAP = 6;
export const CHART_HEIGHT = MARGIN.top + PLOT_HEIGHT + STRIP_GAP + STRIP_HEIGHT + MARGIN.bottom;

const LIGHT_LABELS = { daylight: 'Daylight', twilight: 'Twilight', dark: 'Dark' } as const;
export const STATUS_LABELS = {
  within: 'Within limits',
  outside: 'Outside limits',
  unknown: 'Unknown',
} as const;

function localHour(time: Date, timeZone: string | null): number {
  return Number(
    time.toLocaleString('en-US', {
      timeZone: timeZone ?? undefined,
      hour: 'numeric',
      hourCycle: 'h23',
    }),
  );
}

function tickLabel(time: Date, timeZone: string | null): string {
  const zone = timeZone ?? undefined;
  if (localHour(time, timeZone) === 0) {
    return time.toLocaleDateString('en-US', { timeZone: zone, weekday: 'short' });
  }
  return time.toLocaleTimeString('en-US', { timeZone: zone, hour: 'numeric' });
}

// A dot for a value with no neighbor on either side, which a line alone wouldn't show.
function isolated(points: SeriesPoint[], i: number): boolean {
  return (
    points[i]?.value !== null &&
    (points[i - 1]?.value ?? null) === null &&
    (points[i + 1]?.value ?? null) === null
  );
}

interface Props {
  model: TimelineModel;
  width: number;
  timeZone: string | null;
  title: string;
  summary: string;
}

export function TimelineChart({ model, width, timeZone, title, summary }: Props) {
  const id = useId();
  const first = model.hours[0];
  const last = model.hours.at(-1);
  if (!first || !last || width < 120) return null;

  const start = new Date(first.time);
  const end = new Date(Date.parse(last.time) + HOUR);
  const x = scaleTime({ domain: [start, end], range: [MARGIN.left, width - MARGIN.right] });
  const y = scaleLinear({
    domain: model.domain,
    range: [MARGIN.top + PLOT_HEIGHT, MARGIN.top],
    nice: true,
  });
  const stripTop = MARGIN.top + PLOT_HEIGHT + STRIP_GAP;
  const hourWidth = x(new Date(start.getTime() + HOUR)) - x(start);
  const ticks = model.hours
    .map((h) => new Date(h.time))
    .filter((t) => localHour(t, timeZone) % 6 === 0);

  return (
    <svg
      width={width}
      height={CHART_HEIGHT}
      role="img"
      aria-labelledby={`${id}-title ${id}-desc`}
      className="timeline-chart"
    >
      <title id={`${id}-title`}>{title}</title>
      <desc id={`${id}-desc`}>{summary}</desc>
      <defs>
        <pattern
          id={`${id}-hatch`}
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="6" height="6" className="tl-status-outside" />
          <line x1="0" y1="0" x2="0" y2="6" className="tl-hatch-line" strokeWidth="3" />
        </pattern>
        <pattern id={`${id}-dots`} width="5" height="5" patternUnits="userSpaceOnUse">
          <rect width="5" height="5" className="tl-status-unknown" />
          <circle cx="2.5" cy="2.5" r="1" className="tl-dot" />
        </pattern>
      </defs>

      {/* Light levels behind the plot, labeled in words where they fit. */}
      {model.lightBands.map((band) => {
        const bx = x(new Date(band.start));
        const bw = x(new Date(band.end)) - bx;
        return (
          <g key={band.start} data-light={band.light}>
            <rect
              x={bx}
              y={MARGIN.top}
              width={bw}
              height={PLOT_HEIGHT}
              className={`tl-band tl-band-${band.light}`}
            />
            {band.light !== 'daylight' && bw >= 44 && (
              <text
                x={bx + bw / 2}
                y={MARGIN.top - 7}
                textAnchor="middle"
                className="tl-band-label"
              >
                {LIGHT_LABELS[band.light]}
              </text>
            )}
          </g>
        );
      })}

      <AxisLeft
        scale={y}
        left={MARGIN.left}
        numTicks={5}
        label={model.unit}
        labelOffset={30}
        axisClassName="tl-axis"
        tickClassName="tl-tick"
      />

      {model.limits.map((limit) => (
        <g key={limit.thresholdId} className="tl-limit">
          <line
            x1={MARGIN.left}
            x2={width - MARGIN.right}
            y1={y(limit.value)}
            y2={y(limit.value)}
            strokeDasharray="6 4"
            className="tl-limit-line"
          />
          <text
            x={width - MARGIN.right - 4}
            y={y(limit.value) - 4}
            textAnchor="end"
            className="tl-limit-label"
          >
            {limit.label}
          </text>
        </g>
      ))}

      {model.series.map((series, i) => (
        <Group key={series.metric} className={`tl-series tl-series-${i}`}>
          <LinePath<SeriesPoint>
            data={series.points}
            x={(p) => x(new Date(Date.parse(p.time) + HOUR / 2))}
            y={(p) => y(p.value ?? 0)}
            defined={(p) => p.value !== null}
            className="tl-line"
            strokeWidth={2}
            {...(i > 0 ? { strokeDasharray: '4 3' } : {})}
          />
          {series.points.map((p, j) =>
            isolated(series.points, j) && p.value !== null ? (
              <circle
                key={p.time}
                cx={x(new Date(Date.parse(p.time) + HOUR / 2))}
                cy={y(p.value)}
                r={3}
                className="tl-point"
              />
            ) : null,
          )}
        </Group>
      ))}

      {/* One cell per hour: within, outside (hatched) or unknown (dotted). */}
      {model.hours.some((h) => h.status) && (
        <g className="tl-strip">
          {model.hours.map((hour) =>
            hour.status ? (
              <rect
                key={hour.time}
                x={x(new Date(hour.time)) + 0.5}
                y={stripTop}
                width={Math.max(hourWidth - 1, 1)}
                height={STRIP_HEIGHT}
                data-status={hour.status}
                {...(hour.status === 'outside'
                  ? { fill: `url(#${id}-hatch)` }
                  : hour.status === 'unknown'
                    ? { fill: `url(#${id}-dots)` }
                    : { className: 'tl-status-within' })}
              >
                <title>{STATUS_LABELS[hour.status]}</title>
              </rect>
            ) : null,
          )}
        </g>
      )}

      <AxisBottom
        scale={x}
        top={stripTop + STRIP_HEIGHT + 2}
        tickValues={ticks}
        tickFormat={(t) => tickLabel(t as Date, timeZone)}
        axisClassName="tl-axis"
        tickClassName="tl-tick"
      />
    </svg>
  );
}
