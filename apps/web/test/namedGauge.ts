import { type ForecastPoint, toInternal } from '@rowing/core';
import type { Conditions } from '../src/lib/api.ts';

export const NAMED_GAUGE = 'usgs:USGS-01169000' as const;

// Adds a flow series for a second gauge, one a rule set names: twice the location's flow
// forecast, with a 9,000 cfs measurement in the first hour, as the API sends it. weatherOnly
// also drops the location's gauge and everything it reports, as at a lake.
export function withNamedGauge(base: Conditions, { weatherOnly = false } = {}): Conditions {
  const conditions = structuredClone(base);
  const points = conditions.forecast.map((p, i): ForecastPoint => {
    const provenance = p.provenance.flow;
    const value = p.values.flow;
    if (i === 0) {
      return {
        time: p.time,
        values: { flow: toInternal('flow', 9000, 'cfs') },
        provenance: {
          flow: {
            kind: 'observation',
            asOf: '2026-10-26T12:15:00.000Z',
            source: 'usgs',
            sourceRef: 'USGS-01169000',
          },
        },
      };
    }
    return provenance && typeof value === 'number'
      ? { time: p.time, values: { flow: value * 2 }, provenance: { flow: provenance } }
      : { time: p.time, values: {}, provenance: {} };
  });
  conditions.flowSeries = [
    { gaugeRef: NAMED_GAUGE, name: 'NORTH RIVER AT SHATTUCKVILLE, MA', points },
  ];
  if (weatherOnly) {
    delete conditions.gauge;
    conditions.current = conditions.current.filter((r) => r.source === 'nws');
    for (const p of conditions.forecast) {
      for (const [metric, prov] of Object.entries(p.provenance)) {
        if (prov.source === 'nws') continue;
        delete p.values[metric as keyof typeof p.values];
        delete p.provenance[metric as keyof typeof p.provenance];
      }
    }
  }
  return conditions;
}
