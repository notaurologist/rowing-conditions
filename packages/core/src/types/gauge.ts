import { z } from 'zod';
import { GaugeRef, Metric, SourceId } from './measurement.ts';

export const Gauge = z.object({
  ref: GaugeRef, // e.g. 'usgs:USGS-01170500'
  source: SourceId,
  name: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  metrics: z.array(Metric), // what the gauge reports in real time, e.g. flow, gaugeHeight
  hasFlowForecast: z.boolean().optional(), // known once the NWPS adapter has looked
  linkedRef: GaugeRef.optional(), // the same gauge in the other source
});
export type Gauge = z.infer<typeof Gauge>;

export const NearbyGauge = Gauge.extend({ distanceKm: z.number().min(0) });
export type NearbyGauge = z.infer<typeof NearbyGauge>;
