import type {
  Alert,
  ForecastPoint,
  Gauge,
  Metric,
  NearbyGauge,
  Place,
  Reading,
  SourceId,
} from '@rowing/core';
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

export interface WeatherPoint {
  gridId: string;
  gridX: number;
  gridY: number;
  timeZone: string; // IANA, e.g. America/New_York
  place?: string; // nearest named place, e.g. "Turners Falls, MA"
}

export interface CurrentWeather {
  // 'station': the nearest fresh station observation. 'forecast': the forecast's current hour.
  basis: 'station' | 'forecast';
  station?: { id: string; name: string; distanceKm: number };
  readings: Reading[];
}

// A source of weather forecasts, observations, and alerts (NWS in the US). Methods never throw.
export interface WeatherSource {
  id: SourceId;
  getPoint(lat: number, lon: number): Promise<SourceResult<WeatherPoint>>;
  getHourlyForecast(
    lat: number,
    lon: number,
    hours: number,
  ): Promise<SourceResult<ForecastPoint[]>>;
  getCurrent(lat: number, lon: number): Promise<SourceResult<CurrentWeather>>;
  getAlerts(lat: number, lon: number): Promise<SourceResult<Alert[]>>;
}

// Finds places by name, for picking a location (Nominatim). Methods never throw.
export interface Geocoder {
  search(query: string): Promise<SourceResult<Place[]>>;
}
