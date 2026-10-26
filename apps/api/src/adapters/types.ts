import type { Gauge, Metric, NearbyGauge, Reading, SourceId } from '@rowing/core';
import type { SourceResult } from './http.ts';

// A source of observed river data (USGS in the US). Methods never throw.
export interface FlowSource {
  id: SourceId;
  findNearby(lat: number, lon: number, radiusKm: number): Promise<SourceResult<NearbyGauge[]>>;
  getGauge(gaugeId: string): Promise<SourceResult<Gauge | null>>;
  getLatest(gaugeId: string): Promise<SourceResult<Reading[]>>;
  getHistory(
    gaugeId: string,
    metric: Metric,
    from: string,
    to: string,
  ): Promise<SourceResult<Reading[]>>;
}
