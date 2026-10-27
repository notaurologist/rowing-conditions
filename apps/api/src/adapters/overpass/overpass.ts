import { z } from 'zod';
import { consoleLogger, type FetchFn, fetchJson, type Logger, type SourceResult } from '../http.ts';
import { type Box, waterwaysUrl } from './requests.ts';
import { OverpassWays } from './schemas.ts';

// The public Overpass server can take over 30 s when busy (32 s measured on October 27, 2026).
// Snapping happens once, when a course is set up, so a long wait is acceptable.
const OVERPASS_TIMEOUT_MS = 60_000;

export const WaterwayNode = z.object({ id: z.number().int(), lat: z.number(), lon: z.number() });
export const Waterway = z.object({
  id: z.number().int(),
  name: z.string().optional(),
  nodes: z.array(WaterwayNode).min(2),
});
export type Waterway = z.infer<typeof Waterway>;

export interface WaterwaySource {
  getWaterways(box: Box): Promise<SourceResult<Waterway[]>>;
}

export interface OverpassAdapterOptions {
  userAgent: string; // identifies the app, as the usage policy asks
  fetch?: FetchFn;
  timeoutMs?: number;
  logger?: Logger;
  retryDelayMs?: number;
}

export function createOverpassAdapter(options: OverpassAdapterOptions): WaterwaySource {
  const logger = options.logger ?? consoleLogger;
  const request = {
    source: 'overpass' as const,
    fetch: options.fetch ?? globalThis.fetch,
    logger,
    headers: { 'User-Agent': options.userAgent },
    timeoutMs: options.timeoutMs ?? OVERPASS_TIMEOUT_MS,
  };

  return {
    async getWaterways(box) {
      // The public server answers 502 or 504 when it's busy, often briefly: retry once.
      let result = await fetchJson(waterwaysUrl(box), OverpassWays, request);
      if (!result.ok && result.error.kind === 'http' && (result.error.status ?? 0) >= 500) {
        await new Promise((resolve) => setTimeout(resolve, options.retryDelayMs ?? 3000));
        result = await fetchJson(waterwaysUrl(box), OverpassWays, request);
      }
      if (!result.ok) return result;
      const waterways: Waterway[] = [];
      for (const way of result.data.elements) {
        // A way's node ids and coordinates are parallel lists; a point outside the query box can
        // come back null, so only whole pairs are kept.
        const nodes = way.nodes.flatMap((id, i) => {
          const at = way.geometry[i];
          return at ? [{ id, lat: at.lat, lon: at.lon }] : [];
        });
        if (nodes.length < 2) continue;
        waterways.push({ id: way.id, ...(way.tags?.name ? { name: way.tags.name } : {}), nodes });
      }
      return { ok: true, data: waterways };
    },
  };
}
