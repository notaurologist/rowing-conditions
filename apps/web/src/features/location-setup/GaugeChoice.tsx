import type { NearbyGauge } from '@rowing/core';
import { formatDistanceKm, listMetrics } from '../../lib/format.ts';

export type NearbyState =
  | { status: 'loading' }
  | { status: 'error'; message: string; retry: () => void }
  | { status: 'ready'; gauges: NearbyGauge[]; radiusKm: number };

interface Props {
  nearby: NearbyState;
  /** The chosen gauge ref, or null for weather-only. */
  selected: string | null;
  suggested: string | null;
  units: 'us' | 'metric';
  onSelect: (ref: string | null) => void;
}

// Lists nearby gauges with what each reports. The suggested gauge is preselected, but the
// nearest gauge isn't always the relevant one (dams, tributaries), so any can be chosen,
// or none for weather-only.
export function GaugeChoice({ nearby, selected, suggested, units, onSelect }: Props) {
  if (nearby.status === 'loading') {
    return <p aria-live="polite">Looking for gauges nearby…</p>;
  }
  if (nearby.status === 'error') {
    return (
      <div role="alert" className="notice notice-error">
        <p>
          <strong>Couldn't load nearby gauges.</strong> {nearby.message}
        </p>
        <button type="button" onClick={nearby.retry}>
          Try again
        </button>
      </div>
    );
  }

  const { gauges, radiusKm } = nearby;
  return (
    <fieldset className="gauge-choice">
      <legend>Gauge</legend>
      {gauges.length === 0 && (
        <p>
          No gauges within {formatDistanceKm(radiusKm, units)}. This location will use weather only:
          wind, air temperature, alerts and daylight, with no flow or water temperature.
        </p>
      )}
      {gauges.map((gauge) => (
        <label key={gauge.ref} className="gauge-option">
          <input
            type="radio"
            name="gauge"
            value={gauge.ref}
            checked={selected === gauge.ref}
            onChange={() => onSelect(gauge.ref)}
          />
          <span>
            <span className="gauge-name">
              {gauge.name}
              {gauge.ref === suggested && <span className="tag">Suggested</span>}
            </span>
            <span className="gauge-detail">
              {formatDistanceKm(gauge.distanceKm, units)} away ·{' '}
              {gauge.metrics.length > 0
                ? `Reports ${listMetrics(gauge.metrics)}`
                : 'Reports nothing in real time'}
              {gauge.hasFlowForecast && ' · Flow forecast'}
            </span>
          </span>
        </label>
      ))}
      <label className="gauge-option">
        <input
          type="radio"
          name="gauge"
          value=""
          checked={selected === null}
          onChange={() => onSelect(null)}
        />
        <span>
          <span className="gauge-name">
            No gauge (weather only)
            {suggested === null && gauges.length > 0 && <span className="tag">Suggested</span>}
          </span>
          <span className="gauge-detail">For lakes and ponds, or when no gauge fits.</span>
        </span>
      </label>
    </fieldset>
  );
}
