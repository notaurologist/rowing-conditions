import type { ForecastPoint, Gauge, Metric, NearbyGauge, Reading, SourceId } from '@rowing/core';
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

export interface StageFlow {
  observed: Reading[]; // flow and gauge height, oldest first
  forecast: ForecastPoint[]; // hourly, interpolated between forecast steps; [] when none
  issuedAt: string | null; // null when the gauge has no forecast
}

// A source of river flow forecasts (NWPS in the US). Methods never throw.
export interface FlowForecastSource {
  id: SourceId;
  findNearby(lat: number, lon: number, radiusKm: number): Promise<SourceResult<NearbyGauge[]>>;
  // identifier: an NWS location ID, or a bare USGS site number to find a USGS gauge's forecast point.
  getGauge(identifier: string): Promise<SourceResult<Gauge | null>>;
  getStageFlow(lid: string): Promise<SourceResult<StageFlow>>;
}
